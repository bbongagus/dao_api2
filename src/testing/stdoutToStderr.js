/**
 * Preloaded by `npm test`: inside a test file's process, console output goes
 * to stderr.
 *
 * Node 22's runner reads a test file's stdout as framed messages. When a read
 * ends on the first byte of a frame (0xFF) right after text we printed, it
 * files that byte away as text and deserializes from the wrong place:
 * "Unable to deserialize cloned data due to invalid or unsupported version",
 * and the whole file counts as failed. Fixed in Node after 22; until then no
 * text of ours goes to stdout. Only the test file's process is touched — the
 * runner itself marks it with NODE_TEST_CONTEXT.
 */
import { Console } from 'node:console';

if (process.env.NODE_TEST_CONTEXT === 'child-v8') {
  globalThis.console = new Console({ stdout: process.stderr, stderr: process.stderr });
}
