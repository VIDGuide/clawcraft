import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSubChunkBuffer, getLocalBlock, extractSubChunks } from '../src/blocks.js';

function encodeVarInt(val) {
  let tmp = val >>> 0;
  const result = [];
  while (tmp >= 0x80) {
    result.push((tmp & 0x7f) | 0x80);
    tmp >>>= 7;
  }
  result.push(tmp & 0x7f);
  return Buffer.from(result);
}

function encodeZigZagVarInt(val) {
  return encodeVarInt(((val << 1) ^ (val >> 31)) >>> 0);
}

/**
 * Build a sub-chunk buffer using proper Bedrock format:
 * - 32-bit words, deterministic word count = ceil(4096/floor(32/bitsPerBlock))
 */
function buildSubChunk(blocks, version = 9) {
  const paletteMap = new Map();
  const blockIndices = new Uint32Array(4096);
  let nextPalIdx = 0;

  paletteMap.set(12530, nextPalIdx++); // air
  for (let i = 0; i < 4096; i++) blockIndices[i] = 0;

  for (const b of blocks) {
    if (!paletteMap.has(b.stateId)) paletteMap.set(b.stateId, nextPalIdx++);
    const lidx = ((b.lx & 0xf) << 8) | ((b.lz & 0xf) << 4) | (b.ly & 0xf);
    blockIndices[lidx] = paletteMap.get(b.stateId);
  }

  const paletteSize = paletteMap.size;
  const bitsPerBlock = Math.max(1, Math.ceil(Math.log2(paletteSize)));
  const blocksPerWord = Math.floor(32 / bitsPerBlock);
  const wordCount = Math.ceil(4096 / blocksPerWord);
  const mask = (1 << bitsPerBlock) - 1;

  // Build 32-bit word storage
  const wordBuf = Buffer.alloc(wordCount * 4);
  for (let i = 0; i < 4096; i++) {
    const wi = Math.floor(i / blocksPerWord);
    const bo = (i % blocksPerWord) * bitsPerBlock;
    const val = blockIndices[i] & mask;
    const byteBase = wi * 4;
    // Set bits in little-endian 32-bit word
    for (let b = 0; b < bitsPerBlock; b++) {
      if (val & (1 << b)) {
        const bitPos = bo + b;
        wordBuf[byteBase + (bitPos >>> 3)] |= 1 << (bitPos & 7);
      }
    }
  }

  const paletteType = (bitsPerBlock << 1) | 1; // runtime IDs
  const parts = [];

  if (version === 1) {
    parts.push(Buffer.from([1, paletteType]));
  } else if (version === 8) {
    parts.push(Buffer.from([8, 1, paletteType]));
  } else {
    parts.push(Buffer.from([9, 1, 0, paletteType])); // storageCount=1, yIndex=0
  }

  parts.push(wordBuf);
  parts.push(encodeZigZagVarInt(paletteSize));

  const sorted = [...paletteMap.entries()].sort((a, b) => a[1] - b[1]);
  for (const [stateId] of sorted) {
    parts.push(encodeZigZagVarInt(stateId | 0));
  }

  return Buffer.concat(parts);
}

