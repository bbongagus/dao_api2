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
import { AGENT_SYSTEM_PROMPT, describeWhereUserIs } from './agentPrompt.js';
import { buildSourceBrief } from './sourceBrief.js';
import { MAX_OPERATIONS } from './graphChange.js';

const MAX_TOKENS = 16000;
const MAX_ITERATIONS = 12;

export function summariseStaged(staged) {
  return {
    add: staged.filter((o) => o.op === 'add').length,
    update: staged.filter((o) => o.op === 'update').length,
    delete: staged.filter((o) => o.op === 'delete').length,
  };
}

/** Turn what the loop produced into what the editor consumes. */
export function shapeTurn({ staged, summary, stoppedEarly = false }) {
  const said = (summary || '').trim();
  const ranOutOfRoom = 'I ran out of room while looking around before I finished — ask me to continue, or narrow the request.';

  if (staged.length > MAX_OPERATIONS) {
    return {
      type: 'text',
      message: stoppedEarly
        ? `That came to ${staged.length} changes at once, which is more than I will propose in one step, and I still ran out of room before I was done. Ask for one part of it at a time.`
        : `That came to ${staged.length} changes at once, which is more than I will propose in one step. Ask for one part of it at a time.`,
    };
  }

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
    summary: stoppedEarly
      ? `${said} (I stopped part-way through — ask me to carry on if this is not all of it.)`.trim()
      : said,
    operations: staged,
    counts: summariseStaged(staged),
  };
}

export async function runGraphAgent({ client, model, nodes, currentPath, messages, emit }) {
  const aliases = buildAliasTable(nodes);
  const read = createReadTools(nodes, aliases);
  const { tools: write, staged } = createWriteTools(nodes, aliases);

  emit({ type: 'status', text: aliases.size === 0 ? 'the graph is empty' : `${aliases.size} nodes in the graph` });

  // Reading a link stays its own call, ahead of the loop, rather than a tool
  // the model can invoke: it isolates a slow fetch behind its own status
  // line and lets sourceBrief.js run under its own system prompt instead of
  // the agent's.
  let brief = null;
  if (messages.some((m) => m.role === 'user' && /https?:\/\//.test(m.content || ''))) {
    emit({ type: 'status', text: 'reading the link' });
    brief = await buildSourceBrief(client, model, messages);
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
      return result;
    } catch (error) {
      console.error(`tool ${name} failed:`, error);
      emit({ type: 'status', text: describe(input) });
      return `That did not work: ${error.message}. Try a different approach.`;
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
      return result;
    } catch (error) {
      console.error(`tool ${name} failed:`, error);
      emit({ type: 'status', text: describeFailed(input) });
      return `That did not work: ${error.message}. Try a different approach.`;
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
      description: 'Open one node and everything inside it, with descriptions and links.',
      inputSchema: z.object({
        alias: z.string().describe('The node to open, e.g. n3'),
        depth: z.number().describe('How many levels down to show, 1 to 6'),
      }),
      run: reportedRead('inspect', ({ alias }) => `reading "${titleOf(alias)}"`, (input) => read.inspect(input)),
    }),
    betaZodTool({
      name: 'search',
      description: 'Find nodes anywhere in the graph whose title or description contains some text.',
      inputSchema: z.object({ text: z.string() }),
      run: reportedRead('search', ({ text }) => `searching for "${text}"`, (input) => read.search(input)),
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
        requiredCompletions: z.number().describe('0 to keep it'),
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

  emit({ type: 'status', text: 'thinking' });

  let final;
  try {
    final = await client.beta.messages.toolRunner({
      model,
      max_tokens: MAX_TOKENS,
      max_iterations: MAX_ITERATIONS,
      system: [
        { type: 'text', text: AGENT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [...opening, ...conversation],
      tools,
    });
  } catch (error) {
    // Typed, most specific first. APIConnectionError is itself a subclass of
    // APIError (verified against this SDK version at runtime), so it has to
    // be checked before the generic APIError branch or it would never be
    // reached. Never string-match error.message — the SDK's own types are
    // the contract.
    if (error instanceof Anthropic.RateLimitError) {
      return { type: 'error', message: 'Claude is rate-limited right now. Try again in a moment.' };
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return { type: 'error', message: 'Could not reach Claude. Check the connection and try again.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { type: 'error', message: `Claude's API returned an error (status ${error.status ?? 'unknown'}). Try again in a moment.` };
    }
    console.error('runGraphAgent: toolRunner failed:', error);
    return { type: 'error', message: 'Something went wrong talking to Claude. Try again.' };
  }

  if (final.stop_reason === 'refusal') {
    return { type: 'error', message: 'Claude declined this request.' };
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

  return shapeTurn({ staged, summary, stoppedEarly });
}

export default runGraphAgent;
