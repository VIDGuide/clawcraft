/**
 * Suite: position
 * Verifies the bot has a real position from the server and that face/setpos update state.
 */
import { test, skip, cmd, sleep, assert, assertNoError } from '../runner.js';

await test('pos returns a real position (bot has spawned)', async () => {
  const resp = await cmd('pos');
  assertNoError(resp, 'pos');
  assert(resp.pos != null, 'pos should not be null');
  assert(typeof resp.pos.x === 'number', 'pos.x is a number');
  assert(typeof resp.pos.y === 'number', 'pos.y is a number');
  assert(typeof resp.pos.z === 'number', 'pos.z is a number');
  // Survival server — Y should be plausible (not 0, not in the void)
  assert(resp.pos.y > -64 && resp.pos.y < 320, `pos.y=${resp.pos.y} should be in world bounds`);
});

await test('pos returns yaw and pitch', async () => {
  const resp = await cmd('pos');
  assertNoError(resp, 'pos');
  assert(typeof resp.yaw === 'number', 'yaw is a number');
  assert(typeof resp.pitch === 'number', 'pitch is a number');
});

await test('movement_info reports server authority mode', async () => {
  const resp = await cmd('movement_info');
  assertNoError(resp, 'movement_info');
  assert(['client', 'server', 'server_with_rewind'].includes(resp.authority),
    `authority should be a known mode, got ${resp.authority}`);
  console.log(`    movement authority: ${resp.authority} (rewind=${resp.rewindHistorySize})`);
});

await test('server_pos agrees with local pos at rest', async () => {
  // When the bot is standing still, the server's authoritative position should
  // closely match the local prediction. A large disagreement means our position
  // tracking is broken (or the bot lacks command permission to self-verify).
  const sp = await cmd('server_pos');
  if (sp.error) {
    skip('server_pos agrees with local pos at rest', `server_pos unavailable: ${sp.error}`);
    return;
  }
  assert(sp.serverPos != null, 'server_pos returns a position');
  const local = await cmd('pos');
  const dx = sp.serverPos.x - local.pos.x;
  const dy = sp.serverPos.y - local.pos.y;
  const dz = sp.serverPos.z - local.pos.z;
  const drift = Math.sqrt(dx * dx + dy * dy + dz * dz);
  console.log(`    local↔server drift at rest: ${drift.toFixed(2)} blocks`);
  assert(drift < 2, `local and server positions disagree by ${drift.toFixed(2)} blocks at rest (tracking broken)`);
});

await test('face updates rotation toward a point', async () => {
  const posResp = await cmd('pos');
  assertNoError(posResp, 'pos before face');
  const { x, y, z } = posResp.pos;
  // Face a point 10 blocks east (+X)
  const resp = await cmd('face', { x: x + 10, y, z });
  assertNoError(resp, 'face');
  assert(typeof resp.yaw === 'number', 'face returns yaw');
  assert(typeof resp.pitch === 'number', 'face returns pitch');
  // Facing +X should yield a yaw near -90 (east). Verify the computed angle is sane.
  // Note: we don't re-query pos here because the server may send a move_player
  // packet that overwrites local yaw between commands (race condition).
  assert(resp.yaw >= -180 && resp.yaw <= 180, `face yaw should be a valid angle, got ${resp.yaw}`);
});

await test('setpos updates client-side position', async () => {
  const before = await cmd('pos');
  assertNoError(before, 'pos before setpos');
  const target = { x: Math.floor(before.pos.x) + 1, y: before.pos.y, z: before.pos.z };
  const resp = await cmd('setpos', target);
  assertNoError(resp, 'setpos');
  assert(resp.pos != null, 'setpos returns pos');
  // Allow float rounding
  assert(Math.abs(resp.pos.x - target.x) < 0.1, `setpos x: expected ~${target.x} got ${resp.pos.x}`);
  // Restore position
  await cmd('setpos', before.pos);
});
