/**
 * Planning from a link.
 *
 * When the person pastes a URL, the source is read first and condensed into a
 * plain brief, and only then turned into a graph. Two calls rather than one:
 * the planning call is constrained by a JSON schema, and mixing that with a
 * server-side tool is not something we can verify without hitting the real
 * API, so the fetch is kept in its own unconstrained call.
 */

// Deliberately narrow: http(s) only, and trailing punctuation that ends a
// sentence or closes a bracket is not part of the address.
const URL_PATTERN = /https?:\/\/[^\s<>"']+/g;
const TRAILING_JUNK = /[.,;:!?)\]}'"]+$/;

export function extractUrls(text) {
  const found = (text || '').match(URL_PATTERN) || [];
  const cleaned = found.map((url) => url.replace(TRAILING_JUNK, ''));
  return [...new Set(cleaned)];
}

export const BRIEF_SYSTEM_PROMPT = `You are preparing source material for a planning step.

Read the page the person linked and write a brief that someone could plan
from without opening the link: what it is about, the concrete steps or
requirements it lays out, and anything time-ordered or conditional.

Write plain prose, in the language of the page. No preamble, no markdown
headings. If the page cannot be read, say so in one sentence.`;

/**
 * Append the brief as its own user turn. Kept separate from the person's own
 * words and labelled, so the planner does not read the source material as
 * something they said.
 */
export function withSourceBrief(messages, brief) {
  if (!brief || !brief.trim()) return messages;

  return [
    ...messages,
    {
      role: 'user',
      content: `Source material from the link above, read on your behalf:\n\n${brief.trim()}`,
    },
  ];
}

/**
 * Read the linked sources and return a brief, or null when there is nothing
 * to read. Never throws - a failed fetch simply means planning proceeds on
 * the person's own words.
 */
/**
 * @param {object} [options]
 * @param {number} [options.maxTurns]
 * @param {(model: string, usage: object) => void} [options.onUsage] called once
 *        per API call, including each continuation of a paused turn — this loop
 *        can make four requests, and every one of them is billed.
 */
export async function buildSourceBrief(client, model, messages, { maxTurns = 4, onUsage = () => {} } = {}) {
  const urls = messages.flatMap((m) =>
    m.role === 'user' && typeof m.content === 'string' ? extractUrls(m.content) : []
  );

  if (urls.length === 0) return null;

  const turns = [
    {
      role: 'user',
      content: `Read and summarise for planning purposes:\n${urls.join('\n')}`,
    },
  ];

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      const response = await client.messages.create({
        model,
        max_tokens: 8000,
        // A paused turn resumes with everything fetched so far appended; this
        // keeps the continuation from re-billing it.
        cache_control: { type: 'ephemeral' },
        system: BRIEF_SYSTEM_PROMPT,
        messages: turns,
        tools: [{ type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 }],
      });

      onUsage(model, response.usage);

      // A server tool can hand the turn back mid-flight; continue it.
      if (response.stop_reason === 'pause_turn') {
        turns.push({ role: 'assistant', content: response.content });
        continue;
      }

      if (response.stop_reason === 'refusal') return null;

      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();

      return text || null;
    }
  } catch (error) {
    console.error('Source brief failed, planning without it:', error.message);
  }

  return null;
}
