import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeLevelChunk, decodeSubChunk, applyBlockUpdates, createBlankChunk } from '../src/decoder.js';
import { createChunkCache, setChunk, getBlock, getBlocks } from '../src/chunks.js';

describe('decoder', () => {
  describe('createBlankChunk', () => {
    it('creates a chunk at given coordinates', async () => {
      const chunk = await createBlankChunk(0, 0);
      assert.equal(chunk.x, 0);
      assert.equal(chunk.z, 0);
    });
  });

  describe('decodeLevelChunk', () => {
    it('returns empty chunk for no-data (-1 sub-chunks)', async () => {
      const chunk = await decodeLevelChunk(0, 0, Buffer.alloc(0), -1);
      assert.equal(chunk.x, 0);
      assert.equal(chunk.z, 0);
    });

    it('throws on decode failure with bad payload', async () => {
      try {
        await decodeLevelChunk(0, 0, Buffer.alloc(10), 0);
        assert.fail('Should have thrown');
      } catch (e) {
        // Should get a decode error — not a crash
        assert.ok(typeof e.message === 'string');
      }
    });
  });

  describe('decodeSubChunk', () => {
    it('throws when chunk is null', async () => {
      try {
        await decodeSubChunk(null, 0, Buffer.alloc(10));
        assert.fail('Should have thrown');
      } catch (e) {
        assert.ok(e.message.includes('Chunk must be created'));
      }
    });
  });

  describe('applyBlockUpdates', () => {
    it('does nothing with empty updates', async () => {
      const chunk = await createBlankChunk(0, 0);
      applyBlockUpdates(chunk, []);
      // Should not throw — no-op
    });

    it('does nothing with null updates', async () => {
      const chunk = await createBlankChunk(0, 0);
      applyBlockUpdates(chunk, null);
    });

    it('does nothing with undefined chunk', () => {
      applyBlockUpdates(null, [{ x: 0, y: 0, z: 0, block: { name: 'stone' } }]);
      // Should not throw
    });
  });

  describe('prismarine-chunk integration', () => {
    it('creates a blank chunk with correct coords', async () => {
      const chunk = await createBlankChunk(0, 0);
      assert.equal(chunk.x, 0);
      assert.equal(chunk.z, 0);
      // Fresh chunk has no sections
      assert.equal(Object.keys(chunk.sections).length, 0);
    });

    it('stores block stateIds', async () => {
      const chunk = await createBlankChunk(0, 0);
      const pos = { x: 0, y: 64, z: 0, l: { x: 0, y: 64, z: 0 } };
      chunk.setBlockStateId(pos, 2532);

      // Storage layer is created after setBlockStateId
      assert.ok(Object.keys(chunk.sections).length > 0);
      assert.equal(chunk.getBlockStateId(pos), 2532);
    });

    it('stores multiple block stateIds', async () => {
      const chunk = await createBlankChunk(0, 0);
      chunk.setBlockStateId({ x: 0, y: 64, z: 0, l: { x: 0, y: 64, z: 0 } }, 2532);
      chunk.setBlockStateId({ x: 1, y: 64, z: 0, l: { x: 1, y: 64, z: 0 } }, 7336);

      assert.equal(
        chunk.getBlockStateId({ x: 0, y: 64, z: 0, l: { x: 0, y: 64, z: 0 } }),
        2532,
      );
      assert.equal(
        chunk.getBlockStateId({ x: 1, y: 64, z: 0, l: { x: 1, y: 64, z: 0 } }),
        7336,
      );
    });

    it('default stateId is undefined for uninitialized positions', async () => {
      const chunk = await createBlankChunk(0, 0);
      // No section exists yet — returns undefined
      assert.equal(chunk.getBlockStateId({ x: 0, y: 64, z: 0, l: { x: 0, y: 64, z: 0 } }), undefined);
      assert.equal(Object.keys(chunk.sections).length, 0);
    });
  });
});
