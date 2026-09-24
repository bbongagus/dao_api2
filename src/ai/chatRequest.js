/**
 * What a chat request is allowed to be.
 *
 * The body used to be checked for "an array with something in it" and then
 * handed to the Anthropic API as-is: any role, any content shape, any length.
 * Everything in it is billed as input tokens, so the caps here are a cost
 * control as much as a validation.
 */

import { z } from 'zod';

/** Roughly 25k tokens — far more than anyone types, far less than a book. */
export const MAX_MESSAGE_CHARS = 100_000;

const Message = z.object({
  // The two roles the Messages API takes. A "system" role smuggled in here
  // would carry operator authority it has no business having.
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(MAX_MESSAGE_CHARS),
});

const ChatRequest = z.object({
  // No cap on how many: a long conversation is billed, and the monthly quota
  // (spend.js) bounds what it costs.
  messages: z.array(Message).min(1),
  currentPath: z.array(z.string().max(200)).max(50).default([]),
  // A graph id becomes part of a Redis key, where ':' separates the parts.
  graphId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).default('main'),
  // A chat the person opened to work an idea out (agentPrompt.js, RAMP_PROMPT).
  // An enum, not a string: it selects server-side instructions, and nothing
  // the client sends may choose which.
  mode: z.enum(['ramp']).optional(),
});

/**
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 *   The error names the first thing that was wrong and never quotes the body
 *   back — a refusal should not reflect an attacker's payload into the log.
 */
export function parseChatRequest(body) {
  const result = ChatRequest.safeParse(body ?? {});
  if (result.success) return { ok: true, value: result.data };

  const first = result.error.issues[0];
  const where = first.path.length ? first.path.join('.') : 'body';
  return { ok: false, error: `${where}: ${first.message}`.slice(0, 200) };
}

export default parseChatRequest;
