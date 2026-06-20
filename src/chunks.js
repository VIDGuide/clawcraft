/**
 * ClawMine — Block/chunk awareness
 *
 * Stores chunk metadata and provides block queries.
 * Full chunk decode (using prismarine-chunk) disabled due to
 * CJS/ESM module cache collision with bedrock-protocol.
 * Chunks are tracked by position but blocks are not queryable.
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
        const block = getBlock(cache, x, y, z);
        if (block && block.name !== 'air') {
          const entry = { x, y, z, name: block.name };
          row.push(entry);

          // Track notable blocks
          const low = block.name.toLowerCase();
          if (low.includes('ore') || low.includes('chest') || low.includes('crafting') ||
              low.includes('furnace') || low.includes('door') || low.includes('bed') ||
              low.includes('torch') || low.includes('ladder') || low.includes('water') ||
              low.includes('lava') || low.includes('tnt') || low.includes('anvil') ||
              low.includes('enchanting') || low.includes('brewing') || low.includes('beacon')) {
            notable.push(entry);
          }
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
      if (bFloor && bFloor.name !== 'air') floor.push({ x, y: floorY, z, name: bFloor.name });
      const bCeil = getBlock(cache, x, ceilingY, z);
      if (bCeil && bCeil.name !== 'air') ceiling.push({ x, y: ceilingY, z, name: bCeil.name });
    }
  }

  // Detect N/S/E/W walls at the scan boundary
  const walls = { north: [], south: [], east: [], west: [] };
  for (let yg = minY; yg <= maxY; yg++) {
    for (let xg = minX; xg <= maxX; xg++) {
      const bNorth = getBlock(cache, xg, yg, minZ);
      if (bNorth && bNorth.name !== 'air') walls.north.push({ x: xg, y: yg, z: minZ, name: bNorth.name });
      const bSouth = getBlock(cache, xg, yg, maxZ);
      if (bSouth && bSouth.name !== 'air') walls.south.push({ x: xg, y: yg, z: maxZ, name: bSouth.name });
    }
    for (let zg = minZ; zg <= maxZ; zg++) {
      const bWest = getBlock(cache, minX, yg, zg);
      if (bWest && bWest.name !== 'air') walls.west.push({ x: minX, y: yg, z: zg, name: bWest.name });
      const bEast = getBlock(cache, maxX, yg, zg);
      if (bEast && bEast.name !== 'air') walls.east.push({ x: maxX, y: yg, z: zg, name: bEast.name });
    }
  }

  return {
    origin: { x: cx, y: cy, z: cz },
    bounds: { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] },
    totalNonAir: Object.values(layers).reduce((s, r) => s + r.length, 0),
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
  let prevBlock = null;
  for (let i = 1; i <= distance; i++) {
    const bx = Math.floor(pos.x + nx * i);
    const by = Math.floor(pos.y + dirY * i * 0.5); // scale vertical slower
    const bz = Math.floor(pos.z + nz * i);
    const block = getBlock(cache, bx, by, bz);
    const entry = { dist: i, x: bx, y: by, z: bz, name: (block ? block.name : 'unknown') };
    blocks.push(entry);

    // Stop at first solid block
    if (block && block.name !== 'air' && !block.name.includes('water') && !block.name.includes('lava')) {
      break;
    }
  }

  return {
    facing: { x: nx, y: dirY, z: nz },
    blocks,
    clear: blocks.every(b => b.name === 'air' || b.name === 'cave_air'),
    firstObstacle: blocks.find(b => b.name !== 'air' && b.name !== 'cave_air') || null,
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
    if (block && block.name !== 'air' && block.name !== 'cave_air' &&
        !block.name.includes('water') && !block.name.includes('lava')) {
      return { clear: false, distance: i, obstacle: { x, y, z, name: block.name } };
    }
  }

  return { clear: true, distance: dist, obstacle: null };
}

