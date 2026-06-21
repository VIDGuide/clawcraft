/**
 * ClawCraft — Chunk decoder
 *
 * Decodes Bedrock level_chunk and subchunk packet buffers.
 * Level chunks with -2 sub-chunks are metadata-only (sub-chunks
 * must be requested via subchunk_request). Sub-chunk packets
 * are decoded using the standalone block decoder.
 */

import { decodeSubChunkBuffer, extractSubChunks } from './blocks.js';

export async function decodeLevelChunk(cx, cz, payload, subChunkCount) {
  const chunk = {
    x: cx, z: cz,
    subChunks: new Map(),
    subChunkCount, decoded: false,
    rawSize: payload?.length || 0,
  };

  if (subChunkCount === -1 || subChunkCount === -2 || !payload || payload.length < 2) {
    // -1/-2: payload is biome data only; sub-chunks come via SubChunkRequest
    return chunk;
  }

  try {
    const subChunkBuffers = extractSubChunks(payload, subChunkCount);
    for (let i = 0; i < subChunkBuffers.length; i++) {
      const { blocks } = decodeSubChunkBuffer(subChunkBuffers[i].buffer);
      chunk.subChunks.set(i, blocks);
    }
    chunk.decoded = true;
  } catch (e) {
    chunk.decodeError = e.message;
  }

  return chunk;
}

export async function decodeSubChunk(chunk, cy, buffer) {
  if (!chunk) throw new Error('Chunk must be created first');
  try {
    const { blocks } = decodeSubChunkBuffer(buffer);
    const subChunks = new Map(chunk.subChunks);
    subChunks.set(cy, blocks);
    return { ...chunk, subChunks };
  } catch (e) {
    throw new Error(`Sub-chunk decode failed at Y=${cy}: ${e.message}`);
  }
}

export function applyBlockUpdates(chunk, blockUpdates) {
  if (!chunk || !blockUpdates || !chunk.subChunks) return chunk;
  const subChunks = new Map(chunk.subChunks);
  const cloned = new Set(); // track which sub-chunks we've already cloned
  for (const update of blockUpdates) {
    try {
      const cy = Math.floor((update.y + 64) / 16);
      const ly = update.y & 0xf;
      const lx = (update.x & 0xf);
      const lz = (update.z & 0xf);
      const stateId = update.block?.stateId ?? update.stateId ?? 0;
      if (!subChunks.has(cy)) {
        subChunks.set(cy, new Uint32Array(4096));
        cloned.add(cy);
      } else if (!cloned.has(cy)) {
        subChunks.set(cy, new Uint32Array(subChunks.get(cy)));
        cloned.add(cy);
      }
      const idx = (lx << 8) | (lz << 4) | ly;
      subChunks.get(cy)[idx] = stateId;
    } catch { /* skip */ }
  }
  return { ...chunk, subChunks };
}

export async function createBlankChunk(cx, cz) {
  return { x: cx, z: cz, subChunks: new Map(), decoded: false, rawSize: 0 };
}
