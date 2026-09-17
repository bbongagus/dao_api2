/**
 * Talk to a running server as one user: subscribe, print what it loaded, and
 * optionally send one operation or listen for what gets broadcast.
 *
 * Usage (from dao_api2, so --env-file finds the dev key):
 *   node --env-file=.env scripts/ws-graph-check.js ws://localhost:3013 dev-user-1
 *   node --env-file=.env scripts/ws-graph-check.js ws://localhost:3013 dev-user-1 --send '{"type":"UPDATE_NODE","payload":{"id":"<node>","updates":{"title":"x"}}}'
 *   node --env-file=.env scripts/ws-graph-check.js ws://localhost:3013 dev-user-1 --listen 30
 *
 * The token is signed with the local dev key, so only a server that trusts
 * that key answers — a local one. Production is checked with graph-census.js.
 *
 * Exits 1 if no GRAPH_STATE arrives before the socket closes, so `$?` alone
 * tells you whether the server answered.
 */

import { WebSocket } from 'ws';

import { countNodes } from '../src/ops/census.js';
import { devTokenFromEnv } from '../src/auth/devToken.js';

const usage = 'Usage: node scripts/ws-graph-check.js <wsUrl> <userId> [--send <operation json> | --listen <seconds>]';

const [url, userId, flag, value] = process.argv.slice(2);
if (!url || !userId || (flag && (!['--send', '--listen'].includes(flag) || !value))) {
  console.error(usage);
  process.exit(1);
}

let token;
try {
  token = await devTokenFromEnv(userId);
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ws = new WebSocket(url);
let failed = false;
let gotGraphState = false;

ws.on('error', (error) => {
  // .message only: never the error object, never a raw stack trace.
  console.error(`❌ ${error.message}`);
  process.exit(1);
});

ws.on('message', (raw) => {
  try {
    const message = JSON.parse(raw);
    if (message.type === 'GRAPH_STATE') {
      gotGraphState = true;
      const graph = message.payload;
      console.log(`GRAPH_STATE ${userId} main nodes=${countNodes(graph.nodes)} edges=${(graph.edges || []).length} version=${graph.version}`);
    } else if (message.type === 'GRAPH_UPDATED') {
      const graph = message.payload;
      console.log(`GRAPH_UPDATED ${userId} main nodes=${countNodes(graph.nodes)} edges=${(graph.edges || []).length} version=${graph.version}`);
    } else if (message.type === 'OPERATION_APPLIED') {
      console.log(`OPERATION_APPLIED from=${message.clientId} ${JSON.stringify(message.payload)}`);
    } else if (message.type === 'AUTH_ERROR') {
      console.log('AUTH_ERROR the server does not trust this token');
      failed = true;
    } else if (message.type === 'OPERATION_ERROR' || message.type === 'ERROR') {
      console.log(`${message.type} ${message.error || message.message}`);
      failed = true;
    }
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
});

ws.on('open', async () => {
  try {
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', graphId: 'main', token }));
    await wait(500);
    if (flag === '--send') {
      ws.send(JSON.stringify({ type: 'OPERATION', payload: JSON.parse(value) }));
      await wait(1000);
    } else if (flag === '--listen') {
      await wait(Number(value) * 1000);
    }
    if (!gotGraphState) {
      console.error('no GRAPH_STATE received');
      failed = true;
    }
    ws.close();
    process.exit(failed ? 1 : 0);
  } catch (error) {
    console.error(`❌ ${error.message}`);
    process.exit(1);
  }
});
