import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../src/commands.js';
import { createChunkCache, setChunk } from '../src/chunks.js';
import { createEntityTracker } from '../src/entities.js';
import { createState, setPosition } from '../src/state.js';
import { createInventory } from '../src/inventory.js';
import { createVitals } from '../src/vitals.js';
import { createSubscriptions } from '../src/subscriptions.js';
import { AIR_ID } from '../src/constants.js';

/**
 * Build a chunk cache with solid ground at y=63 and air above,
 * covering chunk 0,0 (world x=0..15, z=0..15).
 */
function buildWalkableCache() {
  let cache = createChunkCache();
  const subChunks = new Map();
  // sub-chunk 3 (y=48..63): fill y=63 with solid
  const sub3 = new Uint32Array(4096);
  for (let x = 0; x < 16; x++) {
    for (let z = 0; z < 16; z++) {
      const idx = (x << 8) | (z << 4) | 15; // ly=15 → y=63
      sub3[idx] = 2532; // stone
    }
  }
  subChunks.set(3, sub3);
  // sub-chunk 4 (y=64..79): air sentinel
  subChunks.set(4, 'air');
  cache = setChunk(cache, 0, 0, { x: 0, z: 0, subChunks });
  return cache;
}

describe('walk position sync', () => {
  it('setState is called during walk so pos reflects movement', async () => {
    const chunkCache = buildWalkableCache();
    let moduleState = { ...createState(), pos: { x: 2, y: 64, z: 2 }, runtimeId: 1n };
    const stateUpdates = [];

    const ctx = {
      client: { queue: () => {} },
      state: moduleState,
      tracker: createEntityTracker(),
      chunkCache,
      inventory: createInventory(),
      vitals: createVitals(),
      itemPalette: null,
      USERNAME: 'TestBot',
      SEND_CMD: null,
      startedAt: Date.now(),
      execFileSync: () => {},
      emitEvent: () => {},
      itemToRaw: () => ({ network_id: 0 }),
      getActiveMine: () => null,
      setActiveMine: () => {},
      getActiveEat: () => null,
      setActiveEat: () => {},
      getActiveWalk: () => ctx._walk,
      setActiveWalk: (v) => { ctx._walk = v; },
      setIgnoreMoveUntil: () => {},
      getLastDeath: () => null,
      setState: (s) => { moduleState = s; stateUpdates.push({ ...s.pos }); },
      getTick: () => 0n,
      requestSubChunksNear: () => {},
      queueBlockAction: () => {},
      subscriptions: createSubscriptions(),
      setSubscriptions: () => {},
      _walk: null,
    };

    let response = null;
    handle({ action: 'walk', x: 5, y: 64, z: 2 }, ctx, (r) => { response = r; });

    assert.equal(response.walking, true, 'walk should start');
    assert.ok(response.steps > 0, 'should have steps');

    // Wait for walk to complete (steps * 50ms + buffer)
    await new Promise(r => setTimeout(r, response.steps * 50 + 200));

    // moduleState should now reflect the final position (updated via setState)
    assert.ok(stateUpdates.length > 0, 'setState should have been called during walk');
    // Final position should be near the target
    const finalPos = moduleState.pos;
    assert.ok(Math.abs(finalPos.x - 5) < 1.5, `x should be near 5, got ${finalPos.x}`);
    assert.equal(finalPos.z, 2, 'z should stay at 2');
  });

  it('pos command returns updated position after walk completes', async () => {
    const chunkCache = buildWalkableCache();
    let moduleState = { ...createState(), pos: { x: 2, y: 64, z: 2 }, runtimeId: 1n };

    const ctx = {
      client: { queue: () => {} },
      state: moduleState,
      tracker: createEntityTracker(),
      chunkCache,
      inventory: createInventory(),
      vitals: createVitals(),
      itemPalette: null,
      USERNAME: 'TestBot',
      SEND_CMD: null,
      startedAt: Date.now(),
      execFileSync: () => {},
      emitEvent: () => {},
      itemToRaw: () => ({ network_id: 0 }),
      getActiveMine: () => null,
      setActiveMine: () => {},
      getActiveEat: () => null,
      setActiveEat: () => {},
      getActiveWalk: () => ctx._walk,
      setActiveWalk: (v) => { ctx._walk = v; },
      setIgnoreMoveUntil: () => {},
      getLastDeath: () => null,
      setState: (s) => { moduleState = s; },
      getTick: () => 0n,
      requestSubChunksNear: () => {},
      queueBlockAction: () => {},
      subscriptions: createSubscriptions(),
      setSubscriptions: () => {},
      _walk: null,
    };

    // Start walk
    let walkResp = null;
    handle({ action: 'walk', x: 5, y: 64, z: 2 }, ctx, (r) => { walkResp = r; });
    assert.equal(walkResp.walking, true);

    // Wait for completion
    await new Promise(r => setTimeout(r, walkResp.steps * 50 + 200));

    // Simulate what bot.js does: create a new ctx from moduleState for pos command
    const ctx2 = { ...ctx, state: moduleState };
    let posResp = null;
    handle({ action: 'pos' }, ctx2, (r) => { posResp = r; });

    // Position should NOT be the original spawn coords
    assert.ok(Math.abs(posResp.pos.x - 5) < 1.5,
      `pos should reflect walked position (~5), got ${posResp.pos.x}`);
  });
});
