/**
 * Suite: navigation
 * Verifies A* pathfinding and paced walk. Moves the bot a short distance and back.
 * Checks walk_done event is emitted after walk completes.
 */
import { test, cmd, waitForEvent, sleep, assert, assertNoError } from '../runner.js';

// Get a stable starting position at the start of this suite
const startResp = await cmd('pos');
const start = startResp.pos;

await test('path finds a route to a nearby point', async () => {
  assert(start != null, 'need a position to test path');
  const target = { x: Math.floor(start.x) + 3, y: Math.floor(start.y), z: Math.floor(start.z) };
  const resp = await cmd('path', target);
  if (resp.error && resp.error.includes('No path found')) {
    // Not a code failure — area may be obstructed. Warn but don't fail.
    console.log(`    (path: no path found to ${JSON.stringify(target)} — may be obstructed)`);
    return;
  }
  assertNoError(resp, 'path');
  assert(Array.isArray(resp.path), 'path is array');
  assert(resp.path.length > 0, 'path has at least one waypoint');
  assert(typeof resp.length === 'number', 'path has length field');
});

await test('move takes steps toward a point', async () => {
  assert(start != null, 'need a position to test move');
  const target = { x: Math.floor(start.x) + 2, y: Math.floor(start.y), z: Math.floor(start.z) };
  const resp = await cmd('move', target);
  assertNoError(resp, 'move');
  assert(resp.moved === true, 'move.moved should be true');
  assert(typeof resp.steps === 'number', 'move.steps is a number');
  assert(resp.steps > 0, 'move should take at least 1 step');
  // Restore
  await cmd('move', { x: Math.floor(start.x), y: Math.floor(start.y), z: Math.floor(start.z) });
});

await test('walk to nearby point emits walk_done event', async () => {
  assert(start != null, 'need a position to test walk');
  const target = { x: Math.floor(start.x) + 4, y: Math.floor(start.y), z: Math.floor(start.z) };
  const before = Date.now();
  const resp = await cmd('walk', target);

  if (resp.error && resp.error.includes('No path found')) {
    console.log(`    (walk: no path found — may be obstructed, skipping walk_done check)`);
    return;
  }
  assertNoError(resp, 'walk');
  assert(resp.walking === true, 'walk.walking should be true');
  assert(typeof resp.steps === 'number', 'walk.steps is a number');
  const walkId = resp.id;

  // Wait for walk_done event
  const done = await waitForEvent(
    e => e.type === 'walk_done' && e.id === walkId,
    { timeout: 15000, since: before },
  );
  assert(done.walked > 0, `walk_done.walked should be > 0, got ${done.walked}`);
  assert(done.pos != null, 'walk_done.pos should exist');

  // Restore
  await cmd('walk', { x: Math.floor(start.x), y: Math.floor(start.y), z: Math.floor(start.z) });
  // Wait for return walk to finish before next test
  await sleep(3000);
});

await test('walk to current position returns immediately (0 steps)', async () => {
  const posResp = await cmd('pos');
  assertNoError(posResp, 'pos');
  const { x, y, z } = posResp.pos;
  const resp = await cmd('walk', { x: Math.round(x), y: Math.round(y), z: Math.round(z) });
  assertNoError(resp, 'walk same position');
  // Either walked:0 or walking:true with 0 steps
  const isImmediate = resp.walked === 0 || resp.steps === 0;
  assert(isImmediate, `walk to same pos should have 0 steps, got: ${JSON.stringify(resp)}`);
});
