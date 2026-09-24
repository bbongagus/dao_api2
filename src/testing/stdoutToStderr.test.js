import { test } from 'node:test';
import assert from 'node:assert/strict';

// Node 22's runner reads each test file's stdout as a stream of framed
// messages, and loses a frame when a read ends on the first byte of one right
// after text of ours ("Unable to deserialize cloned data", a whole file lost).
// `npm test` preloads stdoutToStderr.js so no text of ours reaches stdout.
test('under npm test, console output goes to stderr, not the runner\'s stdout', () => {
  assert.equal(process.env.NODE_TEST_CONTEXT, 'child-v8');

  const written = { stdout: '', stderr: '' };
  const originals = { stdout: process.stdout.write, stderr: process.stderr.write };
  process.stdout.write = (chunk, ...rest) => { written.stdout += chunk; return originals.stdout.call(process.stdout, chunk, ...rest); };
  process.stderr.write = (chunk, ...rest) => { written.stderr += chunk; return originals.stderr.call(process.stderr, chunk, ...rest); };
  try {
    console.log('a log line');
    console.info('an info line');
  } finally {
    process.stdout.write = originals.stdout;
    process.stderr.write = originals.stderr;
  }

  assert.equal(written.stdout, '');
  assert.match(written.stderr, /a log line/);
  assert.match(written.stderr, /an info line/);
});
