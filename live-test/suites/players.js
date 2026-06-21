/**
 * Suite: players
 * Verifies player awareness: roster command and player events.
 */
import { test, cmd, assert, assertNoError } from '../runner.js';

await test('players command returns valid structure', async () => {
  const resp = await cmd('players');
  assertNoError(resp, 'players');
  assert(Array.isArray(resp.players), 'players should be an array');
  assert(typeof resp.count === 'number', 'count should be a number');
  assert(resp.count === resp.players.length, 'count matches array length');
});

await test('players entries have expected fields', async () => {
  const resp = await cmd('players');
  assertNoError(resp, 'players');
  for (const p of resp.players) {
    assert(typeof p.name === 'string' && p.name.length > 0,
      `player should have a name, got: ${JSON.stringify(p)}`);
    assert(typeof p.uuid === 'string', `player ${p.name} should have uuid`);
    assert(typeof p.platform === 'string', `player ${p.name} should have platform`);
    assert(typeof p.joinedAt === 'number', `player ${p.name} should have joinedAt`);
  }
});

await test('bot is not in players roster', async () => {
  const status = await cmd('status');
  const self = status.username;
  const resp = await cmd('players');
  assertNoError(resp, 'players');
  const botInList = resp.players.some(p => p.name === self);
  assert(!botInList, `bot (${self}) should not appear in its own players roster`);
});
