import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createChunkCache,
  setChunk,
  scan,
  direction,
  raycast,
} from '../src/chunks.js';

/**
 * Create a fake chunk with known blocks for testing.
 */
function makeChunk(cx, cz, blocks = {}) {
  const subChunks = new Map();
  for (const [key, val] of Object.entries(blocks)) {
    const [lx, ly, lz] = key.split(',').map(Number);
    const cy = Math.floor((ly + 64) / 16);
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

console.error = () => {}; // suppress noise

describe('perception', () => {
  describe('scan', () => {
    it('returns empty scan when no chunks loaded', () => {
      const cache = createChunkCache();
      const result = scan(cache, 0, 64, 0);
      assert.equal(result.totalNonAir, 0);
      assert.equal(result.notable.length, 0);
      assert.equal(result.loaded, false);
      assert.ok(result.unloaded > 0);
    });

    it('reports loaded:true when all sub-chunks have data', () => {
      let cache = createChunkCache();
      // scan at y=64, radiusY=1 means y=63..65
      // y=63 -> cy=Math.floor((63+64)/16)=7, y=64..65 -> cy=8
      // radiusX/Z=1 means x=4..6, z=4..6 — all within chunk 0,0
      const subChunks = new Map();
      subChunks.set(7, 'air');
      subChunks.set(8, 'air');
      const chunk = { x: 0, z: 0, subChunks };
      cache = setChunk(cache, 0, 0, chunk);
      const result = scan(cache, 5, 64, 5, 1, 1, 1);
      assert.equal(result.loaded, true);
      assert.equal(result.unloaded, 0);
    });

    it('detects a single block', () => {
      let cache = createChunkCache();
      const chunk = makeChunk(0, 0, { [posKey(5, 64, 5)]: { stateId: 2532 } });
      cache = setChunk(cache, 0, 0, chunk);

      const result = scan(cache, 5, 64, 5, 2, 1, 2);
      assert.equal(result.totalNonAir, 1);
      assert.equal(result.layers['64'].length, 1);
      assert.ok(result.layers['64'][0].stateId === 2532);
    });

    it('tags notable blocks (ores, chests, etc.)', () => {
      let cache = createChunkCache();
      const chunk = makeChunk(0, 0, {
        [posKey(5, 64, 5)]: { stateId: 3203 },
        [posKey(6, 64, 5)]: { stateId: 7336 },
        [posKey(5, 64, 6)]: { stateId: 2532 },
      });
      cache = setChunk(cache, 0, 0, chunk);

      const result = scan(cache, 5, 64, 5, 2, 1, 2);
      assert.equal(result.notable.length, 3);
      const notableIds = result.notable.map(n => n.stateId).sort();
      assert.deepEqual(notableIds, [2532, 3203, 7336]);
    });

    it('detects walls at boundary', () => {
      let cache = createChunkCache();
      // Place a wall of stone at east boundary (x=7)
      const blocks = {};
      for (let y = 63; y <= 65; y++) {
        for (let z = 3; z <= 7; z++) {
          blocks[posKey(7, y, z)] = { stateId: 2532 };
        }
      }
      const chunk = makeChunk(0, 0, blocks);
      cache = setChunk(cache, 0, 0, chunk);

      const result = scan(cache, 5, 64, 5, 2, 1, 2);
      assert.ok(result.walls.east.length > 0);
      assert.equal(result.walls.west.length, 0);
    });
  });

  describe('direction', () => {
    it('returns blocks in facing direction (south)', () => {
      const cache = createChunkCache();
      // Yaw=0 = south (+Z)
      const result = direction(cache, { x: 0, y: 64, z: 0 }, 0, 0, 5);
      assert.equal(result.facing.z, 1); // pointing south
      assert.equal(result.blocks.length, 5);
      assert.equal(result.blocks[0].z, 1); // first block is at z+1
      assert.equal(result.blocks[4].z, 5); // fifth block at z+5
    });

    it('returns blocks in facing direction (east)', () => {
      const cache = createChunkCache();
      // Yaw=-PI/2 = east (+X)
      const result = direction(cache, { x: 0, y: 64, z: 0 }, -Math.PI / 2, 0, 3);
      assert.ok(result.facing.x > 0); // pointing east
      assert.equal(result.blocks.length, 3);
    });

    it('stops at first solid block', () => {
      let cache = createChunkCache();
      const chunk = makeChunk(0, 0, {
        [posKey(0, 64, 3)]: { stateId: 2532 },
      });
      cache = setChunk(cache, 0, 0, chunk);

      // Facing south from (0, 64, 0)
      const result = direction(cache, { x: 0, y: 64, z: 0 }, 0, 0, 10);
      // Should stop at block at z=3
      assert.equal(result.blocks.length, 3);
      assert.ok(result.blocks[result.blocks.length - 1].name.includes('2532'));
      assert.equal(result.firstObstacle.dist, 3);
      assert.equal(result.clear, false);
    });
  });

  describe('raycast', () => {
    it('returns clear for path through air', () => {
      const cache = createChunkCache();
      const result = raycast(cache, 0, 64, 0, 0, 64, 10);
      assert.equal(result.clear, true);
    });

    it('detects obstacles', () => {
      let cache = createChunkCache();
      const chunk = makeChunk(0, 0, {
        [posKey(0, 64, 5)]: { stateId: 2532 },
      });
      cache = setChunk(cache, 0, 0, chunk);

      const result = raycast(cache, 0, 64, 0, 0, 64, 10);
      assert.equal(result.clear, false);
      assert.equal(result.obstacle.z, 5);
      assert.ok(result.obstacle.name.includes('2532'));
    });

    it('returns clear for zero-distance path', () => {
      const cache = createChunkCache();
      const result = raycast(cache, 0, 64, 0, 0, 64, 0);
      assert.equal(result.clear, true);
      assert.equal(result.distance, 0);
    });
  });
});
