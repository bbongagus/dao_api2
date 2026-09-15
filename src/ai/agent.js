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

  if (staged.length > MAX_OPERATIONS) {
    return {
      type: 'text',
      message: `That came to ${staged.length} changes at once, which is more than I will propose in one step. Ask for one part of it at a time.`,
    };
  }

  if (staged.length === 0) {
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

  // Reading a link stays its own call: the tool runner does not auto-resume
  // the pause_turn a server tool produces.
  let brief = null;
  if (messages.some((m) => m.role === 'user' && /https?:\/\//.test(m.content || ''))) {
    emit({ type: 'status', text: 'reading the link' });
    brief = await buildSourceBrief(client, model, messages);
    if (!brief) emit({ type: 'status', text: 'could not read the link — going on without it' });
  }

  /** Wrap a tool so the person sees it run and a thrown error cannot end the turn. */
  const reported = (name, describe, fn) => async (input) => {
    emit({ type: 'status', text: describe(input) });
    try {
      return fn(input);
    } catch (error) {
      console.error(`tool ${name} failed:`, error);
      return `That did not work: ${error.message}. Try a different approach.`;
    }
  };

  const titleOf = (alias) => aliases.nodeAt(alias)?.title || alias;

  const tools = [
    betaZodTool({
      name: 'overview',
      description: 'List the top level of the graph: each node, its kind, and how many nodes are inside it. Start here.',
      inputSchema: z.object({}),
      run: reported('overview', () => 'looking at the graph', () => read.overview()),
    }),
    betaZodTool({
      name: 'inspect',
      description: 'Open one node and everything inside it, with descriptions and links.',
      inputSchema: z.object({
        alias: z.string().describe('The node to open, e.g. n3'),
        depth: z.number().describe('How many levels down to show, 1 to 6'),
      }),
      run: reported('inspect', ({ alias }) => `reading "${titleOf(alias)}"`, (input) => read.inspect(input)),
    }),
    betaZodTool({
      name: 'search',
      description: 'Find nodes anywhere in the graph whose title or description contains some text.',
      inputSchema: z.object({ text: z.string() }),
      run: reported('search', ({ text }) => `searching for "${text}"`, (input) => read.search(input)),
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
      run: reported('add_node', ({ title }) => `adding "${title}"`, (input) => write.add(input)),
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
      run: reported('update_node', ({ target }) => `changing "${titleOf(target)}"`, (input) => write.update(input)),
    }),
    betaZodTool({
      name: 'remove_node',
      description: 'Propose deleting a node. Only one with nothing inside it.',
      inputSchema: z.object({ target: z.string() }),
      run: reported('remove_node', ({ target }) => `removing "${titleOf(target)}"`, (input) => write.remove(input)),
    }),
    betaZodTool({
      name: 'link_nodes',
      description: 'Propose connecting one node downstream of another.',
      inputSchema: z.object({ source: z.string(), target: z.string() }),
      run: reported('link_nodes', ({ source, target }) => `connecting "${titleOf(source)}" → "${titleOf(target)}"`, (input) => write.link(input)),
    }),
    betaZodTool({
      name: 'unlink_nodes',
      description: 'Propose disconnecting two nodes.',
      inputSchema: z.object({ source: z.string(), target: z.string() }),
      run: reported('unlink_nodes', ({ source, target }) => `disconnecting "${titleOf(source)}" from "${titleOf(target)}"`, (input) => write.unlink(input)),
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

  const final = await client.beta.messages.toolRunner({
    model,
    max_tokens: MAX_TOKENS,
    max_iterations: MAX_ITERATIONS,
    system: [
      { type: 'text', text: AGENT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: [...opening, ...conversation],
    tools,
  });

  if (final.stop_reason === 'refusal') {
    return { type: 'error', message: 'Claude declined this request.' };
  }

  const summary = final.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  // The runner stops when Claude stops calling tools. If it stopped because it
  // ran out of iterations, the last message still holds a tool call.
  const stoppedEarly = final.content.some((block) => block.type === 'tool_use');

  return shapeTurn({ staged, summary, stoppedEarly });
}

export default runGraphAgent;
