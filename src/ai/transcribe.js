/**
 * Speech to text through Deepgram, for the chat's microphone.
 *
 * The browser records a short clip and posts it here; the key never leaves
 * the server. Spend goes into the same ledger as the chat, so a voice note is
 * refused when the month's allowance is gone, like any turn.
 */

// Nova-3 pay-as-you-go, dollars per minute of audio (rounded up, not down).
export const DOLLARS_PER_MINUTE = 0.0077;
// A clip longer than this is a microphone left on, not a message.
export const MAX_BYTES = 10 * 1024 * 1024;

export function transcriptionCost(seconds) {
  return Number.isFinite(seconds) && seconds > 0 ? (seconds / 60) * DOLLARS_PER_MINUTE : 0;
}

/**
 * @returns {Promise<{ text: string, seconds: number }>}
 */
export async function transcribe({ audio, contentType, apiKey, fetchImpl = fetch, signal }) {
  const params = new URLSearchParams({
    model: process.env.DEEPGRAM_MODEL || 'nova-3',
    // Russian and English in the same sentence, as people actually talk.
    language: process.env.DEEPGRAM_LANGUAGE || 'multi',
    smart_format: 'true',
    punctuate: 'true',
  });
  const res = await fetchImpl(`https://api.deepgram.com/v1/listen?${params}`, {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey}`, 'Content-Type': contentType || 'application/octet-stream' },
    body: audio,
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const error = new Error(`deepgram ${res.status}: ${detail.slice(0, 200)}`);
    error.status = res.status;
    throw error;
  }
  const body = await res.json();
  const text = body?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
  return { text: text.trim(), seconds: Number(body?.metadata?.duration) || 0 };
}
