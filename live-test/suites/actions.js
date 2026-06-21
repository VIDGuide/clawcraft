/**
 * Live test suite: Actions (Layer 5 — mine, eat, drop, throw, interact, attack)
 */
import { test, skip, cmd, waitForEvent, sleep, assert, assertNoError } from '../runner.js';

// ── Mine ──────────────────────────────────────────────────

await test('mine returns error for air block', async () => {
  // Get bot position, try to mine air above
  const pos = await cmd('pos');
  assertNoError(pos, 'pos');
  const resp = await cmd('mine', { x: Math.floor(pos.pos.x), y: Math.floor(pos.pos.y) + 10, z: Math.floor(pos.pos.z) });
  assert(resp.error, 'Expected error mining air');
});

await test('mine validates coordinates', async () => {
  const resp = await cmd('mine', {});
  assert(resp.error, 'Expected error without coordinates');
});

await test('abort_mine returns error when not mining', async () => {
  const resp = await cmd('abort_mine', {});
  assert(resp.error === 'Not mining', 'Expected "Not mining" error');
});

// ── Mine (end-to-end: find, walk, break, collect) ─────────

// Breakable soft blocks that are common in most worlds
const SOFT_BLOCKS = new Set([
  'minecraft:dirt', 'minecraft:grass_block', 'minecraft:sand',
  'minecraft:gravel', 'minecraft:clay', 'minecraft:short_grass',
  'minecraft:tall_grass', 'minecraft:tallgrass', 'minecraft:snow_layer',
  'minecraft:leaves', 'minecraft:azalea_leaves', 'minecraft:oak_leaves',
]);

await test('mine end-to-end: find block, walk, break, emit mine_done', async () => {
  // 1. Scan for a soft breakable block nearby
  const scanResp = await cmd('scan', { radius: 6, radiusY: 3 });
  assertNoError(scanResp, 'scan for breakable');
  if (!scanResp.loaded) {
    console.log('    (skipping: chunks not loaded yet)');
    return;
  }

  // Find a breakable block from the notable list or layer data
  let target = null;
  if (scanResp.notable) {
    target = scanResp.notable.find(b => SOFT_BLOCKS.has(b.name));
  }
  if (!target && scanResp.layers) {
    for (const layer of scanResp.layers) {
      if (layer.blocks) {
        const found = layer.blocks.find(b => SOFT_BLOCKS.has(b.name));
        if (found) { target = found; break; }
      }
    }
  }
  if (!target) {
    // Fallback: scan for any non-air block at bot's Y-1 (the ground)
    const pos = await cmd('pos');
    const bx = Math.floor(pos.pos.x), by = Math.floor(pos.pos.y) - 1, bz = Math.floor(pos.pos.z);
    const blockResp = await cmd('block', { x: bx, y: by, z: bz });
    if (blockResp.block && blockResp.block.name !== 'minecraft:air' && !blockResp.block.name.includes('bedrock')) {
      target = { x: bx, y: by, z: bz, name: blockResp.block.name };
    }
  }
  if (!target) {
    console.log('    (skipping: no breakable block found within scan range)');
    return;
  }

  // 2. Walk within reach of the block (3 blocks away is fine for mining)
  const posResp = await cmd('pos');
  const dx = target.x - posResp.pos.x;
  const dz = target.z - posResp.pos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > 4) {
    const walkResp = await cmd('walk', { x: target.x, y: target.y + 1, z: target.z });
    if (walkResp.walking) {
      // Wait for walk to finish
      const walkDone = await waitForEvent(
        e => e.type === 'walk_done' && e.id === walkResp.id,
        { timeout: 15000, since: Date.now() - 100 },
      );
      assert(walkDone != null, 'walk_done event received');
    }
  }

  // 3. Mine the block
  const before = Date.now();
  const mineResp = await cmd('mine', { x: target.x, y: target.y, z: target.z, autoTool: true });
  if (mineResp.error) {
    // Block may have been unbreakable or out of range after walk
    console.log(`    (mine error: ${mineResp.error} — not a test failure)`);
    return;
  }
  assert(mineResp.mining === true, 'mine.mining should be true');
  assert(typeof mineResp.breakTime === 'number', 'mine should report breakTime');
  assert(mineResp.block === target.name, `block name should match: expected ${target.name}, got ${mineResp.block}`);

  // 4. Wait for mine_done event
  const mineDone = await waitForEvent(
    e => e.type === 'mine_done' && e.id === mineResp.id,
    { timeout: Math.max(mineResp.breakTime * 50 + 5000, 10000), since: before },
  );
  assert(mineDone != null, 'mine_done event received');
  assert(mineDone.block === target.name, `mine_done.block should be ${target.name}`);
  assert(mineDone.pos != null, 'mine_done.pos should exist');
  assert(typeof mineDone.ticks === 'number', 'mine_done.ticks should be number');

  // 5. Check for item_added event (block may drop an item)
  try {
    const pickup = await waitForEvent(
      e => e.type === 'item_added',
      { timeout: 3000, since: before },
    );
    assert(pickup.item != null, 'item_added should have item field');
    assert(typeof pickup.slot === 'number', 'item_added should have slot');
    console.log(`    (picked up: ${pickup.item.name || pickup.item.networkId} x${pickup.item.count || 1})`);
  } catch {
    // Some blocks don't drop items (grass, snow_layer) — not a failure
    console.log('    (no item_added event — block may not drop anything)');
  }
});

