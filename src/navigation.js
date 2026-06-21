/**
 * ClawMine — Enhanced navigation
 *
 * Block classification + cost-aware A* pathfinder.
 * Supports: flat walk, step-up, fall, ladders, water, doors.
 * Avoids: lava, hazards.
 *
 * Pure logic, fully testable with mocked chunks.
 */

import { getBlock } from './chunks.js';
import { AIR_ID } from './constants.js';

// ── Block classification ─────────────────────────────────

const DOOR_RE = /door|gate/;
const STAIR_SLAB_RE = /stairs|slab/;
const CLIMB_RE = /ladder|vine|scaffolding/;
const LIQUID_RE = /water|flowing_water/;
const HAZARD_RE = /lava|flowing_lava|magma|cactus|sweet_berry|wither_rose|fire|soul_fire|campfire/;
const FENCE_RE = /fence|wall|cobblestone_wall/;

/**
 * Classify a block by its name into traversal properties.
 */
export function classifyBlock(block) {
  if (!block || block.stateId === AIR_ID) {
    return { passable: true, solid: false, climbable: false, openable: false, liquid: false, hazard: false, halfHeight: false, fence: false };
  }
  const name = (block.name || '').replace('minecraft:', '');
  return {
    passable: DOOR_RE.test(name) || CLIMB_RE.test(name) || LIQUID_RE.test(name) || block.stateId === AIR_ID,
    solid: !DOOR_RE.test(name) && !CLIMB_RE.test(name) && !LIQUID_RE.test(name) && block.stateId !== AIR_ID,
    climbable: CLIMB_RE.test(name),
    openable: DOOR_RE.test(name),
    liquid: LIQUID_RE.test(name),
    hazard: HAZARD_RE.test(name),
    halfHeight: STAIR_SLAB_RE.test(name),
    fence: FENCE_RE.test(name),
  };
}

// ── Helpers ──────────────────────────────────────────────

function isAir(block) {
  return !block || block.stateId === AIR_ID;
}

function canStandOn(cache, x, y, z) {
  const ground = getBlock(cache, x, y - 1, z);
  if (!ground) return false;
  const gc = classifyBlock(ground);
  if (gc.hazard) return false;
  return gc.solid || gc.halfHeight || gc.fence;
}

function bodyFree(cache, x, y, z) {
  const feet = getBlock(cache, x, y, z);
  const head = getBlock(cache, x, y + 1, z);
  const fc = classifyBlock(feet);
  const hc = classifyBlock(head);
  if (fc.hazard || hc.hazard) return false;
  return (isAir(feet) || fc.passable || fc.climbable || fc.liquid || fc.halfHeight) &&
         (isAir(head) || hc.passable || hc.climbable || hc.liquid);
}

export function euclideanDistance(ax, ay, az, bx, by, bz) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2 + (az - bz) ** 2);
}

// ── Priority queue ───────────────────────────────────────

class PQueue {
  constructor() { this.heap = []; }
  push(item, priority) {
    this.heap.push({ item, priority });
    this._up(this.heap.length - 1);
  }
  pop() {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0 && last) { this.heap[0] = last; this._down(0); }
    return top?.item;
  }
  get size() { return this.heap.length; }
  _up(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heap[i].priority >= this.heap[p].priority) break;
      [this.heap[i], this.heap[p]] = [this.heap[p], this.heap[i]];
      i = p;
    }
  }
  _down(i) {
    const n = this.heap.length;
    while (true) {
      let s = i, l = 2 * i + 1, r = 2 * i + 2;
      if (l < n && this.heap[l].priority < this.heap[s].priority) s = l;
      if (r < n && this.heap[r].priority < this.heap[s].priority) s = r;
      if (s === i) break;
      [this.heap[i], this.heap[s]] = [this.heap[s], this.heap[i]];
      i = s;
    }
  }
}

// ── A* pathfinder ────────────────────────────────────────

/**
 * Enhanced A* pathfinding with movement costs.
 *
 * Returns { path, distance, euclidean, cost } or null.
 * path is array of { x, y, z } waypoints.
 */
export function findPath(cache, sx, sy, sz, tx, ty, tz, opts = {}) {
  const maxIterations = opts.maxIterations ?? 5000;
  const allowPillar = opts.allowPillar === true;
  const allowBridge = opts.allowBridge === true;
  const startX = Math.floor(sx), startY = Math.floor(sy), startZ = Math.floor(sz);
  const goalX = Math.floor(tx), goalY = Math.floor(ty), goalZ = Math.floor(tz);
  const euc = euclideanDistance(startX, startY, startZ, goalX, goalY, goalZ);

  if (startX === goalX && startY === goalY && startZ === goalZ) {
    return { path: [{ x: startX, y: startY, z: startZ }], distance: 0, euclidean: 0, cost: 0 };
  }

  const start = `${startX},${startY},${startZ}`;
  const target = `${goalX},${goalY},${goalZ}`;

  const open = new PQueue();
  const cameFrom = new Map();
  const gScore = new Map();

  open.push(start, 0);
  gScore.set(start, 0);

  let iterations = 0;
  const visited = new Set();

  while (open.size > 0 && iterations < maxIterations) {
    iterations++;
    const current = open.pop();
    if (!current) break;

    if (current === target) {
      const path = [];
      let node = current;
      while (node) {
        const [x, y, z] = node.split(',').map(Number);
        path.unshift({ x, y, z });
        node = cameFrom.get(node);
      }
      const cost = gScore.get(current);
      return { path, distance: path.length - 1, euclidean: euc, cost };
    }

    if (visited.has(current)) continue;
    visited.add(current);

    const [cx, cy, cz] = current.split(',').map(Number);
    const currentG = gScore.get(current) ?? Infinity;

    const moves = getNeighbors(cache, cx, cy, cz, { allowPillar, allowBridge });

    for (const { x: nx, y: ny, z: nz, cost } of moves) {
      const nKey = `${nx},${ny},${nz}`;
      if (visited.has(nKey)) continue;

      const tentativeG = currentG + cost;
      if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, current);
        gScore.set(nKey, tentativeG);
        const h = euclideanDistance(nx, ny, nz, goalX, goalY, goalZ);
        open.push(nKey, tentativeG + h);
      }
    }
  }

  return null;
}

