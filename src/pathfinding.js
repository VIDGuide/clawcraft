/**
 * ClawMine — A* pathfinding on chunk grid
 *
 * Finds a walkable path from A to B avoiding solid blocks.
 * Operates on the chunk cache — queries getBlock for each step.
 * Pure logic, fully testable with mocked chunks.
 */

import { getBlock } from './chunks.js';
import { AIR_ID } from './constants.js';

function isAir(block) {
  return !block || block.stateId === AIR_ID;
}

function isSolid(block) {
  return block && block.stateId !== AIR_ID;
}

/**
 * Check if a block position is walkable (solid below, air at feet, air at head).
 */
function isWalkable(cache, x, y, z) {
  const ground = getBlock(cache, x, y - 1, z);
  const feet = getBlock(cache, x, y, z);
  const head = getBlock(cache, x, y + 1, z);
  return isSolid(ground) && isAir(feet) && isAir(head);
}

/**
 * Check if a block position is a step-up (solid below, air at target).
 */
function isStepUp(cache, x, y, z) {
  const below = getBlock(cache, x, y - 1, z);
  const at = getBlock(cache, x, y, z);
  const above = getBlock(cache, x, y + 1, z);
  return isSolid(below) && isAir(at) && isAir(above);
}

/**
 * Manhattan distance heuristic.
 */
function heuristic(ax, ay, az, bx, by, bz) {
  return Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz);
}

/**
 * Priority queue for A* open set.
 */
class PQueue {
  constructor() {
    this.items = [];
  }
  push(item, priority) {
    this.items.push({ item, priority });
    this.items.sort((a, b) => a.priority - b.priority);
  }
  pop() {
    return this.items.shift()?.item;
  }
  get size() {
    return this.items.length;
  }
}

/**
 * Find a walkable path from (sx, sy, sz) to (tx, ty, tz).
 * Uses A* on the 3D chunk grid.
 *
 * Returns array of { x, y, z } waypoints, or null if no path found.
 */
export function findPath(cache, sx, sy, sz, tx, ty, tz, maxIterations = 5000) {
  const start = `${Math.floor(sx)},${Math.floor(sy)},${Math.floor(sz)}`;
  const target = `${Math.floor(tx)},${Math.floor(ty)},${Math.floor(tz)}`;

  if (start === target) return [{ x: Math.floor(sx), y: Math.floor(sy), z: Math.floor(sz) }];

  const open = new PQueue();
  const cameFrom = new Map();
  const gScore = new Map();
  const fScore = new Map();

  open.push(start, 0);
  gScore.set(start, 0);
  fScore.set(start, heuristic(sx, sy, sz, tx, ty, tz));

  let iterations = 0;
  const visited = new Set();

  while (open.size > 0 && iterations < maxIterations) {
    iterations++;
    const current = open.pop();
    if (!current) break;

    if (current === target) {
      // Reconstruct path
      const path = [];
      let node = current;
      while (node) {
        const [x, y, z] = node.split(',').map(Number);
        path.unshift({ x, y, z });
        node = cameFrom.get(node);
      }
      return path;
    }

    if (visited.has(current)) continue;
    visited.add(current);

    const [cx, cy, cz] = current.split(',').map(Number);
    const currentG = gScore.get(current) ?? Infinity;

    // Neighbors: 4 horizontal directions + up/down
    const neighbors = [
      [cx + 1, cy, cz], [cx - 1, cy, cz],
      [cx, cy, cz + 1], [cx, cy, cz - 1],
    ];

    for (const [nx, ny, nz] of neighbors) {
      const nKey = `${nx},${ny},${nz}`;
      if (visited.has(nKey)) continue;

      // Check if walkable (air at feet and head) or a step-up
      let walkable = false;
      let actualY = ny;

      if (isWalkable(cache, nx, ny, nz)) {
        walkable = true;
      } else if (isStepUp(cache, nx, ny + 1, nz)) {
        // Step up one block
        walkable = true;
        actualY = ny + 1;
      } else if (isWalkable(cache, nx, ny - 1, nz)) {
        // Step down one block — isWalkable already checks for solid ground at ny-2
        walkable = true;
        actualY = ny - 1;
      }

      if (!walkable) continue;

      const stepKey = `${nx},${actualY},${nz}`;
      const tentativeG = currentG + 1;

      if (tentativeG < (gScore.get(stepKey) ?? Infinity)) {
        cameFrom.set(stepKey, current);
        gScore.set(stepKey, tentativeG);
        fScore.set(stepKey, tentativeG + heuristic(nx, actualY, nz, tx, ty, tz));
        open.push(stepKey, fScore.get(stepKey));
      }
    }
  }

  return null; // No path found
}
