import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
  createChunkCache,
  chunkKey,
  chunkKeyFromPos,
  setChunk,
  getChunk,
  getChunkAt,
  getBlock,
  getBlocks,
  chunkStatus,
} from '../src/chunks.js';

/**
 * Create a minimal fake chunk for testing.
 * prismarine-chunk Chunks have getBlock(lx, ly, lz) which
 * returns { name, stateId, properties }.
 */
function fakeChunk(cx, cz, blocks = {}) {
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

describe('chunks', () => {
  describe('chunkKey', () => {
    it('computes chunk key from world coords', () => {
      assert.equal(chunkKey(0, 0), '0,0');
      assert.equal(chunkKey(15, 15), '0,0');
      assert.equal(chunkKey(16, 16), '1,1');
      assert.equal(chunkKey(-1, -1), '-1,-1');
      assert.equal(chunkKey(-16, -16), '-1,-1');
      assert.equal(chunkKey(50, -30), '3,-2');
    });
  });

  describe('chunkKeyFromPos', () => {
    it('computes chunk key from chunk coords', () => {
      assert.equal(chunkKeyFromPos(0, 0), '0,0');
      assert.equal(chunkKeyFromPos(3, -2), '3,-2');
    });
  });

  describe('createChunkCache', () => {
    it('creates empty cache', () => {
      const cache = createChunkCache();
      assert.equal(cache.chunks.size, 0);
      assert.equal(cache.blockEntities.size, 0);
    });
  });

  describe('setChunk / getChunk / getChunkAt', () => {
    it('stores and retrieves chunks by chunk coords', () => {
      let cache = createChunkCache();
      const chunk = fakeChunk(0, 0);
      cache = setChunk(cache, 0, 0, chunk);
      assert.equal(getChunk(cache, 0, 0), chunk);
    });

    it('retrieves chunk by world coords', () => {
      let cache = createChunkCache();
      const chunk = fakeChunk(1, 2);
      cache = setChunk(cache, 1, 2, chunk);
      assert.equal(getChunkAt(cache, 25, 40), chunk); // chunk 1,2
    });

    it('returns undefined for missing chunks', () => {
      const cache = createChunkCache();
      assert.equal(getChunk(cache, 99, 99), undefined);
      assert.equal(getChunkAt(cache, 999, 999), undefined);
    });
  });

  describe('getBlock', () => {
    it('returns null for unloaded chunks', () => {
      const cache = createChunkCache();
      assert.equal(getBlock(cache, 0, 64, 0), null);
    });

    it('queries blocks from loaded chunks', () => {
      let cache = createChunkCache();
      const block = { stateId: 1 };
      const chunk = fakeChunk(0, 0, { '0,64,0': block });
      cache = setChunk(cache, 0, 0, chunk);
      const result = getBlock(cache, 0, 64, 0);
      assert.equal(result.stateId, 1);
    });

    it('maps negative world coords to local coords', () => {
      let cache = createChunkCache();
      const chunk = fakeChunk(-1, -1, { '15,0,15': { stateId: 2 } });
      cache = setChunk(cache, -1, -1, chunk);
      // World coord (-1, 0, -1) maps to local (15, 0, 15) in chunk -1,-1
      const result = getBlock(cache, -1, 0, -1);
      assert.equal(result.stateId, 2);
    });

    it('returns air object for air sentinel sub-chunks', () => {
      let cache = createChunkCache();
      const chunk = { x: 0, z: 0, subChunks: new Map() };
      // cy for Y=133 is Math.floor((133+64)/16) = 12
      chunk.subChunks.set(12, 'air');
      cache = setChunk(cache, 0, 0, chunk);
      const result = getBlock(cache, 0, 133, 0);
      assert.notEqual(result, null);
      assert.equal(result.name, 'minecraft:air');
    });

    it('returns null for sub-chunks not in the map (truly unloaded)', () => {
      let cache = createChunkCache();
      const chunk = { x: 0, z: 0, subChunks: new Map() };
      cache = setChunk(cache, 0, 0, chunk);
      const result = getBlock(cache, 0, 133, 0);
      assert.equal(result, null);
    });
  });

  describe('getBlocks', () => {
    it('returns empty for unloaded area', () => {
      const cache = createChunkCache();
      assert.deepEqual(getBlocks(cache, 0, 0, 0, 10, 10, 10), []);
    });

    it('returns blocks in area', () => {
      let cache = createChunkCache();
      const chunk = fakeChunk(0, 0, {
        '5,64,5': { stateId: 3 },
        '6,64,6': { stateId: 1 },
      });
      cache = setChunk(cache, 0, 0, chunk);

      const results = getBlocks(cache, 0, 64, 0, 15, 64, 15);
      assert.equal(results.length, 2);
      const ids = results.map(r => r.stateId).sort();
      assert.deepEqual(ids, [1, 3]);
    });
  });

  describe('chunkStatus', () => {
    it('reports loaded/unloaded chunks around a position', () => {
      let cache = createChunkCache();
      cache = setChunk(cache, 0, 0, fakeChunk(0, 0));
      cache = setChunk(cache, 1, 0, fakeChunk(1, 0));

      const status = chunkStatus(cache, 8, 8, 2);
      const loaded = status.filter(s => s.loaded);
      const unloaded = status.filter(s => !s.loaded);

      assert.equal(loaded.length, 2); // 0,0 and 1,0
      assert.equal(unloaded.length, 23); // 25 total - 2 loaded
    });
  });
});
