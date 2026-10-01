/**
 * One turn of the graph agent.
 *
 * The model reads the graph through tools instead of being handed it, which
 * is what lets a large graph work at all, and stages its changes instead of
 * making them, which is what makes handing it write tools reasonable.
 *
 * Tool activity is reported from inside each tool rather than from the
 * runner's iteration, so what the person sees is the tool that actually ran.
 */

import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

import { buildAliasTable } from './aliases.js';
import { createReadTools } from './graphReadTools.js';
import { createWriteTools, KIND_LIST } from './graphWriteTools.js';
import { projectDraft } from './graphDraft.js';
import { AGENT_SYSTEM_PROMPT, RAMP_PROMPT, describeWhereUserIs } from './agentPrompt.js';
import { buildSourceBrief } from './sourceBrief.js';
import { createUsageMeter } from './usageMeter.js';

const MAX_TOKENS = 16000;
const MAX_ITERATIONS = 12;

// The ramp asks at most this many questions before it plans (RAMP_PROMPT).
export const RAMP_QUESTIONS = 4;

// Said once the ramp's questions are spent. Some models do not count their
// own questions across turns — GPT-6 Luna asked a fifth and a sixth and never
// planned — so the server counts them.
const RAMP_SPENT = `The ramp's ${RAMP_QUESTIONS} questions have been asked in this chat. Unless a plan was already proposed in it, ask nothing more: plan now with \`plan_path\` from what you know, and say in a clause what you assumed.`;

export function summariseStaged(staged) {
  return {
    add: staged.filter((o) => o.op === 'add').length,
    update: staged.filter((o) => o.op === 'update').length,
    delete: staged.filter((o) => o.op === 'delete').length,
    done: staged.filter((o) => o.op === 'done').length,
  };
}

/** Turn what the loop produced into what the editor consumes. */
export function shapeTurn({ staged, summary, stoppedEarly = false }) {
  const said = (summary || '').trim();
  const ranOutOfRoom = 'I ran out of room while looking around before I finished — ask me to continue, or narrow the request.';
  if (stoppedEarly && staged.length) return {
    type: 'error', reason: 'incomplete_plan',
    message: 'I could not finish checking the whole plan. Nothing has been changed, and this unfinished draft cannot be applied. Please retry.',
  };

  // Moves, checklist items and arrows are implementation details, not a
  // measure of the person's request. Do not discard a draft at 30 edits.
  // Tool validation, the execution budget and explicit Apply still apply.

  if (staged.length === 0) {
    if (stoppedEarly) {
      // Ran out of iterations/tokens/context before staging anything — this
      // is not the same as looking and finding nothing to change, and must
      // not be reported as if it were.
      return {
        type: 'text',
        message: said ? `${said} ${ranOutOfRoom}` : ranOutOfRoom,
      };
    }
    return {
      type: 'text',
      message: said || 'I had a look and did not find anything to change. Tell me a bit more about what you want.',
    };
  }

  return {
    type: 'changes',
    summary: said,
    operations: staged,
    counts: summariseStaged(staged),
  };
}

