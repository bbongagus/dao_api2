/**
 * One turn of the graph chat.
 *
 * The turn streams, because it is slow: the model thinks for a while, and if
 * the person pasted a link the page has to be read first. Without progress
 * the interface sits blank for a minute and a half.
 *
 * What comes back is a proposal, never an applied change. The editor shows it
 * and the person decides.
 */

import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { buildGraphContext } from './graphContext.js';
import { GraphChangeSchema, CHANGE_SYSTEM_PROMPT, toChangeResponse } from './graphChange.js';
import { buildSourceBrief } from './sourceBrief.js';

const MAX_TOKENS = 16000;

/**
 * Assemble the request messages.
 *
 * The graph goes in front of the conversation rather than into the system
 * prompt: the system prompt is identical on every request and therefore
 * cached, while the graph changes on every turn.
 */
export function composeChatMessages(messages, contextText, brief) {
  const turns = [{ role: 'user', content: contextText }];

  if (brief && brief.trim()) {
    turns.push({
      role: 'user',
      content: `Source material from the link, read on your behalf:\n\n${brief.trim()}`,
    });
  }

  const firstUser = messages.findIndex((m) => m.role === 'user');
  const conversation = firstUser === -1 ? [] : messages.slice(firstUser);

  return [...turns, ...conversation];
}

/**
 * Run one turn, reporting progress through `emit` as it goes.
 * Resolves with the same shape the non-streaming endpoint returns.
 */
export async function streamChatTurn({ client, model, messages, nodes, emit }) {
  const { text: contextText, aliasToId, count } = buildGraphContext(nodes);

  emit({ type: 'status', text: count === 0 ? 'building a new graph' : `reading ${count} nodes` });

  let brief = null;
  const hasLink = messages.some((m) => m.role === 'user' && /https?:\/\//.test(m.content || ''));
  if (hasLink) {
    emit({ type: 'status', text: 'reading the link' });
    brief = await buildSourceBrief(client, model, messages);
    if (!brief) emit({ type: 'status', text: 'could not read the link - going on without it' });
  }

  emit({ type: 'status', text: 'thinking' });

  const stream = client.messages.stream({
    model,
    max_tokens: MAX_TOKENS,
    system: [
      { type: 'text', text: CHANGE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
    ],
    messages: composeChatMessages(messages, contextText, brief),
    // summarized, or the thinking blocks arrive empty and there is nothing
    // to show for the wait.
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { format: zodOutputFormat(GraphChangeSchema) },
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'thinking_delta') {
      emit({ type: 'thinking', text: event.delta.thinking });
    }
  }

  const final = await stream.finalMessage();

  if (final.stop_reason === 'refusal') {
    return { type: 'error', message: 'Claude declined this request.' };
  }

  const body = final.content.find((block) => block.type === 'text')?.text;
  if (!body) {
    return { type: 'error', message: 'Claude replied with nothing the editor could read.' };
  }

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { type: 'error', message: 'Claude replied in a shape the editor could not read.' };
  }

  return toChangeResponse(parsed, aliasToId, nodes);
}
