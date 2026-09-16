/**
 * Send one message to every open socket of one user's graph.
 *
 * Every user's default graph is called "main", so a recipient has to match on
 * the user as well as the graph — matching on the graph alone once pushed each
 * user's operations to every other connected user. This is the one place that
 * decides who hears about a change.
 */

const OPEN = 1; // WebSocket.OPEN

export function broadcastToGraph(clients, { userId, graphId }, message) {
  if (!userId || !graphId) return 0;

  const data = typeof message === 'string' ? message : JSON.stringify(message);
  let reached = 0;
  for (const client of clients.values()) {
    if (client.userId === userId && client.graphId === graphId && client.ws.readyState === OPEN) {
      client.ws.send(data);
      reached++;
    }
  }
  return reached;
}
