/**
 * ClawCraft — Block/chunk awareness
 *
 * Stores decoded chunks and provides block queries.
 * Chunks contain subChunks maps: cy → Uint32Array(4096) of block state IDs.
 * State IDs are numeric values from the Bedrock block state registry.
 *
 * Known state IDs (Bedrock 1.21):
 *   air    → 12530
 *   stone  → 2532
 *   iron_ore → 7336
 *   diamond_ore → ???
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
    /** @type {Map<string, {x: number, z: number, subChunks: Map<number, Uint32Array>}>} */
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
  chunk.lastAccessed = Date.now();
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

// Bedrock block state IDs are FNV-1a hashes
import { AIR_ID } from './constants.js';
import { nameFor } from './palette.js';
const CAVE_AIR_ID = 0; // cave_air may not exist in bedrock

function isAir(block) {
  return !block || block.stateId === AIR_ID;
}

function isSolid(block) {
  return block && block.stateId !== AIR_ID;
}

function isLiquid(block) {
  // Detect water/lava by name (state IDs are now hashes, not ranges)
  if (!block || !block.name) return false;
  const n = block.name;
  return n.includes('water') || n.includes('lava') || n.includes('bubble_column');
}

/**
 * Query a single block at world coordinates.
 * Returns null if chunk not loaded, or { stateId }.
 */
export function getBlock(cache, x, y, z) {
  const chunk = getChunkAt(cache, x, z);
  if (!chunk || !chunk.subChunks) return null;

  // Update last-access time for LRU eviction (mutate in place — chunk is already mutable)
  chunk.lastAccessed = Date.now();

  const cy = Math.floor(y / 16);
  const sub = chunk.subChunks.get(cy);
  if (!sub) return null;
  // 'air' sentinel means server confirmed this sub-chunk is entirely air
  if (sub === 'air') return { stateId: AIR_ID, name: 'minecraft:air', properties: {} };

  const lx = ((x % 16) + 16) % 16;
  const lz = ((z % 16) + 16) % 16;
  const ly = y & 0xf;
  const idx = (lx << 8) | (lz << 4) | ly;
  const stateId = sub[idx];

  // Uint32Array defaults to 0 for unwritten positions; treat as no data
  if (stateId === 0) return null;
  return { stateId, name: nameFor(stateId) || `state_${stateId}`, properties: {} };
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

// ── Perception primitives for LLM navigation ────────────

/**
 * Scan blocks in a volume around a position.
 * Returns structured data:
 *   - layers: map of y → [blocks at that y level]
 *   - notable: blocks that matter (chests, ores, doors, crafting tables, etc.)
 *   - walls: N/S/E/W walls at the scan boundary (for room awareness)
 *   - floor: blocks at the lowest y level
 *   - ceiling: blocks at the highest y level
 */
export function scan(cache, cx, cy, cz, radiusX = 3, radiusY = 2, radiusZ = 3) {
  const layers = {};
  const notable = [];
  const floor = [];
  const ceiling = [];
  let unloadedCount = 0;
  let totalQueried = 0;

  const minY = cy - radiusY;
  const maxY = cy + radiusY;
  const minX = cx - radiusX;
  const maxX = cx + radiusX;
  const minZ = cz - radiusZ;
  const maxZ = cz + radiusZ;

  for (let y = minY; y <= maxY; y++) {
    const row = [];
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        totalQueried++;
        const block = getBlock(cache, x, y, z);
        if (block === null) { unloadedCount++; continue; }
        if (!isAir(block)) {
          const entry = { x, y, z, stateId: block.stateId, name: block.name };
          row.push(entry);

          // Track notable blocks — all non-air blocks are notable
          notable.push(entry);
        }
      }
    }
    if (row.length > 0) {
      layers[String(y)] = row;
    }
  }

  // Floor and ceiling
  const floorY = minY;
  const ceilingY = maxY;
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      const bFloor = getBlock(cache, x, floorY, z);
      if (!isAir(bFloor)) floor.push({ x, y: floorY, z, stateId: bFloor.stateId });
      const bCeil = getBlock(cache, x, ceilingY, z);
      if (!isAir(bCeil)) ceiling.push({ x, y: ceilingY, z, stateId: bCeil.stateId });
    }
  }

  // Detect N/S/E/W walls at the scan boundary
  const walls = { north: [], south: [], east: [], west: [] };
  for (let yg = minY; yg <= maxY; yg++) {
    for (let xg = minX; xg <= maxX; xg++) {
      const bNorth = getBlock(cache, xg, yg, minZ);
      if (!isAir(bNorth)) walls.north.push({ x: xg, y: yg, z: minZ, stateId: bNorth.stateId });
      const bSouth = getBlock(cache, xg, yg, maxZ);
      if (!isAir(bSouth)) walls.south.push({ x: xg, y: yg, z: maxZ, stateId: bSouth.stateId });
    }
    for (let zg = minZ; zg <= maxZ; zg++) {
      const bWest = getBlock(cache, minX, yg, zg);
      if (!isAir(bWest)) walls.west.push({ x: minX, y: yg, z: zg, stateId: bWest.stateId });
      const bEast = getBlock(cache, maxX, yg, zg);
      if (!isAir(bEast)) walls.east.push({ x: maxX, y: yg, z: zg, stateId: bEast.stateId });
    }
  }

  return {
    origin: { x: cx, y: cy, z: cz },
    bounds: { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] },
    totalNonAir: Object.values(layers).reduce((s, r) => s + r.length, 0),
    loaded: unloadedCount === 0,
    unloaded: unloadedCount,
    total: totalQueried,
    layers: Object.fromEntries(
      Object.entries(layers).sort(([a], [b]) => Number(a) - Number(b)),
    ),
    notable,
    floor,
    ceiling,
    walls,
  };
}