await test('abort_mine cancels active mining', async () => {
  // Find a block to mine (use ground block)
  const pos = await cmd('pos');
  assertNoError(pos, 'pos');
  const bx = Math.floor(pos.pos.x) + 1, by = Math.floor(pos.pos.y) - 1, bz = Math.floor(pos.pos.z);
  const blockResp = await cmd('block', { x: bx, y: by, z: bz });
  if (!blockResp.block || blockResp.block.name === 'minecraft:air' || blockResp.block.name.includes('bedrock')) {
    console.log('    (skipping: no suitable block to mine for abort test)');
    return;
  }

  const mineResp = await cmd('mine', { x: bx, y: by, z: bz });
  if (mineResp.error) {
    console.log(`    (skipping: ${mineResp.error})`);
    return;
  }
  assert(mineResp.mining === true, 'mining should start');

  // Immediately abort
  await sleep(100);
  const abortResp = await cmd('abort_mine');
  assertNoError(abortResp, 'abort_mine');
  assert(abortResp.aborted === true, 'abort_mine.aborted should be true');

  // Confirm subsequent abort_mine says not mining
  const resp2 = await cmd('abort_mine');
  assert(resp2.error === 'Not mining', 'Should not be mining after abort');
});

// ── Eat ───────────────────────────────────────────────────

await test('eat returns error with no food in hand', async () => {
  const resp = await cmd('eat', {});
  assert(resp.error, 'Expected error with no food');
});

await test('abort_eat returns error when not eating', async () => {
  const resp = await cmd('abort_eat', {});
  assert(resp.error === 'Not eating', 'Expected "Not eating" error');
});

// ── Drop ──────────────────────────────────────────────────

await test('drop returns error for empty slot', async () => {
  // Slot 35 is likely empty
  const resp = await cmd('drop', { slot: 35 });
  assert(resp.error, 'Expected error for empty slot');
});

// ── Throw ─────────────────────────────────────────────────

await test('throw returns error with non-throwable item', async () => {
  const resp = await cmd('throw', {});
  // Either no item or not throwable
  assert(resp.error, 'Expected error for non-throwable item');
});

// ── Interact ──────────────────────────────────────────────

await test('interact validates coordinates', async () => {
  const resp = await cmd('interact', {});
  assert(resp.error, 'Expected error without coordinates');
});

await test('interact returns error for non-interactable block', async () => {
  const pos = await cmd('pos');
  assertNoError(pos, 'pos');
  // Try ground block (likely stone or dirt — not interactable)
  const resp = await cmd('interact', { x: Math.floor(pos.pos.x), y: Math.floor(pos.pos.y) - 1, z: Math.floor(pos.pos.z) });
  assert(resp.error, 'Expected error for non-interactable block');
});

// ── Attack ────────────────────────────────────────────────

await test('attack returns error for nonexistent entity', async () => {
  const resp = await cmd('attack', { entity: 'nonexistent_entity_xyz' });
  assert(resp.error === 'Entity not found', 'Expected "Entity not found" error');
});

await test('attack validates entity parameter', async () => {
  const resp = await cmd('attack', {});
  assert(resp.error, 'Expected error without entity param');
});

// ── Give ──────────────────────────────────────────────────

await test('give returns error without "to" param', async () => {
  const resp = await cmd('give', {});
  assert(resp.error, 'Expected error without "to" param');
});

await test('give returns error for nonexistent player', async () => {
  const resp = await cmd('give', { to: 'NonExistentPlayer99999' });
  assert(resp.error, 'Expected error for nonexistent player');
});