describe('blocks', () => {
  describe('decodeSubChunkBuffer', () => {
    it('decodes a single-block sub-chunk (all air)', () => {
      const buf = buildSubChunk([]);
      const result = decodeSubChunkBuffer(buf);
      assert.equal(result.blocks.length, 4096);
      const unique = new Set(result.blockStateIds);
      assert.equal(unique.size, 1);
      assert.ok(unique.has(12530));
    });

    it('decodes a two-block sub-chunk (air + stone)', () => {
      const buf = buildSubChunk([
        { lx: 0, ly: 0, lz: 0, stateId: 2532 },
      ]);
      const result = decodeSubChunkBuffer(buf);
      assert.equal(getLocalBlock(result.blocks, 0, 0, 0), 2532);
      assert.equal(getLocalBlock(result.blocks, 1, 0, 0), 12530);
      assert.equal(getLocalBlock(result.blocks, 0, 1, 0), 12530);
    });

    it('decodes blocks at specific positions', () => {
      const buf = buildSubChunk([
        { lx: 5, ly: 7, lz: 3, stateId: 2532 },
        { lx: 10, ly: 0, lz: 15, stateId: 7336 },
        { lx: 0, ly: 15, lz: 0, stateId: 3203 },
      ]);
      const result = decodeSubChunkBuffer(buf);
      assert.equal(getLocalBlock(result.blocks, 5, 7, 3), 2532);
      assert.equal(getLocalBlock(result.blocks, 10, 0, 15), 7336);
      assert.equal(getLocalBlock(result.blocks, 0, 15, 0), 3203);
      assert.equal(getLocalBlock(result.blocks, 0, 0, 0), 12530);
    });

    it('handles palette with 3 entries', () => {
      const buf = buildSubChunk([
        { lx: 0, ly: 0, lz: 0, stateId: 2532 },
        { lx: 1, ly: 0, lz: 0, stateId: 7336 },
      ]);
      const result = decodeSubChunkBuffer(buf);
      assert.equal(getLocalBlock(result.blocks, 0, 0, 0), 2532);
      assert.equal(getLocalBlock(result.blocks, 1, 0, 0), 7336);
      assert.equal(getLocalBlock(result.blocks, 0, 1, 0), 12530);
    });

    it('decodes version 1 sub-chunks', () => {
      const buf = buildSubChunk([
        { lx: 0, ly: 0, lz: 0, stateId: 2532 },
      ], 1);
      const result = decodeSubChunkBuffer(buf);
      assert.equal(getLocalBlock(result.blocks, 0, 0, 0), 2532);
      assert.equal(getLocalBlock(result.blocks, 1, 0, 0), 12530);
    });

    it('decodes version 8 sub-chunks', () => {
      const buf = buildSubChunk([
        { lx: 3, ly: 5, lz: 7, stateId: 100 },
      ], 8);
      const result = decodeSubChunkBuffer(buf);
      assert.equal(getLocalBlock(result.blocks, 3, 5, 7), 100);
    });

    it('rejects unsupported versions', () => {
      assert.throws(() => decodeSubChunkBuffer(Buffer.from([7, 0])));
      assert.throws(() => decodeSubChunkBuffer(Buffer.from([10, 0])));
    });

    it('rejects invalid bit depth', () => {
      // version 9, storageCount=1, yIdx=0, paletteType=1 (bitsPerBlock=0)
      assert.throws(() => decodeSubChunkBuffer(Buffer.from([9, 1, 0, 1])));
    });
  });

  describe('extractSubChunks', () => {
    it('extracts multiple sub-chunks', () => {
      const sc1 = buildSubChunk([{ lx: 0, ly: 0, lz: 0, stateId: 2532 }]);
      const sc2 = buildSubChunk([{ lx: 1, ly: 1, lz: 1, stateId: 7336 }]);
      const payload = Buffer.concat([sc1, sc2]);
      const result = extractSubChunks(payload, 2);
      assert.equal(result.length, 2);

      const d1 = decodeSubChunkBuffer(result[0].buffer);
      assert.equal(getLocalBlock(d1.blocks, 0, 0, 0), 2532);

      const d2 = decodeSubChunkBuffer(result[1].buffer);
      assert.equal(getLocalBlock(d2.blocks, 1, 1, 1), 7336);
    });

    it('handles version 1 sub-chunks', () => {
      const sc = buildSubChunk([{ lx: 0, ly: 0, lz: 0, stateId: 2532 }], 1);
      const result = extractSubChunks(sc, 1);
      assert.equal(result.length, 1);
      const decoded = decodeSubChunkBuffer(result[0].buffer);
      assert.equal(getLocalBlock(decoded.blocks, 0, 0, 0), 2532);
    });
  });
});
