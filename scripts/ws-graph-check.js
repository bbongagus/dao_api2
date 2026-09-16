/**
 * Talk to a running server as one user: subscribe, print what it loaded, and
 * optionally send one operation or listen for what gets broadcast.
 *
 * Usage:
 *   node scripts/ws-graph-check.js ws://localhost:3013 dev-user-1
 *   node scripts/ws-graph-check.js ws://localhost:3013 dev-user-1 --send '{"type":"UPDATE_NODE","payload":{"id":"<node>","updates":{"title":"x"}}}'
 *   node scripts/ws-graph-check.js ws://localhost:3013 dev-user-1 --listen 30
 *
 * The user id is sent as it is. That is only acceptable against a local
 * server or a rehearsal; production is checked with graph-census.js.
 */

import { WebSocket } from 'ws';

import { countNodes } from '../src/ops/census.js';

const [url, userId, flag, value] = process.argv.slice(2);
if (!url || !userId || (flag && !['--send', '--listen'].includes(flag))) {
  console.error('Usage: node scripts/ws-graph-check.js <wsUrl> <userId> [--send <operation json> | --listen <seconds>]');
  process.exit(1);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ws = new WebSocket(url);

ws.on('error', (error) => {
  console.error(`❌ ${error.message}`);
  process.exit(1);
});

ws.on('message', (raw) => {
  const message = JSON.parse(raw);
  if (message.type === 'GRAPH_STATE') {
    const graph = message.payload;
    console.log(`GRAPH_STATE ${userId} main nodes=${countNodes(graph.nodes)} edges=${(graph.edges || []).length} version=${graph.version}`);
  } else if (message.type === 'OPERATION_APPLIED') {
    console.log(`OPERATION_APPLIED from=${message.clientId} ${JSON.stringify(message.payload)}`);
  } else if (message.type === 'OPERATION_ERROR' || message.type === 'ERROR') {
    console.log(`${message.type} ${message.error || message.message}`);
  }
});

ws.on('open', async () => {
  ws.send(JSON.stringify({ type: 'SUBSCRIBE', graphId: 'main', userId }));
  await wait(500);
  if (flag === '--send') {
    ws.send(JSON.stringify({ type: 'OPERATION', payload: JSON.parse(value) }));
    await wait(1000);
  } else if (flag === '--listen') {
    await wait(Number(value) * 1000);
  }
  ws.close();
  process.exit(0);
});
