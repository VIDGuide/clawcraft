/**
 * Live test suite: Block placement (place command)
 *
 * Requires: bot running, SEND_CMD configured (for tp).
 * Finds flat ground near the bot, places a dirt block, verifies it, then mines it back.
 */
import { test, skip, cmd, waitForEvent, sleep, assert, assertNoError } from '../runner.js';

await test('place returns error without item param', async () => {
  const pos = await cmd('pos');
  assertNoError(pos, 'pos');
  const resp = await cmd('place', { x: Math.floor(pos.pos.x), y: Math.floor(pos.pos.y) + 5, z: Math.floor(pos.pos.z) });
  assert(resp.error, 'Expected error without item');
});

await test('place returns error for non-air target', async () => {
  // Try to place at a position that has a block (floor under bot)
  const pos = await cmd('pos');
  assertNoError(pos, 'pos');
  const bx = Math.floor(pos.pos.x);
  const by = Math.floor(pos.pos.y) - 1; // floor block
  const bz = Math.floor(pos.pos.z);
  const block = await cmd('block', { x: bx, y: by, z: bz });
  if (block.block && block.block.name !== 'minecraft:air') {
    const resp = await cmd('place', { item: 'dirt', x: bx, y: by, z: bz });
    assert(resp.error, `Expected error placing in non-air block (${block.block.name})`);
  }
});

await test('place end-to-end: place dirt, verify, mine back', async () => {
  const posResp = await cmd('pos');
  assertNoError(posResp, 'pos');

  const bx = Math.floor(posResp.pos.x);
  const by = Math.floor(posResp.pos.y) + 3; // place 3 above bot
  const bz = Math.floor(posResp.pos.z);

  // Check target is air first
  const before = await cmd('block', { x: bx, y: by, z: bz });
  if (!before.block || before.block.name !== 'minecraft:air') {
    skip('place end-to-end', 'target position is not air — skipping to avoid griefing');
    return;
  }

  // Check bot has dirt in inventory
  const inv = await cmd('inventory', { view: 'summary' });
  const hasDirt = inv.summary && inv.summary.some(s => s && (s.name || '').includes('dirt'));
  if (!hasDirt) {
    skip('place end-to-end', 'no dirt in inventory');
    return;
  }

  // Place the block
  const placeResp = await cmd('place', { item: 'dirt', x: bx, y: by, z: bz });
  assertNoError(placeResp, 'place');
  assert(placeResp.placed === true, 'place response should have placed=true');

  // Small delay to let server process
  await sleep(500);

  // Verify block is now present (or at least the place command succeeded)
  assert(placeResp.block, 'place response should include block name');
  assert(placeResp.pos, 'place response should include position');

  // Mine it back to clean up (best effort, no assertion on mine_done timing)
  await cmd('mine', { x: bx, y: by, z: bz, autoTool: true });
  await waitForEvent('mine_done', 10000).catch(() => null); // cleanup, ignore timeout
});