/**
 * Get blocks in the direction the bot is facing.
 * Uses yaw (radians, 0=south, PI=north, -PI/2=east, PI/2=west)
 * and pitch (radians, negative=up, positive=down).
 */
export function direction(cache, pos, yaw, pitch, distance = 10) {
  // Yaw: 0 = +Z (south), PI/2 = -X (west), PI = -Z (north), -PI/2 = +X (east)
  const dirX = -Math.sin(yaw);
  const dirZ = Math.cos(yaw);
  const dirY = -Math.sin(pitch);

  // Normalize the horizontal components
  const horizLen = Math.sqrt(dirX * dirX + dirZ * dirZ);
  const nx = horizLen > 0.001 ? dirX / horizLen : 0;
  const nz = horizLen > 0.001 ? dirZ / horizLen : 0;

  const blocks = [];
  for (let i = 1; i <= distance; i++) {
    const bx = Math.floor(pos.x + nx * i);
    const by = Math.floor(pos.y + dirY * i * 0.5); // scale vertical slower
    const bz = Math.floor(pos.z + nz * i);
    const block = getBlock(cache, bx, by, bz);
    const stateId = block ? block.stateId : 0;
    const solid = block !== null && !isAir(block) && !isLiquid(block);
    const entry = { dist: i, x: bx, y: by, z: bz, stateId, solid, name: (block ? block.name : 'unknown') };
    blocks.push(entry);

    // Stop at first solid block
    if (solid) {
      break;
    }
  }

  return {
    facing: { x: nx, y: dirY, z: nz },
    blocks,
    clear: blocks.every(b => !b.solid),
    firstObstacle: blocks.find(b => b.solid) || null,
  };
}

/**
 * Raycast from position A to position B.
 * Returns whether the path is clear (only air/cave_air between),
 * and the first obstacle if blocked.
 */
export function raycast(cache, ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dist < 1) return { clear: true, distance: 0, obstacle: null };

  const steps = Math.ceil(dist);
  const sx = dx / steps;
  const sy = dy / steps;
  const sz = dz / steps;

  for (let i = 1; i < steps; i++) {
    const x = Math.floor(ax + sx * i);
    const y = Math.floor(ay + sy * i);
    const z = Math.floor(az + sz * i);
    const block = getBlock(cache, x, y, z);
    if (block && !isAir(block) && block.name !== 'cave_air' &&
        !isLiquid(block)) {
      return { clear: false, distance: i, obstacle: { x, y, z, name: block.name } };
    }
  }

  return { clear: true, distance: dist, obstacle: null };
}


/**
 * Evict distant/stale chunks from the cache (LRU-style).
 *
 * Removes chunks that are BOTH beyond maxDistanceBlocks from bot AND
 * haven't been accessed in more than staleMs milliseconds.
 *
 * @param {object} cache - chunk cache
 * @param {number} botX - bot's current world X
 * @param {number} botZ - bot's current world Z
 * @param {number} maxChunks - max chunks to keep (default 512)
 * @param {number} maxDistanceBlocks - eviction distance threshold (default 256)
 * @param {number} staleMs - staleness threshold in ms (default 60000)
 * @returns {{ cache: object, evicted: number }}
 */
