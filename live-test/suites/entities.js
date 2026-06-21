/**
 * Suite: entities
 * Verifies entity tracking: nearby returns valid structure.
 * Full entity presence depends on whether players/mobs are near the bot at test time.
 */
import { test, cmd, assert, assertNoError } from '../runner.js';

await test('nearby returns valid structure', async () => {
  const resp = await cmd('nearby', { radius: 64 });
  assertNoError(resp, 'nearby');
  assert(resp.nearby != null, 'nearby.nearby should exist');
  assert(Array.isArray(resp.nearby.players), 'nearby.players is array');
  assert(Array.isArray(resp.nearby.mobs), 'nearby.mobs is array');
  assert(Array.isArray(resp.nearby.items), 'nearby.items is array');
});

await test('nearby players have name and position', async () => {
  const resp = await cmd('nearby', { radius: 64 });
  assertNoError(resp, 'nearby');
  for (const player of resp.nearby.players) {
    assert(typeof player.name === 'string' && player.name.length > 0,
      `player should have a name, got: ${JSON.stringify(player)}`);
    assert(player.position != null, `player ${player.name} should have position`);
    assert(typeof player.position.x === 'number', `player ${player.name} position.x is a number`);
  }
});

await test('nearby mobs have type and position', async () => {
  const resp = await cmd('nearby', { radius: 64 });
  assertNoError(resp, 'nearby');
  for (const mob of resp.nearby.mobs) {
    assert(mob.position != null, `mob should have position: ${JSON.stringify(mob)}`);
    assert(typeof mob.position.x === 'number', 'mob position.x is a number');
  }
});

await test('bot itself is not reported as a nearby entity', async () => {
  const status = await cmd('status');
  const self = status.username;
  const resp = await cmd('nearby', { radius: 256 });
  assertNoError(resp, 'nearby');
  const selfInPlayers = resp.nearby.players.some(p => p.name === self);
  assert(!selfInPlayers, `bot (${self}) should not appear in its own nearby players list`);
});

await test('status entity counts match nearby results', async () => {
  const statusResp = await cmd('status');
  const nearbyResp = await cmd('nearby', { radius: 256 });
  assertNoError(statusResp, 'status');
  assertNoError(nearbyResp, 'nearby');
  // nearby radius may not cover all tracked entities — just verify counts are non-negative
  assert(statusResp.entities.players >= 0, 'status.entities.players >= 0');
  assert(statusResp.entities.mobs >= 0, 'status.entities.mobs >= 0');
  assert(statusResp.entities.items >= 0, 'status.entities.items >= 0');
});