/**
 * Generate valid neighbor moves from a position with costs.
 */
function getNeighbors(cache, cx, cy, cz, opts = {}) {
  const { allowPillar = false, allowBridge = false } = opts;
  const moves = [];
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (const [dx, dz] of dirs) {
    const nx = cx + dx, nz = cz + dz;

    // Flat walk (cost 1)
    if (canStandOn(cache, nx, cy, nz) && bodyFree(cache, nx, cy, nz)) {
      const feet = getBlock(cache, nx, cy, nz);
      const fc = classifyBlock(feet);
      if (fc.liquid) { moves.push({ x: nx, y: cy, z: nz, cost: 3 }); }
      else if (fc.openable) { moves.push({ x: nx, y: cy, z: nz, cost: 1.5 }); }
      else { moves.push({ x: nx, y: cy, z: nz, cost: 1 }); }
      continue;
    }

    // Step up 1 block (cost 1.5) — need head clearance above current pos
    const headAbove = getBlock(cache, cx, cy + 2, cz);
    if ((isAir(headAbove) || classifyBlock(headAbove).passable) &&
        canStandOn(cache, nx, cy + 1, nz) && bodyFree(cache, nx, cy + 1, nz)) {
      moves.push({ x: nx, y: cy + 1, z: nz, cost: 1.5 });
      continue;
    }

    // Fall 1-3 blocks (cost 1 + 0.5*height)
    for (let drop = 1; drop <= 3; drop++) {
      const fy = cy - drop;
      if (canStandOn(cache, nx, fy, nz) && bodyFree(cache, nx, fy, nz)) {
        moves.push({ x: nx, y: fy, z: nz, cost: 1 + 0.5 * drop });
        break;
      }
      // Stop if there's a solid block in the way (can't fall through it)
      const mid = getBlock(cache, nx, fy, nz);
      if (mid && classifyBlock(mid).solid) break;
    }
  }

  // Ladder/vine climb up (cost 2)
  const above = getBlock(cache, cx, cy + 1, cz);
  if (above && classifyBlock(above).climbable) {
    const aboveHead = getBlock(cache, cx, cy + 2, cz);
    if (isAir(aboveHead) || classifyBlock(aboveHead).passable || classifyBlock(aboveHead).climbable) {
      moves.push({ x: cx, y: cy + 1, z: cz, cost: 2 });
    }
  }

  // Ladder/vine climb down (cost 2)
  const feetBlock = getBlock(cache, cx, cy, cz);
  if (feetBlock && classifyBlock(feetBlock).climbable) {
    const below = getBlock(cache, cx, cy - 1, cz);
    if (isAir(below) || classifyBlock(below).passable || classifyBlock(below).climbable) {
      moves.push({ x: cx, y: cy - 1, z: cz, cost: 2 });
    }
  }

  // Diagonal movement (cost √2 ≈ 1.414) — both corner blocks must be passable
  const diags = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const [dx, dz] of diags) {
    const nx = cx + dx, nz = cz + dz;
    // Both intermediate corners must be passable (prevent wall-clipping)
    if (!bodyFree(cache, cx + dx, cy, cz)) continue;
    if (!bodyFree(cache, cx, cy, cz + dz)) continue;
    // Flat diagonal
    if (canStandOn(cache, nx, cy, nz) && bodyFree(cache, nx, cy, nz)) {
      moves.push({ x: nx, y: cy, z: nz, cost: 1.414 });
      continue;
    }
    // Diagonal step up (cost 2.1)
    const headAboveDiag = getBlock(cache, cx, cy + 2, cz);
    if ((isAir(headAboveDiag) || classifyBlock(headAboveDiag).passable) &&
        canStandOn(cache, nx, cy + 1, nz) && bodyFree(cache, nx, cy + 1, nz)) {
      moves.push({ x: nx, y: cy + 1, z: nz, cost: 2.1 });
      continue;
    }
    // Diagonal fall 1 block (cost 2.0)
    const fy = cy - 1;
    if (canStandOn(cache, nx, fy, nz) && bodyFree(cache, nx, fy, nz)) {
      const mid = getBlock(cache, nx, cy, nz);
      if (!mid || !classifyBlock(mid).solid) {
        moves.push({ x: nx, y: fy, z: nz, cost: 2.0 });
      }
    }
  }

  // Pillar-up: place block beneath self to step up (cost 4, tagged as pillar)
  if (allowPillar) {
    const head2 = getBlock(cache, cx, cy + 2, cz);
    if (isAir(head2) || classifyBlock(head2).passable) {
      moves.push({ x: cx, y: cy + 1, z: cz, cost: 4, move: 'pillar' });
    }
  }

  // Bridge: place block in gap to walk across (cost 3, tagged as bridge)
  if (allowBridge) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, nz = cz + dz;
      // Target space is free (air or passable) but ground beneath is also free → gap
      if (bodyFree(cache, nx, cy, nz) && !canStandOn(cache, nx, cy, nz)) {
        const gapFloor = getBlock(cache, nx, cy - 1, nz);
        if (!gapFloor || isAir(gapFloor)) {
          moves.push({ x: nx, y: cy, z: nz, cost: 3, move: 'bridge' });
        }
      }
    }
  }

  return moves;
}
