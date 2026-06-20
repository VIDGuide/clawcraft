/**
 * ClawMine — Chunk decoder (packet decode layer)
 *
 * Decodes Bedrock level_chunk and subchunk packet buffers into
 * prismarine-chunk objects using prismarine-chunk's network decode.
 *
 * Three entry points:
 *   decodeLevelChunk    — Full level_chunk (initial load, cache disabled)
 *   decodeSubChunk      — Individual subchunk packet (incremental update)
 *   applyBlockUpdates   — Block-level changes from update_subchunk_blocks
 */

import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);

// Loader is set once (lazy) since it needs prismarine-chunk + registry
let _Chunk = null;

function getChunkClass() {
  if (!_Chunk) {
    try {
      const loader = _require('prismarine-chunk');
      _Chunk = loader('bedrock_1.21');
    } catch (e) {
      throw new Error(`Failed to load prismarine-chunk: ${e.message}`);
    }
  }
  return _Chunk;
}

/**
 * Decode a full level_chunk packet (cache-disabled path).
 *
 * Creates a new Chunk at (cx, cz) and decodes the payload buffer
 * into it. Returns the decoded chunk or throws on error.
 *
 * @param {number} cx — chunk X coordinate
 * @param {number} cz — chunk Z coordinate
 * @param {Buffer} payload — raw payload from level_chunk packet
 * @param {number} subChunkCount — number of sub-chunks (-2 = all, -1 = empty)
 * @returns {Promise<object>} decoded chunk
 */
export async function decodeLevelChunk(cx, cz, payload, subChunkCount) {
  const Chunk = await getChunkClass();

  // Handle edge cases
  if (subChunkCount === -1) {
    // No data — empty chunk
    const empty = new Chunk();
    empty.x = cx;
    empty.z = cz;
    return empty;
  }

  const chunk = new Chunk();
  chunk.x = cx;
  chunk.z = cz;

  // Decode the full payload with empty blob store (no caching)
  const blobs = [];
  const blobStore = {
    has: () => false,
    get: () => null,
    set: () => {},
  };

  // Add timeout to prevent hanging on bad payloads
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Decode timed out')), 5000),
  );

  try {
    const missing = await Promise.race([
      chunk.networkDecode(blobs, blobStore, payload),
      timeout,
    ]);
    if (missing && missing.length > 0) {
      return chunk; // Return partial chunk even if blobs are missing
    }
  } catch (e) {
    // Log but don't crash — return blank chunk so the cache isn't empty
    if (e.message?.includes('blobs')) {
      // Cache-enabled — return blank chunk
      return chunk;
    }
    if (e.message?.includes('timed out')) {
      console.error(`Chunk decode timed out at (${cx}, ${cz})`);
      return chunk;
    }
    console.error(`Chunk decode error at (${cx}, ${cz}): ${e.message}`);
    return chunk;
  }

  return chunk;
}

/**
 * Decode a single sub-chunk from a subchunk packet entry.
 *
 * @param {object} chunk — existing Chunk object for this position
 * @param {number} cy — sub-chunk Y index (relative, e.g. 0 = bottom)
 * @param {Buffer} buffer — raw sub-chunk payload
 * @returns {Promise<object>} the updated chunk
 */
export async function decodeSubChunk(chunk, cy, buffer) {
  if (!chunk) throw new Error('Chunk must be created first');

  try {
    await chunk.networkDecodeSubChunkNoCache(cy, buffer);
  } catch (e) {
    throw new Error(`Sub-chunk decode failed at Y=${cy}: ${e.message}`);
  }

  return chunk;
}

/**
 * Apply block-level updates from an update_subchunk_blocks packet.
 *
 * @param {object} chunk — existing Chunk for this position
 * @param {Array} blockUpdates — array of { x, y, z, block } from the packet
 */
export function applyBlockUpdates(chunk, blockUpdates) {
  if (!chunk) return;
  if (!blockUpdates || blockUpdates.length === 0) return;

  for (const update of blockUpdates) {
    try {
      const lx = ((update.x % 16) + 16) % 16;
      const lz = ((update.z % 16) + 16) % 16;
      const block = {
        name: update.block?.name || 'air',
        stateId: update.block?.stateId || 0,
        states: update.block?.states || {},
      };
      chunk.setBlock(lx, update.y, lz, block);
    } catch {
      // Skip individual block update failures
    }
  }
}

/**
 * Helper: create a blank chunk for testing/manual use.
 */
export async function createBlankChunk(cx, cz) {
  const Chunk = await getChunkClass();
  const chunk = new Chunk();
  chunk.x = cx;
  chunk.z = cz;
  return chunk;
}
