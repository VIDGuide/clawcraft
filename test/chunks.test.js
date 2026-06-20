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
  return {
    x: cx,
    z: cz,
    getBlock(lx, ly, lz) {
      const key = `${lx},${ly},${lz}`;
      if (blocks[key]) return blocks[key];
      return { name: 'air', stateId: 0, properties: {} };
    },
  };
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
      const block = { name: 'stone', stateId: 1, properties: {} };
      const chunk = fakeChunk(0, 0, { '0,64,0': block });
      cache = setChunk(cache, 0, 0, chunk);
      assert.deepEqual(getBlock(cache, 0, 64, 0), block);
    });

    it('maps negative world coords to local coords', () => {
      let cache = createChunkCache();
      const block = { name: 'deepslate', stateId: 2, properties: {} };
      const chunk = fakeChunk(-1, -1, { '15,0,15': block });
      cache = setChunk(cache, -1, -1, chunk);
      // World coord (-1, 0, -1) maps to local (15, 0, 15) in chunk -1,-1
      assert.deepEqual(getBlock(cache, -1, 0, -1), block);
    });
  });

  describe('getBlocks', () => {
    it('returns empty for unloaded area', () => {
      const cache = createChunkCache();
      assert.deepEqual(getBlocks(cache, 0, 0, 0, 10, 10, 10), []);
    });

    it('filters by block name', () => {
      let cache = createChunkCache();
      const diamond = { name: 'diamond_ore', stateId: 3, properties: {} };
      const stone = { name: 'stone', stateId: 1, properties: {} };
      const chunk = fakeChunk(0, 0, {
        '5,64,5': diamond,
        '6,64,6': stone,
      });
      cache = setChunk(cache, 0, 0, chunk);

      const results = getBlocks(cache, 0, 64, 0, 15, 64, 15, 'diamond_ore');
      assert.equal(results.length, 1);
      assert.equal(results[0].name, 'diamond_ore');
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
