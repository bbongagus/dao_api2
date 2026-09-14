/**
 * AI planning - turns a chat about a goal into a graph.
 *
 * Claude answers under a JSON schema (see ./ai/graphPlan.js), so the reply is
 * either a clarifying question or a plan in exactly the shape the editor
 * applies. Nothing is parsed out of prose.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

import { GraphPlanSchema, PLAN_SYSTEM_PROMPT, toClientResponse } from './ai/graphPlan.js';

// The user asked for Sonnet. Model ids carry no date suffix.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const MAX_TOKENS = 16000;

let client = null;

function getClient() {
  if (client) return client;

  // The SDK also resolves ANTHROPIC_AUTH_TOKEN and an `ant auth login`
  // profile, so only treat it as unconfigured when the constructor fails.
  client = new Anthropic();
  return client;
}

/**
 * Turn the frontend's chat history into Anthropic message params.
 * The system prompt is a separate request field, so it does not belong here.
 */
export function formatMessagesForAPI(messages) {
  const mapped = (messages || []).map((msg) => ({
    role: msg.sender === 'user' ? 'user' : 'assistant',
    content: msg.text,
  }));

  // The API requires the conversation to open on a user turn.
  const firstUser = mapped.findIndex((m) => m.role === 'user');
  return firstUser === -1 ? [] : mapped.slice(firstUser);
}

/**
 * Ask Claude for the next step: a question, or a plan.
 * Always resolves - transport and policy failures come back as
 * { type: 'error' } so the chat can show them.
 */
export async function sendMessageToAI(messages) {
  if (!messages || messages.length === 0) {
    return { type: 'error', message: 'Nothing to plan yet - say what you want to achieve.' };
  }

  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return {
      type: 'error',
      message: 'ANTHROPIC_API_KEY is not set on the server, so planning is unavailable.',
    };
  }

  try {
    const response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: PLAN_SYSTEM_PROMPT,
      messages,
      thinking: { type: 'adaptive' },
      output_config: {
        format: zodOutputFormat(GraphPlanSchema),
      },
    });

    if (response.stop_reason === 'refusal') {
      return {
        type: 'error',
        message: 'Claude declined this request. Try describing the goal differently.',
      };
    }

    if (!response.parsed_output) {
      return { type: 'error', message: 'Claude replied in a shape the editor could not read.' };
    }

    return toClientResponse(response.parsed_output);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { type: 'error', message: 'The Anthropic API key was rejected.' };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { type: 'error', message: 'Rate limited by the Anthropic API - try again shortly.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { type: 'error', message: `Anthropic API error ${error.status}: ${error.message}` };
    }

    console.error('AI planning failed:', error);
    return { type: 'error', message: error.message || 'AI planning failed.' };
  }
}

export default {
  sendMessageToAI,
  formatMessagesForAPI,
};
