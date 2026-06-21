/**
 * Suite: vision
 * Verifies block perception: scan, block, blocks, look, raycast, chunks.
 * Tests that the palette decoding works and block data is loaded from the live server.
 */
import { test, cmd, sleep, assert, assertNoError } from '../runner.js';

// Wait for sub-chunk data at current position (may follow teleport suite which moves the bot)
{
  let ready = false;
  for (let i = 0; i < 15; i++) {
    const s = await cmd('scan', { radius: 2, radiusY: 2 });
    if (s.loaded) { ready = true; break; }
    await sleep(1000);
  }
  if (!ready) process.stderr.write('    (vision: sub-chunk data not ready after 15s)\n');
}

await test('chunks are loaded around current position', async () => {
  // Allow time for chunks to arrive (especially after teleport in prior suite)
  let loaded = 0, total = 0;
  for (let i = 0; i < 15; i++) {
    const resp = await cmd('chunks', { radius: 2 });
    assertNoError(resp, 'chunks');
    assert(Array.isArray(resp.chunks), 'chunks response is an array');
    total = resp.chunks.length;
    loaded = resp.chunks.filter(c => c.loaded).length;
    if (loaded > 0) break;
    await sleep(1000);
  }
  assert(loaded > 0, `at least 1 chunk should be loaded, got ${loaded} out of ${total}`);
});

await test('scan returns data (not all-unloaded)', async () => {
  const resp = await cmd('scan', { radius: 3, radiusY: 2 });
  assertNoError(resp, 'scan');
  assert(typeof resp.totalNonAir === 'number', 'scan has totalNonAir');
  assert(typeof resp.loaded === 'boolean', 'scan has loaded field');
  assert(typeof resp.unloaded === 'number', 'scan has unloaded field');
  assert(typeof resp.total === 'number', 'scan has total field');
  assert(resp.total > 0, 'scan.total should be > 0');
});

await test('scan loaded:true after waiting for chunk data', async () => {
  // Sub-chunks take time to arrive after connection — retry with scan at bot position
  let resp;
  for (let i = 0; i < 15; i++) {
    resp = await cmd('scan', { radius: 2, radiusY: 2 });
    if (resp.loaded) break;
    await sleep(1000);
  }
  assertNoError(resp, 'scan loaded check');
  assert(resp.loaded === true, `scan.loaded should be true after waiting; unloaded=${resp.unloaded}/${resp.total}`);
});

await test('scan finds non-air blocks (bot is not floating in empty space)', async () => {
  // Retry — sub-chunk data needs time to arrive
  let resp;
  for (let i = 0; i < 10; i++) {
    resp = await cmd('scan', { radius: 3, radiusY: 3 });
    if (resp.totalNonAir > 0) break;
    await sleep(1000);
  }
  assertNoError(resp, 'scan');
  assert(resp.totalNonAir > 0, `expected some non-air blocks, got totalNonAir=${resp.totalNonAir}`);
});

await test('scan notable blocks have name and coordinates', async () => {
  const resp = await cmd('scan', { radius: 3, radiusY: 2 });
  assertNoError(resp, 'scan');
  if (resp.notable.length > 0) {
    const b = resp.notable[0];
    assert(typeof b.name === 'string' && b.name.length > 0, `notable block should have a name, got: ${JSON.stringify(b)}`);
    assert(typeof b.x === 'number', 'notable block has x');
    // stateId is intentionally excluded from perception output — LLMs consume the
    // text block name, not numeric state ids.
    assert(b.stateId === undefined, 'notable block should not expose numeric stateId');
    // Block name should be a proper minecraft: identifier, not "state_NNNN"
    const hasProperName = resp.notable.some(bl => bl.name.startsWith('minecraft:'));
    assert(hasProperName, 'at least one notable block should have a resolved minecraft: name (palette working)');
  }
});

await test('block query at current position returns a result', async () => {
  const posResp = await cmd('pos');
  assertNoError(posResp, 'pos');
  const { x, y, z } = posResp.pos;
  // Query the block the bot is standing on (one below feet)
  const resp = await cmd('block', { x: Math.floor(x), y: Math.floor(y) - 1, z: Math.floor(z) });
  assertNoError(resp, 'block');
  assert(resp.pos != null, 'block response has pos');
  // Block may be null if sub-chunk not loaded yet, but should not be an error
  if (resp.block !== null) {
    assert(typeof resp.block.name === 'string', 'block has a name');
    assert(resp.block.name.startsWith('minecraft:'), `block name should be a minecraft: identifier, got: ${resp.block.name}`);
  }
});

await test('look returns blocks in facing direction', async () => {
  const resp = await cmd('look', { distance: 5 });
  assertNoError(resp, 'look');
  assert(Array.isArray(resp.blocks), 'look.blocks is array');
  assert(resp.blocks.length > 0, 'look returns at least 1 block entry');
  assert(typeof resp.facing === 'object', 'look.facing is object');
  assert(typeof resp.clear === 'boolean', 'look.clear is boolean');
});

await test('raycast from bot to a point 5 blocks ahead', async () => {
  const posResp = await cmd('pos');
  assertNoError(posResp, 'pos');
  const { x, y, z } = posResp.pos;
  const resp = await cmd('raycast', { x: x + 5, y, z });
  assertNoError(resp, 'raycast');
  assert(typeof resp.clear === 'boolean', 'raycast.clear is boolean');
  assert(typeof resp.distance === 'number', 'raycast.distance is number');
});

await test('blocks returns cuboid of blocks', async () => {
  const posResp = await cmd('pos');
  assertNoError(posResp, 'pos');
  const { x, y, z } = posResp.pos;
  const fx = Math.floor(x), fy = Math.floor(y), fz = Math.floor(z);
  const resp = await cmd('blocks', { x1: fx, y1: fy - 1, z1: fz, x2: fx + 2, y2: fy, z2: fz + 2 });
  assertNoError(resp, 'blocks');
  assert(typeof resp.count === 'number', 'blocks has count');
  assert(Array.isArray(resp.blocks), 'blocks is array');
  if (resp.blocks.length > 0) {
    const b = resp.blocks[0];
    assert(typeof b.x === 'number', 'block entry has x');
    assert(typeof b.name === 'string', 'block entry has name');
  }
});
