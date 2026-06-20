/**
 * ClawMine — Block/chunk awareness
 *
 * Decodes Bedrock level_chunk and subchunk packets into a
 * queryable block map using prismarine-chunk.
 *
 * Layers:
 *   ChunkManager   — stores decoded chunks, provides block queries
 *   ChunkDecoder   — decodes raw packet buffers into chunk objects
 */

/**
 * Create a block store for tracking known block states.
 * Returns { id → { name, state? } } mapping.
 */
export function createBlockMap() {
  return new Map();
}

/**
 * Create a chunk cache.
 * Chunks are keyed by "chunkX,chunkZ" string.
 */
export function createChunkCache() {
  return {
    /** @type {Map<string, import('prismarine-chunk').Chunk>} */
    chunks: new Map(),
    /** @type {Set<string>} */  // "x,y,z" of known block entities
    blockEntities: new Set(),
  };
}

/**
 * Get the chunk key for a world coordinate.
 * Bedrock chunks are 16×16 on the XZ plane.
 */
export function chunkKey(x, z) {
  const cx = Math.floor(x / 16);
  const cz = Math.floor(z / 16);
  return `${cx},${cz}`;
}

/**
 * Get the chunk key from chunk coordinates.
 */
export function chunkKeyFromPos(cx, cz) {
  return `${cx},${cz}`;
}

/**
 * Store a decoded chunk in the cache.
 */
export function setChunk(cache, cx, cz, chunk) {
  const key = chunkKeyFromPos(cx, cz);
  chunk.x = cx;
  chunk.z = cz;
  const next = { ...cache, chunks: new Map(cache.chunks) };
  next.chunks.set(key, chunk);
  return next;
}

/**
 * Get a chunk from the cache by chunk coordinates.
 */
export function getChunk(cache, cx, cz) {
  return cache.chunks.get(chunkKeyFromPos(cx, cz));
}

/**
 * Get a chunk from the cache by world coordinates.
 */
export function getChunkAt(cache, x, z) {
  return getChunk(cache, Math.floor(x / 16), Math.floor(z / 16));
}

/**
 * Query a single block at world coordinates.
 * Returns null if chunk not loaded, or { name, stateId }.
 */
export function getBlock(cache, x, y, z) {
  const chunk = getChunkAt(cache, x, z);
  if (!chunk) return null;

  const lx = ((x % 16) + 16) % 16;
  const lz = ((z % 16) + 16) % 16;
  const ly = y;

  try {
    const block = chunk.getBlock(lx, ly, lz);
    if (!block) return null;
    return {
      name: block.name,
      stateId: block.stateId ?? null,
      properties: block.properties ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Query blocks in a cuboid volume.
 * Returns array of { x, y, z, name? } for populated blocks.
 * Set filter to a block name to only return matches (e.g., 'diamond_ore').
 */
export function getBlocks(cache, x1, y1, z1, x2, y2, z2, filter) {
  const results = [];
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const minZ = Math.min(z1, z2);
  const maxZ = Math.max(z1, z2);

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        const block = getBlock(cache, x, y, z);
        if (block && (!filter || block.name === filter)) {
          results.push({ x, y, z, ...block });
        }
      }
    }
  }

  return results;
}

/**
 * Check which chunks are loaded within a radius of a position.
 * Returns array of { cx, cz, loaded, distance }.
 */
export function chunkStatus(cache, x, z, radius = 4) {
  const cx = Math.floor(x / 16);
  const cz = Math.floor(z / 16);
  const status = [];

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const k = chunkKeyFromPos(cx + dx, cz + dz);
      status.push({
        cx: cx + dx,
        cz: cz + dz,
        loaded: cache.chunks.has(k),
        dist: Math.sqrt(dx * dx + dz * dz),
      });
    }
  }

  return status;
}