export function evictChunks(cache, botX, botZ, maxChunks = 512, maxDistanceBlocks = 256, staleMs = 60000) {
  if (cache.chunks.size <= maxChunks / 2) return { cache, evicted: 0 };

  const now = Date.now();
  const newChunks = new Map(cache.chunks);
  let evicted = 0;

  for (const [key, chunk] of newChunks) {
    const distBlocks = Math.sqrt(
      ((chunk.x * 16 + 8) - botX) ** 2 +
      ((chunk.z * 16 + 8) - botZ) ** 2,
    );
    const stale = (now - (chunk.lastAccessed || 0)) > staleMs;
    if (distBlocks > maxDistanceBlocks && stale) {
      newChunks.delete(key);
      evicted++;
    }
  }

  if (evicted === 0) return { cache, evicted: 0 };
  return { cache: { ...cache, chunks: newChunks }, evicted };
}

/**
 * Search loaded chunks for blocks matching a name pattern (BFS outward from center).
 * @param {object} cache - chunk cache
 * @param {number} cx - center X
 * @param {number} cy - center Y
 * @param {number} cz - center Z
 * @param {string} blockName - block name pattern (substring match, minecraft: prefix optional)
 * @param {number} maxResults - max results to return (default 5)
 * @param {number} maxRadius - max XZ radius to search (default 32)
 * @returns {Array<{x,y,z,name,distance}>} sorted by distance ascending
 */
export function findBlocks(cache, cx, cy, cz, blockName, maxResults = 5, maxRadius = 32) {
  const pattern = blockName.replace(/^minecraft:/, '').toLowerCase();
  const results = [];

  // BFS outward in XZ, checking all Y per column
  for (let r = 0; r <= maxRadius && results.length < maxResults * 3; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) !== r && Math.abs(dz) !== r) continue; // only ring perimeter
        const wx = cx + dx;
        const wz = cz + dz;
        const chunkX = Math.floor(wx / 16);
        const chunkZ = Math.floor(wz / 16);
        if (!cache.chunks.has(chunkKeyFromPos(chunkX, chunkZ))) continue;

        // Search all Y in this column
        for (let dy = -maxRadius; dy <= maxRadius; dy++) {
          const wy = cy + dy;
          const block = getBlock(cache, wx, wy, wz);
          if (!block || isAir(block)) continue;
          const name = (block.name || '').replace(/^minecraft:/, '').toLowerCase();
          if (name.includes(pattern)) {
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            results.push({ x: wx, y: wy, z: wz, name: block.name, distance: dist });
          }
        }
      }
    }
    if (results.length >= maxResults * 3) break;
  }

  results.sort((a, b) => a.distance - b.distance);
  return results.slice(0, maxResults);
}

/**
 * Find the best adjacent solid block face to click when placing a block at (x,y,z).
 *
 * In Bedrock: to place a block at target position, you click on an ADJACENT solid block.
 * block_position = the adjacent block, face = which face of that block you clicked.
 *
 * Face mapping (Bedrock convention):
 *   0 = bottom face (-Y neighbor's top, i.e. block above target)  -- clicking underside of block above
 *   1 = top face    (+Y neighbor's bottom, i.e. block below target) -- clicking top of block below (most common)
 *   2 = north (-Z)
 *   3 = south (+Z)
 *   4 = west  (-X)
 *   5 = east  (+X)
 *
 * Priority order: below(1), north(2), south(3), west(4), east(5), above(0)
 *
 * @returns {{ neighborPos: {x,y,z}, face: number } | null}
 */
export function buildPlaceFace(cache, x, y, z, preferredFace) {
  // Candidate: [dx, dy, dz, face_of_neighbor]
  // The neighbor is the existing block; face is which of its faces we click.
  const candidates = [
    { dx: 0, dy: -1, dz: 0, face: 1 }, // block below, click its top face
    { dx: 0, dy: 0, dz: -1, face: 3 }, // block north, click its south face
    { dx: 0, dy: 0, dz: 1,  face: 2 }, // block south, click its north face
    { dx: -1, dy: 0, dz: 0, face: 5 }, // block west, click its east face
    { dx: 1,  dy: 0, dz: 0, face: 4 }, // block east, click its west face
    { dx: 0, dy: 1,  dz: 0, face: 0 }, // block above, click its bottom face
  ];

  // If a preferred face is specified, put that candidate first
  if (preferredFace !== undefined) {
    candidates.sort((a, b) => (a.face === preferredFace ? -1 : b.face === preferredFace ? 1 : 0));
  }

  for (const { dx, dy, dz, face } of candidates) {
    const nb = getBlock(cache, x + dx, y + dy, z + dz);
    if (nb && !isAir(nb)) {
      return { neighborPos: { x: x + dx, y: y + dy, z: z + dz }, face };
    }
  }
  return null;
}
