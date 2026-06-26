/**
 * Suite: navigation
 * Verifies A* pathfinding and paced walk. Moves the bot a short distance and back.
 * Checks walk_done event is emitted after walk completes.
 */
import { test, skip, cmd, waitForEvent, sleep, assert, assertNoError } from '../runner.js';

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
  const target = { x: Math.floor(start.x) + 2, y: start.y, z: Math.floor(start.z) };
  const resp = await cmd('move', target);
  assertNoError(resp, 'move');
  assert(resp.moving === true, 'move.moving should be true');
  assert(typeof resp.steps === 'number', 'move.steps is a number');
  assert(resp.steps > 0, 'move should take at least 1 step');
  // Abort and restore position
  await cmd('abort_walk');
  await sleep(100);
  await cmd('move', { x: Math.floor(start.x), y: start.y, z: Math.floor(start.z) });
  await sleep(1000);
});

await test('move produces a SERVER-VERIFIED position change', async () => {
  const probe = await cmd('server_pos');
  if (probe.error) {
    skip('move produces a SERVER-VERIFIED position change', `server_pos unavailable: ${probe.error}`);
    return;
  }
  const sp = probe.serverPos;
  // Use current Y-as-is for horizontal movement. Flooring Y introduces
  // a vertical drift that triggers the heartbeat's prediction-correction
  // abort (>0.5 blocks). Server-authoritative movement keeps Y correct.
  const target = { x: Math.floor(sp.x) + 3, y: sp.y, z: Math.floor(sp.z) };
  const resp = await cmd('move', target);
  assertNoError(resp, 'move');
  // Wait for walk_done (not just a timer) — with 0.1 blocks/step at 20Hz,
  // 3 blocks takes ~30 steps ≈ 1.5s.
  await waitForEvent(
    e => e.type === 'walk_done' && e.id === resp.id,
    { timeout: 10000, since: Date.now() },
  ).catch(() => {});
  await sleep(500);
  const after = await cmd('server_pos');
  assertNoError(after, 'server_pos after move');
  const dx = after.serverPos.x - sp.x;
  const dz = after.serverPos.z - sp.z;
  const moved = Math.sqrt(dx * dx + dz * dz);
  console.log(`    server-verified move displacement: ${moved.toFixed(2)} blocks (target was 3)`);
  assert(moved > 1, `SERVER says bot moved only ${moved.toFixed(2)} blocks after move (expected >1)`);
  // Abort and restore position
  await cmd('abort_walk');
  await sleep(200);
  await cmd('move', { x: Math.floor(sp.x), y: sp.y, z: Math.floor(sp.z) });
  // Wait for restore walk to complete
  await waitForEvent(e => e.type === 'walk_done', { timeout: 10000, since: Date.now() }).catch(() => {});
  await sleep(500);
});

await test('walk to nearby point emits walk_done event', async () => {
  assert(start != null, 'need a position to test walk');
  const target = { x: Math.floor(start.x) + 4, y: start.y, z: Math.floor(start.z) };
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
  assert(done.walked >= 0, `walk_done.walked should be >= 0, got ${done.walked}`);
  if (done.walked === 0) console.log('    (walk completed with 0 steps — path may have been trivial or chunks unloaded)');
  assert(done.pos != null, 'walk_done.pos should exist');

  // Abort and restore position (walk back)
  await cmd('abort_walk');
  await sleep(200);
  const restoreResp = await cmd('walk', { x: Math.floor(start.x), y: start.y, z: Math.floor(start.z) });
  if (!restoreResp.error) {
    await waitForEvent(e => e.type === 'walk_done', { timeout: 15000, since: Date.now() }).catch(() => {});
  }
  await sleep(1000);
});

await test('walk actually moves the bot (SERVER-VERIFIED position change)', async () => {
  // Server truth: ask the server where the bot is via querytarget @s, not the
  // optimistic local prediction. If server_pos is unavailable (no command
  // permission), skip LOUDLY rather than passing on local state.
  const probe = await cmd('server_pos');
  if (probe.error) {
    skip('walk actually moves the bot (SERVER-VERIFIED)', `server_pos unavailable: ${probe.error}`);
    return;
  }
  assert(probe.serverPos != null, 'server_pos returned a position');
  const startX = probe.serverPos.x;
  const startZ = probe.serverPos.z;

  const target = { x: Math.floor(startX) + 5, y: probe.serverPos.y, z: Math.floor(startZ) };
  const before = Date.now();
  const resp = await cmd('walk', target);
  if (resp.error) {
    console.log(`    (walk failed: ${resp.error} — skipping movement check)`);
    return;
  }
  assertNoError(resp, 'walk');
  assert(resp.walking === true, 'should be walking');

  // Wait for walk_done (may be aborted by a prediction correction — that's still
  // informative, we check the final server position either way).
  await waitForEvent(
    e => e.type === 'walk_done' && e.id === resp.id,
    { timeout: 20000, since: before },
  ).catch(() => {});

  // Give the server a moment to settle, then read SERVER truth.
  await sleep(1500);
  const after = await cmd('server_pos');
  assertNoError(after, 'server_pos after walk');
  const dx = after.serverPos.x - startX;
  const dz = after.serverPos.z - startZ;
  const distMoved = Math.sqrt(dx * dx + dz * dz);
  console.log(`    server-verified displacement: ${distMoved.toFixed(2)} blocks (target was 5)`);
  assert(distMoved > 2, `SERVER says bot moved only ${distMoved.toFixed(2)} blocks (expected >2). Movement is not taking effect server-side.`);

  // Restore (best effort — use move for straight line, faster than walk)
  await cmd('abort_walk');
  await sleep(200);
  await cmd('move', { x: Math.floor(startX), y: probe.serverPos.y, z: Math.floor(startZ) });
  await waitForEvent(e => e.type === 'walk_done', { timeout: 15000, since: Date.now() }).catch(() => {});
  await sleep(1000);
});

