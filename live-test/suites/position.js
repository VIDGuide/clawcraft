/**
 * Suite: position
 * Verifies the bot has a real position from the server and that face/setpos update state.
 */
import { test, cmd, sleep, assert, assertNoError } from '../runner.js';

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

await test('face updates rotation toward a point', async () => {
  const posResp = await cmd('pos');
  assertNoError(posResp, 'pos before face');
  const { x, y, z } = posResp.pos;
  // Face a point 10 blocks east (+X)
  const resp = await cmd('face', { x: x + 10, y, z });
  assertNoError(resp, 'face');
  assert(typeof resp.yaw === 'number', 'face returns yaw');
  assert(typeof resp.pitch === 'number', 'face returns pitch');
  // After facing east, confirm pos/rotation updated
  const posAfter = await cmd('pos');
  assert(Math.abs(posAfter.yaw - resp.yaw) < 0.01, 'bot yaw updated after face');
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
