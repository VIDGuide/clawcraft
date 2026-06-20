import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeLevelChunk, decodeSubChunk, applyBlockUpdates, createBlankChunk } from '../src/decoder.js';

describe('decoder', () => {
  describe('createBlankChunk', () => {
    it('creates a stub chunk at given coordinates', async () => {
      const chunk = await createBlankChunk(0, 0);
      assert.equal(chunk.x, 0);
      assert.equal(chunk.z, 0);
      assert.equal(chunk.decoded, false);
    });
  });

  describe('decodeLevelChunk', () => {
    it('returns stub chunk for any input', async () => {
      const chunk = await decodeLevelChunk(1, 2, Buffer.alloc(100), 4);
      assert.equal(chunk.x, 1);
      assert.equal(chunk.z, 2);
      assert.equal(chunk.decoded, false);
    });
  });

  describe('decodeSubChunk', () => {
    it('returns chunk as-is', async () => {
      const chunk = { x: 0, z: 0 };
      const result = await decodeSubChunk(chunk, 0, Buffer.alloc(10));
      assert.equal(result, chunk);
    });
  });

  describe('applyBlockUpdates', () => {
    it('does nothing (stub)', () => {
      applyBlockUpdates({}, []);
      applyBlockUpdates(null, null);
      // Should not throw
    });
  });
});
