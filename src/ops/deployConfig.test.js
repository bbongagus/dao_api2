import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Railway still stores `node src/simple-server.js` as the `web` service's start
 * command, left over from before the move of 2026-09-16 — and that file was
 * deleted on 2026-09-17. Config in code wins, so `railway.json` is the only
 * thing keeping production off it, and the dashboard field cannot be cleared
 * while `railway.json` defines it. Drop this line and the next deploy
 * crash-loops on a file that is not there.
 */
const railway = JSON.parse(readFileSync(new URL('../../railway.json', import.meta.url), 'utf8'));

test('railway.json starts a server file that exists', () => {
  const command = railway.deploy?.startCommand;

  assert.equal(command, 'node src/server.js');

  const entry = command.split(' ').at(-1);
  assert.ok(existsSync(new URL(`../../${entry}`, import.meta.url)), `${entry} is missing`);
});
