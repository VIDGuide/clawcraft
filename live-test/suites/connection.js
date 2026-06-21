/**
 * Suite: connection
 * Verifies the bot is connected to the server, has spawned, and emits lifecycle events.
 */
import { test, cmd, assert, assertNoError, EVENTS_FILE } from '../runner.js';
import fs from 'fs';

await test('status responds without error', async () => {
  const resp = await cmd('status');
  assertNoError(resp, 'status');
  assert(typeof resp.uptime === 'number', 'uptime is a number');
  assert(resp.uptime >= 0, 'uptime >= 0');
});

await test('bot reports as connected', async () => {
  const resp = await cmd('status');
  assert(resp.connected === true, `connected should be true, got ${resp.connected}`);
});

await test('at least one chunk is loaded (server sent world data)', async () => {
  const resp = await cmd('status');
  assert(resp.chunks > 0, `chunks should be > 0, got ${resp.chunks}`);
});

await test('startup event was written to event file', async () => {
  assert(fs.existsSync(EVENTS_FILE), `event file ${EVENTS_FILE} should exist`);
  const lines = fs.readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean);
  const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const startup = events.find(e => e.type === 'startup');
  assert(startup != null, 'startup event should be in event file');
  assert(startup.version === '0.4.0', `startup.version should be 0.4.0, got ${startup.version}`);
  assert(typeof startup.timestamp === 'number', 'startup.timestamp should be a number');
});

await test('unknown action returns structured error (not crash)', async () => {
  const resp = await cmd('nonexistent_action_xyz');
  assert(resp.type === 'response', 'should return a response type');
  assert(typeof resp.error === 'string', 'should contain an error string');
  assert(resp.error.includes('Unknown action'), `error should mention Unknown action, got: ${resp.error}`);
});
