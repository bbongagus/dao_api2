import { test } from 'node:test';
import assert from 'node:assert/strict';

import { healthReport } from './health.js';

test('a server with Redis behind it is healthy', () => {
  const { status, body } = healthReport({ redisStatus: 'ready', clients: 3 });

  assert.equal(status, 200);
  assert.equal(body.status, 'healthy');
  assert.equal(body.redis, true);
  assert.equal(body.websocket, 3);
});

test('a server without Redis is not healthy, whatever it can still answer', () => {
  // It said `{"status":"healthy","redis":false}` for two hours on 2026-09-17
  // while every graph read failed. A health check that cannot fail is not one.
  for (const redisStatus of ['connecting', 'reconnecting', 'end', 'close', undefined]) {
    const { status, body } = healthReport({ redisStatus, clients: 0 });

    assert.equal(status, 503, `status ${redisStatus} should be unhealthy`);
    assert.equal(body.status, 'degraded');
    assert.equal(body.redis, false);
  }
});

test('the report says when it was made', () => {
  const { body } = healthReport({ redisStatus: 'ready', clients: 0 });

  assert.ok(!Number.isNaN(Date.parse(body.timestamp)));
});