export async function runGraphAgent({
  client, model, nodes, edges = [], currentPath, messages, mode, canMove = false, emit, onToolCall = () => {}, signal,
  // What the host needs beside the Messages parameters — OpenRouter's routing.
  extraBody = {},
  // A thinking budget for the loop, or null to leave the model's default.
  thinking = null,
}) {
  // Every upstream call this turn makes is added here — the link reader's up
  // to four and the loop's up to twelve — so the quota is charged for all of
  // them, including the ones a failed turn already paid for.
  const meter = createUsageMeter();
  const withUsage = (turn) => ({ ...turn, usage: meter.total() });

  const aliases = buildAliasTable(nodes);
  const read = createReadTools(nodes, aliases, edges);
  const { tools: write, staged, validate } = createWriteTools(nodes, aliases, edges, { canMove });

  emit({ type: 'status', text: aliases.size === 0 ? 'the graph is empty' : `${aliases.size} nodes in the graph` });

  // Reading a link stays its own call, ahead of the loop, rather than a tool
  // the model can invoke: it isolates a slow fetch behind its own status
  // line and lets sourceBrief.js run under its own system prompt instead of
  // the agent's.
  let brief = null;
  if (messages.some((m) => m.role === 'user' && /https?:\/\//.test(m.content || ''))) {
    emit({ type: 'status', text: 'reading the link' });
    brief = await buildSourceBrief(client, model, messages, { onUsage: meter.add, signal, extraBody });
    if (!brief) emit({ type: 'status', text: 'could not read the link — going on without it' });
  }

  /**
   * Wrap a read tool so the person sees it run and a thrown error cannot end
   * the turn. Read tools always succeed, so the status line just names the
   * call — there is no outcome to react to.
   */
  const reportedRead = (name, describe, fn) => async (input) => {
    try {
      const result = fn(input);
      emit({ type: 'status', text: describe(input) });
      onToolCall({ name, input, result });
      return result;
    } catch (error) {
      console.error(`tool ${name} failed:`, error);
      emit({ type: 'status', text: describe(input) });
      const result = `That did not work: ${error.message}. Try a different approach.`;
      onToolCall({ name, input, result });
      return result;
    }
  };

  /**
   * Wrap a write tool so the status line reports what happened, not what was
   * attempted. Write tools never throw — a refusal comes back as an ordinary
   * string that does not start with "Staged:" — so the emit happens after
   * the call, once the outcome is known. A thrown error is still caught
   * defensively so it cannot end the turn.
   */
  const reportedWrite = (name, describeDoing, describeFailed, fn) => async (input) => {
    try {
      const result = fn(input);
      const ok = typeof result === 'string' && result.startsWith('Staged:');
      emit({ type: 'status', text: ok ? describeDoing(input) : describeFailed(input) });
      onToolCall({ name, input, result });
      return result;
    } catch (error) {
      console.error(`tool ${name} failed:`, error);
      emit({ type: 'status', text: describeFailed(input) });
      const result = `That did not work: ${error.message}. Try a different approach.`;
      onToolCall({ name, input, result });
      return result;
    }
  };

  const titleOf = (alias) => aliases.nodeAt(alias)?.title || alias;

  const tools = [
    betaZodTool({
      name: 'overview',
      description: 'List the top level of the graph: each node, its kind, and how many nodes are inside it. Start here.',
      inputSchema: z.object({}),
      run: reportedRead('overview', () => 'looking at the graph', () => read.overview()),
    }),
    betaZodTool({
      name: 'inspect',
      description: 'Read a saved node and its contents, descriptions and links. Opening a Track follows its connected path and checklist contents on the same level. This is saved state; use inspect_draft to check proposed changes.',
      inputSchema: z.object({
        alias: z.string().describe('The node to open, e.g. n3'),
        depth: z.number().describe('How many levels down to show, 1 to 6'),
        offset: z.number().int().min(0).optional().describe('Skip this many direct children to read the next page; default 0'),
      }),
      run: reportedRead('inspect', ({ alias }) => `reading "${titleOf(alias)}"`, (input) => read.inspect(input)),
    }),
    betaZodTool({
      name: 'inspect_draft',
      description: 'Read the graph as it would look after all staged changes, without applying them. Existing aliases stay the same; new nodes use your add_node aliases. Check groups, completed tasks and links before finishing. An empty alias shows the top level.',
      inputSchema: z.object({
        alias: z.string(),
        depth: z.number().describe('How many levels down to show, 1 to 6'),
        offset: z.number().int().min(0).optional().describe('Skip direct children for the next page; default 0'),
      }),
      run: reportedRead('inspect_draft', () => 'checking the proposed structure', (input) => {
        const draft = projectDraft(nodes, edges, staged, aliases);
        const view = createReadTools(draft.nodes, draft.aliases, draft.edges);
        return `Draft only — ${staged.length} staged operations; nothing applied.\n`
          + (validate() ? `Needs repair: ${validate()}\n` : '')
          + (input.alias ? view.inspect(input) : view.overview());
      }),
    }),
    betaZodTool({
      name: 'search',
      description: 'Find nodes anywhere in the graph whose title or description contains some text.',
      inputSchema: z.object({ text: z.string() }),
      run: reportedRead('search', ({ text }) => `searching for "${text}"`, (input) => read.search(input)),
    }),
    betaZodTool({
      name: 'tasks',
      description: 'List every task still to do, or every task already done, one line each with where it sits. Use it to find the task the person means when they say they did something.',
      inputSchema: z.object({
        done: z.boolean().describe('false: the tasks still to do; true: the ones already done'),
      }),
      run: reportedRead('tasks', () => 'looking through the tasks', (input) => read.tasks(input)),
    }),
    betaZodTool({
      name: 'add_node',
      description: 'Propose a new node. Nothing is created until the person confirms.',
      inputSchema: z.object({
        alias: z.string().describe('Your own short name for this node, so later calls can point at it'),
        parent: z.string().describe('The node to nest it inside, or "" for the top level'),
        title: z.string(),
        description: z.string(),
        kind: z.enum(KIND_LIST),
        x: z.number(),
        y: z.number(),
      }),
      run: reportedWrite(
        'add_node',
        ({ title }) => `adding "${title}"`,
        ({ title }) => `could not add "${title}"`,
        (input) => write.add(input),
      ),
    }),
    betaZodTool({
      name: 'update_node',
      description: 'Propose changing a node. Send only the fields that change.',
      inputSchema: z.object({
        target: z.string(),
        title: z.string().describe('Leave empty to keep it'),
        description: z.string().describe('Leave empty to keep it'),
        kind: z.string().describe('Leave empty to keep it'),
      }),
      run: reportedWrite(
        'update_node',
        ({ target }) => `changing "${titleOf(target)}"`,
        ({ target }) => `could not change "${titleOf(target)}"`,
        (input) => write.update(input),
      ),
    }),
    betaZodTool({
      name: 'remove_node',
      description: 'Propose deleting a node. Only one with nothing inside it.',
      inputSchema: z.object({ target: z.string() }),
      run: reportedWrite(
        'remove_node',
        ({ target }) => `removing "${titleOf(target)}"`,
        ({ target }) => `could not remove "${titleOf(target)}"`,
        (input) => write.remove(input),
      ),
    }),
    betaZodTool({
      name: 'link_nodes',
      description: 'Propose connecting one node downstream of another.',
      inputSchema: z.object({ source: z.string(), target: z.string() }),
      run: reportedWrite(
        'link_nodes',
        ({ source, target }) => `connecting "${titleOf(source)}" → "${titleOf(target)}"`,
        ({ source, target }) => `could not connect "${titleOf(source)}" → "${titleOf(target)}"`,
        (input) => write.link(input),
      ),
    }),
    betaZodTool({
      name: 'unlink_nodes',
      description: 'Propose disconnecting two nodes.',
      inputSchema: z.object({ source: z.string(), target: z.string() }),
      run: reportedWrite(
        'unlink_nodes',
        ({ source, target }) => `disconnecting "${titleOf(source)}" from "${titleOf(target)}"`,
        ({ source, target }) => `could not disconnect "${titleOf(source)}" from "${titleOf(target)}"`,
        (input) => write.unlink(input),
      ),
    }),
    betaZodTool({
      name: 'move_node',
      description: 'Propose putting a node, with everything inside it, under another parent - or at the top level. It keeps its tick and its arrows. Nothing changes until the person confirms.',
      inputSchema: z.object({
        target: z.string().describe('The node to move, e.g. n12'),
        parent: z.string().describe('The ryu or task to put it inside, or "" for the top level'),
      }),
      run: reportedWrite(
        'move_node',
        ({ target }) => `moving "${titleOf(target)}"`,
        ({ target }) => `could not move "${titleOf(target)}"`,
        (input) => write.move(input),
      ),
    }),
    betaZodTool({
      name: 'mark_done',
      description: 'Propose ticking a task as done, or taking the tick back. Nothing changes until the person confirms.',
      inputSchema: z.object({
        target: z.string().describe('The task, e.g. n12'),
        done: z.boolean().describe('true to mark it done, false to take the tick back'),
      }),
      run: reportedWrite(
        'mark_done',
        ({ target, done }) => `marking "${titleOf(target)}" ${done ? 'done' : 'not done'}`,
        ({ target }) => `could not mark "${titleOf(target)}"`,
        (input) => write.markDone(input),
      ),
    }),
    betaZodTool({
      name: 'start_over',
      description: 'Discard a wrong staged draft, at most once per turn. Do not use on an empty draft or to retry a refused tool. plan_path replaces its prior plan atomically when possible.',
      inputSchema: z.object({}),
      run: reportedWrite(
        'start_over',
        // Its answer is not a "Staged:" one, and it cannot fail.
        () => 'revising the draft',
        () => 'checking the draft',
        () => write.startOver(),
      ),
    }),
    betaZodTool({
      name: 'plan_path',
      description: 'Build a connected path from a Track through tasks and Milestones on one level, with real checklists. Reuse existing task/milestone aliases to preserve completed work. Keep one enclosing Group, with the Track, tasks and Milestones together inside it. Remove only nested stage Groups. Nothing changes until confirmed.',
      inputSchema: z.object({
        layout: z.enum(['track', 'group']).describe('Use track for a connected goal/path. group is only for explicitly requested containment.'),
        sequence: z.boolean().describe('true when stages must follow one another in the given order; false to use stage after dependencies'),
        section: z.string().describe('Existing Track or Group alias to restructure; empty creates a new plan Group with a Track inside. Existing enclosing Groups are preserved. Staged aliases also work.'),
        sectionTitle: z.string().describe('Title of the new section when section is ""'),
        sectionDescription: z.string(),
        stages: z.array(z.object({
          id: z.string().describe('Short id, unique among stages'),
          title: z.string().describe('The outcome that closes the stage, e.g. "Удостоверение получено"'),
          description: z.string(),
          existing: z.string().optional().describe('Existing Milestone alias to reuse, or empty for new'),
          after: z.array(z.string()).describe('ids of the stages that must be complete before this one can start'),
          steps: z.array(z.object({
            id: z.string().describe('Short id, unique within the stage'),
            title: z.string(),
            description: z.string(),
            existing: z.string().optional().describe('Existing task alias to move/reuse, or empty for new. Account for all existing work in the selected area.'),
            after: z.array(z.string()).describe('ids of steps in this same stage that must be done first'),
            checklistCount: z.number().int().min(0).describe('Required number of individually tickable items; 0 for a plain task. Must equal checklist length.'),
            checklist: z.array(z.union([z.string(), z.object({ title: z.string(), existing: z.string() })])).describe('Each item is a title, or {title, existing} to keep an already completed item. Seven comments require seven items, not a single task title.'),
          })),
        })),
      }),
      run: reportedWrite(
        'plan_path',
        ({ section, sectionTitle }) => `planning "${sectionTitle || titleOf(section)}"`,
        ({ section, sectionTitle }) => `could not plan "${sectionTitle || titleOf(section)}"`,
        (input) => write.plan(input),
      ),
    }),
  ];

  const opening = [{ role: 'user', content: describeWhereUserIs(currentPath, aliases) }];
  if (brief) {
    opening.push({
      role: 'user',
      content: `Source material from the link, read on your behalf:\n\n${brief.trim()}`,
    });
  }

  const firstUser = messages.findIndex((m) => m.role === 'user');
  const conversation = firstUser === -1 ? [] : messages.slice(firstUser);
  const rampSpent = mode === 'ramp'
    && conversation.filter((m) => m.role === 'assistant').length >= RAMP_QUESTIONS;

  emit({ type: 'status', text: 'thinking' });

  let final;
  try {
    // Iterated rather than awaited: `await runner` hands back only the final
    // message, and every iteration before it was billed too. Each one carries
    // its own `usage`, and this is the only place it can be read.
    const runner = client.beta.messages.toolRunner({
      ...extraBody,
      model,
      max_tokens: MAX_TOKENS,
      max_iterations: MAX_ITERATIONS,
      ...(thinking ? { thinking } : {}),
      // The robust pair for an agent loop. The explicit marker gives the
      // system prompt a read point that survives whatever happens in
      // `messages`; the top-level one follows the tail as the loop appends
      // tool calls and results, so iteration N reads what N-1 wrote. Without
      // it every one of up to twelve iterations re-billed the whole history.
      cache_control: { type: 'ephemeral' },
      // A ramp adds its own block after the shared one rather than changing
      // it, so both modes read the same cached prefix.
      system: [
        { type: 'text', text: AGENT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ...(mode === 'ramp' ? [{ type: 'text', text: RAMP_PROMPT, cache_control: { type: 'ephemeral' } }] : []),
        // After the cached blocks and unmarked, so the prefix they cache is unchanged.
        ...(rampSpent ? [{ type: 'text', text: RAMP_SPENT }] : []),
      ],
      messages: [...opening, ...conversation],
      tools,
    }, { signal });

    let resets = 0;
    for await (const message of runner) {
      meter.add(model, message.usage);
      resets += (message.content || []).filter((block) => block.type === 'tool_use' && block.name === 'start_over').length;
      if (resets > 1) {
        // The SDK yields the response before running its tools. Returning
        // closes the iterator before another destructive reset or paid call.
        return withUsage({ type: 'error', reason: 'staging_loop', message: 'I got stuck revising the draft and stopped before making changes. Try asking for one part of the plan first.' });
      }
    }
    final = await runner.done();
  } catch (error) {
    // Typed, most specific first. APIConnectionError is itself a subclass of
    // APIError (verified against this SDK version at runtime), so it has to
    // be checked before the generic APIError branch or it would never be
    // reached. Never string-match error.message — the SDK's own types are
    // the contract.
    // Before the APIError branch: an abort is itself an APIError, so without
    // its own case a person closing the tab was journalled as a failure of
    // the model's.
    if (error instanceof Anthropic.APIUserAbortError || error?.name === 'AbortError') {
      return withUsage({ type: 'cancelled', message: 'Stopped.' });
    }
    if (error instanceof Anthropic.RateLimitError) {
      return withUsage({ type: 'error', message: 'The AI model is rate-limited right now. Try again in a moment.' });
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return withUsage({ type: 'error', message: 'Could not reach the AI model. Check the connection and try again.' });
    }
    if (error instanceof Anthropic.APIError) {
      return withUsage({ type: 'error', message: `The AI provider returned an error (status ${error.status ?? 'unknown'}). Try again in a moment.` });
    }
    console.error('runGraphAgent: toolRunner failed:', error);
    return withUsage({ type: 'error', message: 'Something went wrong talking to the AI model. Try again.' });
  }

  if (final.stop_reason === 'refusal') {
    return withUsage({ type: 'error', message: 'The model declined this request.' });
  }

  const summary = final.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  // Read the stop reason directly rather than inferring truncation from block
  // types: max_tokens and model_context_window_exceeded both stop the runner
  // immediately with a truncated text block and no tool_use, and tool_use
  // itself is what a response looks like when max_iterations cuts the loop
  // off mid-call. pause_turn/compaction never reach here — the runner
  // resumes those on its own — and end_turn/stop_sequence are a complete turn.
  const stoppedEarly = ['tool_use', 'max_tokens', 'model_context_window_exceeded'].includes(final.stop_reason);

  if (staged.length && validate()) return withUsage({ type: 'error', reason: 'invalid_plan',
    message: 'The proposed path failed its structure check. Nothing has changed. Please retry so I can complete the plan.' });

  return withUsage(shapeTurn({ staged, summary, stoppedEarly }));
}

export default runGraphAgent;