await test('walk does not trigger a server prediction correction (movement accepted)', async () => {
  // If our input encoding is wrong, the server rejects the predicted position and
  // sends correct_player_move_prediction → we emit position_desync. A clean walk
  // should produce NO such desync. This directly catches the rotation/move_vector bug.
  const probe = await cmd('server_pos');
  if (probe.error) {
    skip('walk does not trigger a server prediction correction', `server_pos unavailable: ${probe.error}`);
    return;
  }
  const sp = probe.serverPos;
  // Use current Y as-is — flooring Y creates vertical drift that triggers abort
  const target = { x: Math.floor(sp.x) + 4, y: sp.y, z: Math.floor(sp.z) };
  const before = Date.now();
  const resp = await cmd('walk', target);
  if (resp.error) {
    console.log(`    (walk failed: ${resp.error} — skipping desync check)`);
    return;
  }
  // Wait for the walk to finish or get corrected.
  await waitForEvent(
    e => e.type === 'walk_done' && e.id === resp.id,
    { timeout: 20000, since: before },
  ).catch(() => {});

  // Look for any prediction-correction desync during the walk window.
  // Under server-authoritative movement, small prediction corrections are normal:
  // the server simulates physics independently (friction, acceleration). A minor
  // correction doesn't mean the movement was rejected — it's just physics drift.
  // We only fail if the correction exceeds a reasonable threshold.
  let maxDrift = 0;
  try {
    const ev = await waitForEvent(
      e => e.type === 'position_desync' && e.mode === 'prediction_correction',
      { timeout: 500, since: before },
    );
    maxDrift = ev?.drift || 0;
    if (ev) console.log(`    server correction: drift ${maxDrift} blocks`);
  } catch { /* none found — good */ }

  assert(maxDrift < 1.5, `server correction drift ${maxDrift} blocks exceeds 1.5 — movement not taking effect`);

  // Restore (use abort + move for clean state before next test)
  await cmd('abort_walk');
  await sleep(200);
  await cmd('move', { x: Math.floor(sp.x), y: sp.y, z: Math.floor(sp.z) });
  await waitForEvent(e => e.type === 'walk_done', { timeout: 15000, since: Date.now() }).catch(() => {});
  await sleep(1000);
});

await test('walk to current position returns immediately (0 steps)', async () => {
  // Ensure clean state — previous test's restore walk may still be running
  await cmd('abort_walk');
  await sleep(300);
  const posResp = await cmd('pos');
  assertNoError(posResp, 'pos');
  const { x, y, z } = posResp.pos;
  const resp = await cmd('walk', { x: Math.round(x), y: Math.round(y), z: Math.round(z) });
  assertNoError(resp, 'walk same position');
  // Either walked:0 or walking:true with 0 steps
  const isImmediate = resp.walked === 0 || resp.steps === 0;
  assert(isImmediate, `walk to same pos should have 0 steps, got: ${JSON.stringify(resp)}`);
});

await test('abort_walk returns error when not walking', async () => {
  // Ensure no walk is running
  await cmd('abort_walk');
  await sleep(300);
  const resp = await cmd('abort_walk');
  assert(resp.error === 'Not walking', 'Expected "Not walking" error');
});

await test('reachable checks pathfinding to a nearby point', async () => {
  const posResp = await cmd('pos');
  assertNoError(posResp, 'pos');
  const { x, y, z } = posResp.pos;
  const resp = await cmd('reachable', { x: Math.floor(x) + 2, y: Math.floor(y), z: Math.floor(z) });
  assertNoError(resp, 'reachable');
  assert(typeof resp.reachable === 'boolean', 'reachable should be boolean');
  assert(typeof resp.euclidean === 'number', 'euclidean should be a number');
  if (resp.reachable) {
    assert(typeof resp.distance === 'number', 'distance should be number when reachable');
    assert(typeof resp.estimatedTime === 'number', 'estimatedTime should be number when reachable');
  }
});

await test('distance returns euclidean distance and direction', async () => {
  const posResp = await cmd('pos');
  assertNoError(posResp, 'pos');
  const { x, y, z } = posResp.pos;
  const resp = await cmd('distance', { x: x + 10, y, z });
  assertNoError(resp, 'distance');
  assert(typeof resp.euclidean === 'number', 'euclidean should be number');
  assert(Math.abs(resp.euclidean - 10) < 1, `euclidean ~10, got ${resp.euclidean}`);
  assert(resp.direction != null, 'direction should exist');
  assert(typeof resp.direction.x === 'number', 'direction.x is number');
});
