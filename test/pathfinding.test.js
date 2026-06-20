import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findPath } from '../src/pathfinding.js';
import { createChunkCache, setChunk } from '../src/chunks.js';

/**
 * Make a fake chunk with specified blocks.
 * blocks is a map of "localX,localY,localZ" → block object.
 */
function makeChunk(cx, cz, blocks = {}) {
  const subChunks = new Map();
  for (const [key, val] of Object.entries(blocks)) {
    const [lx, ly, lz] = key.split(',').map(Number);
    const cy = Math.floor(ly / 16);
    if (!subChunks.has(cy)) subChunks.set(cy, new Uint32Array(4096));
    const idx = (lx << 8) | (lz << 4) | (ly & 0xf);
    subChunks.get(cy)[idx] = val.stateId ?? 0;
  }
  return { x: cx, z: cz, subChunks };
}

function posKey(x, y, z) {
  const lx = ((x % 16) + 16) % 16;
  const lz = ((z % 16) + 16) % 16;
  return `${lx},${y},${lz}`;
}

function cacheWithFloor(floorY = 63, bounds = 5) {
  let cache = createChunkCache();
  const blocks = {};
  // Solid floor (stone=2532 in Bedrock 1.21)
  for (let x = -bounds; x <= bounds; x++) {
    for (let z = -bounds; z <= bounds; z++) {
      blocks[posKey(x, floorY, z)] = { stateId: 2532 };
    }
  }
  cache = setChunk(cache, 0, 0, makeChunk(0, 0, blocks));
  return cache;
}

describe('pathfinding', () => {
  it('returns start when already at target', () => {
    const cache = cacheWithFloor();
    const path = findPath(cache, 0, 64, 0, 0, 64, 0);
    assert.equal(path.length, 1);
    assert.deepEqual(path[0], { x: 0, y: 64, z: 0 });
  });

  it('finds straight path on open ground', () => {
    const cache = cacheWithFloor();
    const path = findPath(cache, 0, 64, 0, 5, 64, 0);

    assert.ok(path, 'Path should be found');
    assert.equal(path.length, 6); // steps: (1,0,0) → (2,0,0) → ... → (5,0,0)
    assert.deepEqual(path[path.length - 1], { x: 5, y: 64, z: 0 });
  });

});

describe('pathfinding (with proper setup)', () => {
  function buildCache(blockMap) {
    let cache = createChunkCache();
    cache = setChunk(cache, 0, 0, makeChunk(0, 0, blockMap));
    return cache;
  }

  it('walks around a single wall', () => {
    // Open ground with a wall at x=3, z=-2..2 (not full width, so path can go around)
    const blocks = {};
    // Floor
    for (let x = -5; x <= 10; x++) {
      for (let z = -5; z <= 5; z++) {
        blocks[posKey(x, 63, z)] = { name: 'stone', stateId: 1 };
      }
    }
    // Wall at x=3, only z=-2..2 (leaves gaps at edges to walk around)
    for (let z = -2; z <= 2; z++) {
      blocks[posKey(3, 64, z)] = { name: 'stone', stateId: 1 };
      blocks[posKey(3, 65, z)] = { name: 'stone', stateId: 1 };
    }

    const cache = buildCache(blocks);
    const path = findPath(cache, 0, 64, 0, 6, 64, 0);

    assert.ok(path, 'Should find path around wall');
    assert.equal(path[path.length - 1].x, 6);

    // Verify path doesn't go through the wall at x=3
    for (const step of path) {
      if (step.x === 3) {
        assert.notEqual(step.z, 0, 'Should not walk through wall at z=0');
      }
    }
  });
});
