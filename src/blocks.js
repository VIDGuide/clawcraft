/**
 * ClawCraft — Bedrock chunk/sub-chunk block decoder
 *
 * Standalone decoder — no prismarine-chunk dependency.
 * Parses Bedrock sub-chunk format directly from buffer data.
 *
 * Sub-chunk format (16×16×16 blocks):
 *   - Version byte (1, 8, or 9)
 *   - For v8/v9: storage count byte; for v9: y index byte
 *   - Each storage layer: palette type byte → 32-bit word data → palette entries
 *   - Palette entries are block state IDs (network runtime format)
 *   - Word data is fixed-size: ceil(4096 / floor(32/bitsPerBlock)) × 4 bytes
 */

// ── Sub-chunk decoding ───────────────────────────────────

/**
 * Parse a single sub-chunk buffer into a flat Uint32Array of
 * block state IDs. Index: ((x << 8) | (z << 4) | y)
 *
 * @param {Buffer} buffer — raw sub-chunk payload
 * @returns {{ blocks: Uint32Array, blockStateIds: number[] }}
 */
export function decodeSubChunkBuffer(buffer) {
  const stream = new StreamReader(buffer);
  const version = stream.readByte();
  let storageCount;

  switch (version) {
    case 1:
      storageCount = 1;
      break;
    case 8:
      storageCount = stream.readByte();
      break;
    case 9:
      storageCount = stream.readByte();
      stream.readByte(); // y index
      break;
    default:
      throw new Error(`Unsupported sub-chunk version: ${version}`);
  }

  const blocks = new Uint32Array(4096);

  for (let layer = 0; layer < storageCount; layer++) {
    const paletteType = stream.readByte();
    const bitsPerBlock = paletteType >> 1;
    const usingNetworkIds = (paletteType & 1) === 1;

    if (bitsPerBlock < 1 || bitsPerBlock > 16) {
      throw new Error(`Invalid bits per block: ${bitsPerBlock}`);
    }
    if (!usingNetworkIds) {
      throw new Error('Only runtime network format is supported');
    }

    // Read fixed-size 32-bit word storage
    const blocksPerWord = Math.floor(32 / bitsPerBlock);
    const wordCount = Math.ceil(4096 / blocksPerWord);
    const words = new Uint32Array(wordCount);
    for (let i = 0; i < wordCount; i++) {
      words[i] = stream.readUInt32LE();
    }

    // Read palette (zigzag varint count, zigzag varint entries)
    // Network block IDs are signed FNV-1a hashes, stored as zigzag varints
    const paletteSize = stream.readZigZagVarInt();
    const palette = new Array(paletteSize);
    for (let i = 0; i < paletteSize; i++) {
      palette[i] = stream.readZigZagVarInt() >>> 0;
    }

    // Decode block indices
    const mask = (1 << bitsPerBlock) - 1;
    if (layer === 0) {
      for (let i = 0; i < 4096; i++) {
        const wordIdx = Math.floor(i / blocksPerWord);
        const bitOffset = (i % blocksPerWord) * bitsPerBlock;
        const paletteIdx = (words[wordIdx] >>> bitOffset) & mask;
        blocks[i] = palette[paletteIdx] ?? 0;
      }
    }
  }

  return { blocks, blockStateIds: Array.from(blocks) };
}

// ── Block state queries ──────────────────────────────────

/**
 * Get block state ID from a decoded sub-chunk at local coordinates.
 * Index: lx*256 + lz*16 + ly
 */
export function getLocalBlock(blocks, lx, ly, lz) {
  const idx = ((lx & 0xf) << 8) | ((lz & 0xf) << 4) | (ly & 0xf);
  return blocks[idx] ?? 0;
}

/**
 * Extract individual sub-chunk buffers from a level_chunk payload.
 * The payload starts with sub-chunk data (for positive subChunkCount).
 */
export function extractSubChunks(payload, subChunkCount) {
  const stream = new StreamReader(payload);
  const subChunks = [];

  for (let i = 0; i < (subChunkCount || 256); i++) {
    if (stream.offset >= stream.length) break;
    const startOff = stream.offset;
    const version = stream.readByte();

    if (version !== 1 && version !== 8 && version !== 9) break;

    let storageCount;
    switch (version) {
      case 1: storageCount = 1; break;
      case 8: storageCount = stream.readByte(); break;
      case 9: storageCount = stream.readByte(); stream.readByte(); break;
    }

    for (let layer = 0; layer < storageCount; layer++) {
      const paletteType = stream.readByte();
      const bitsPerBlock = paletteType >> 1;
      if (bitsPerBlock < 1 || bitsPerBlock > 16) break;

      const blocksPerWord = Math.floor(32 / bitsPerBlock);
      const wordCount = Math.ceil(4096 / blocksPerWord);
      stream.skip(wordCount * 4);

      const paletteSize = stream.readZigZagVarInt();
      for (let j = 0; j < paletteSize; j++) stream.readVarInt();
    }

    subChunks.push({
      buffer: payload.subarray(startOff, stream.offset),
      byteLength: stream.offset - startOff,
    });
  }

  return subChunks;
}

// ── Stream reader helper ─────────────────────────────────

class StreamReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.offset = 0;
    this.length = buffer.length;
  }

  readByte() {
    if (this.offset >= this.length) throw new Error(`StreamReader: read past end at offset ${this.offset}`);
    return this.buffer[this.offset++];
  }

  peekByte() {
    if (this.offset >= this.length) return undefined;
    return this.buffer[this.offset];
  }

  skip(n) {
    if (this.offset + n > this.length) throw new Error(`StreamReader: skip past end at offset ${this.offset}+${n}`);
    this.offset += n;
  }

  readVarInt() {
    let result = 0;
    let shift = 0;
    while (true) {
      const byte = this.readByte();
      result |= (byte & 0x7f) << shift;
      shift += 7;
      if ((byte & 0x80) === 0) break;
      if (shift > 35) throw new Error('StreamReader: VarInt too long');
    }
    return result >>> 0;
  }

  readZigZagVarInt() {
    const raw = this.readVarInt();
    return (raw >>> 1) ^ -(raw & 1);
  }

  readUInt32LE() {
    if (this.offset + 4 > this.length) throw new Error(`StreamReader: read past end at offset ${this.offset}+4`);
    const v = this.buffer[this.offset] |
      (this.buffer[this.offset + 1] << 8) |
      (this.buffer[this.offset + 2] << 16) |
      (this.buffer[this.offset + 3] << 24);
    this.offset += 4;
    return v >>> 0;
  }
}
