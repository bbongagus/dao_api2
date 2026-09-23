/**
 * Live speech to text for the chat's microphone.
 *
 * The browser streams 16-bit PCM over a socket of its own (SPEECH_PATH, apart
 * from the graph socket) and gets words back while it is still talking. The
 * server stands in the middle rather than handing the browser a Deepgram
 * token: the key never leaves it, and it is the only place that knows how
 * long a stream really ran — which is what Deepgram bills, and what goes into
 * the same monthly ledger as the chat. Refused before any audio goes out,
 * charged after, like an AI turn.
 *
 * Client → server
 *   { type: 'START', token, sampleRate }   then binary frames of PCM16 mono
 *   { type: 'STOP' }                       the last words arrive, then DONE
 * Server → client
 *   { type: 'READY' }
 *   { type: 'TRANSCRIPT', text, isFinal }
 *   { type: 'DONE' }
 *   { type: 'ERROR', reason: 'auth'|'quota'|'busy'|'unavailable'|'upstream', scope? }
 */

import WebSocket from 'ws';
import { logger } from '../utils/logger.js';

export const SPEECH_PATH = '/speech/live';

// Nova-3 streaming, pay-as-you-go, dollars per minute of audio.
export const DOLLARS_PER_MINUTE = 0.0077;
// A microphone left on, not a message. Also the bound on one stream's cost.
export const MAX_SECONDS = 5 * 60;
// Audio that arrives before Deepgram answers is held, up to about half a minute.
const MAX_HELD_BYTES = 1024 * 1024;

export function speechCost(seconds) {
  return Number.isFinite(seconds) && seconds > 0 ? (seconds / 60) * DOLLARS_PER_MINUTE : 0;
}

export function deepgramUrl(sampleRate) {
  const params = new URLSearchParams({
    model: process.env.DEEPGRAM_MODEL || 'nova-3',
    // Russian and English in the same sentence, as people actually talk.
    language: process.env.DEEPGRAM_LANGUAGE || 'multi',
    encoding: 'linear16',
    sample_rate: String(sampleRate),
    channels: '1',
    interim_results: 'true',
    smart_format: 'true',
    punctuate: 'true',
  });
  return `wss://api.deepgram.com/v1/listen?${params}`;
}

function defaultConnect({ url, apiKey }) {
  return new WebSocket(url, { headers: { Authorization: `Token ${apiKey}` } });
}

const send = (ws, message) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
};

/**
 * @param {object} deps
 * @param {import('ws').WebSocketServer} deps.wss the speech socket server, not the graph one
 * @param {(token: string) => Promise<{ userId: string }>} deps.verifyToken
 * @param {object|null} deps.ledger the spend ledger; without one every stream is refused
 * @param {() => string|undefined} [deps.deepgramKey]
 * @param {(opts: { url: string, apiKey: string }) => object} [deps.connect] opens the upstream socket
 */
export function setupSpeechSocket({
  wss, verifyToken, ledger,
  deepgramKey = () => process.env.DEEPGRAM_API_KEY,
  connect = defaultConnect,
  maxSeconds = MAX_SECONDS,
  now = () => Date.now(),
}) {
  // One stream per person, as one chat turn per person: a stuck tab must not
  // run several meters at once.
  const streaming = new Set();

  wss.on('connection', (client) => {
    let userId = null;
    let upstream = null;
    let openedAt = null;
    let billedSeconds = null;
    let charged = false;
    let held = [];
    let heldBytes = 0;
    let limitTimer = null;
    let started = false;

    const fail = (reason, extra = {}) => {
      send(client, { type: 'ERROR', reason, ...extra });
      client.close();
    };

    async function settle() {
      if (charged || !userId) return;
      charged = true;
      clearTimeout(limitTimer);
      streaming.delete(userId);
      if (openedAt == null) return;
      // Deepgram reports what it processed when the stream closes; the wall
      // clock stands in when it does not, and never undercounts.
      const wall = (now() - openedAt) / 1000;
      const seconds = Math.max(billedSeconds ?? 0, wall);
      try {
        await ledger.record(userId, speechCost(seconds));
      } catch (error) {
        logger.error('Speech: could not record spend', { error: error.message });
      }
    }

    function finish() {
      clearTimeout(limitTimer);
      // Deepgram flushes the last words, sends its metadata, then closes.
      if (upstream?.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ type: 'CloseStream' }));
      else upstream?.close?.();
    }

    async function start(message) {
      const apiKey = deepgramKey();
      if (!apiKey || !ledger) return fail('unavailable');

      try {
        ({ userId } = await verifyToken(message.token));
      } catch {
        return fail('auth');
      }
      if (streaming.has(userId)) { userId = null; return fail('busy'); }
      const verdict = await ledger.check(userId);
      if (!verdict.allowed) { userId = null; return fail('quota', { scope: verdict.scope }); }
      streaming.add(userId);
      if (client.readyState !== WebSocket.OPEN) return settle();

      const rate = Number(message.sampleRate);
      const sampleRate = Number.isInteger(rate) && rate >= 8000 && rate <= 48000 ? rate : 16000;
      upstream = connect({ url: deepgramUrl(sampleRate), apiKey });

      upstream.on('open', () => {
        openedAt = now();
        for (const chunk of held) upstream.send(chunk);
        held = [];
        heldBytes = 0;
        send(client, { type: 'READY' });
        limitTimer = setTimeout(finish, maxSeconds * 1000);
        limitTimer.unref?.();
      });
      upstream.on('message', (data) => {
        let event;
        try { event = JSON.parse(data.toString()); } catch { return; }
        if (event.type === 'Results') {
          const text = event.channel?.alternatives?.[0]?.transcript ?? '';
          if (text || event.is_final) send(client, { type: 'TRANSCRIPT', text, isFinal: !!event.is_final });
        } else if (event.type === 'Metadata' && Number.isFinite(event.duration)) {
          billedSeconds = event.duration;
        }
      });
      upstream.on('error', (error) => {
        logger.error('Speech: upstream failed', { error: error.message });
        send(client, { type: 'ERROR', reason: 'upstream' });
      });
      upstream.on('close', async () => {
        await settle();
        send(client, { type: 'DONE' });
        client.close();
      });
    }

    client.on('message', (data, isBinary) => {
      if (isBinary) {
        // Frames sent while the token is checked are held too: the first word
        // is usually spoken before Deepgram has answered.
        if (!started) return;
        if (upstream?.readyState === WebSocket.OPEN) upstream.send(data);
        else if (heldBytes + data.length <= MAX_HELD_BYTES) { held.push(data); heldBytes += data.length; }
        return;
      }
      let message;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (message.type === 'START' && !started) {
        started = true;
        start(message).catch((error) => {
          logger.error('Speech: start failed', { error: error.message });
          settle().finally(() => fail('unavailable'));
        });
      } else if (message.type === 'STOP') {
        finish();
      }
    });

    // A closed tab stops the meter: the upstream is told to finish, and its
    // close charges what ran.
    client.on('close', () => {
      if (upstream && upstream.readyState !== WebSocket.CLOSED) finish();
      else settle();
    });
  });
}
