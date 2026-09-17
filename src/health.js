/**
 * Whether this server can actually do its job.
 *
 * Redis holds every graph, so a server that cannot reach it can answer almost
 * nothing — and until 2026-09-17 it said `{"status":"healthy","redis":false}`
 * anyway. A health check that cannot fail tells a platform nothing, which is
 * why `railway.json` can now point its healthcheck here.
 */
export function healthReport({ redisStatus, clients }) {
  const redisReady = redisStatus === 'ready';

  return {
    status: redisReady ? 200 : 503,
    body: {
      status: redisReady ? 'healthy' : 'degraded',
      redis: redisReady,
      websocket: clients,
      timestamp: new Date().toISOString(),
    },
  };
}

export default healthReport;
