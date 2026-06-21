/**
 * Suite: pathfinding
 * Validates structural invariants of the A* pathfinder (path command) that are most
 * likely to regress: path continuity, endpoints, field consistency, and agreement
 * between path/reachable. These run against the live world so they exercise real
 * decoded chunk data, not synthetic fixtures.
 */
import { test, cmd, assert, assertNoError } from '../runner.js';

const startResp = await cmd('pos');
const start = startResp.pos;

// Helper: validate a single A* step matches the pathfinder's movement model.
// Horizontal: dx/dz at most 1 (orthogonal or diagonal).
// Vertical: step-up +1, ladder ±1, or fall down to -3. Must move somewhere.
function isAdjacent(a, b) {
  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  const dy = b.y - a.y; // signed: positive = up, negative = down
  if (dx > 1 || dz > 1) return false;
  if (dy > 1 || dy < -3) return false;
  return (dx + dz + Math.abs(dy)) > 0;
}

// Find a target the pathfinder can actually reach, scanning a few nearby offsets.
async function findReachableTarget() {
  if (!start) return null;
  const offsets = [
    [3, 0, 0], [0, 0, 3], [-3, 0, 0], [0, 0, -3],
    [4, 0, 4], [-4, 0, -4], [5, 0, 0], [0, 0, 5],
  ];
  for (const [dx, dy, dz] of offsets) {
    const target = { x: Math.floor(start.x) + dx, y: Math.floor(start.y) + dy, z: Math.floor(start.z) + dz };
    const resp = await cmd('path', target);
    if (!resp.error && Array.isArray(resp.path) && resp.path.length > 1) {
      return { target, resp };
    }
  }
  return null;
}

await test('path waypoints follow valid movement steps (no gaps/teleports)', async () => {
  assert(start != null, 'need a position');
  const found = await findReachableTarget();
  if (!found) {
    console.log('    (no reachable multi-step target nearby — terrain may be obstructed)');
    return;
  }
  const { path } = found.resp;
  for (let i = 1; i < path.length; i++) {
    assert(
      isAdjacent(path[i - 1], path[i]),
      `invalid step ${i - 1}→${i}: ${JSON.stringify(path[i - 1])} → ${JSON.stringify(path[i])}`,
    );
  }
});

await test('path starts at bot position and ends at (or adjacent to) target', async () => {
  assert(start != null, 'need a position');
  const found = await findReachableTarget();
  if (!found) {
    console.log('    (no reachable target nearby)');
    return;
  }
  const { target, resp } = found;
  const path = resp.path;
  const first = path[0];
  const last = path[path.length - 1];

  // First waypoint should match the floored bot start position
  assert(first.x === Math.floor(start.x) && first.z === Math.floor(start.z),
    `path should start at bot pos (${Math.floor(start.x)},${Math.floor(start.z)}), got (${first.x},${first.z})`);

  // Last waypoint should be the target (pathfinder may end adjacent if exact cell unwalkable)
  const dx = Math.abs(last.x - target.x);
  const dz = Math.abs(last.z - target.z);
  assert(dx <= 1 && dz <= 1, `path should end at/near target ${JSON.stringify(target)}, got ${JSON.stringify(last)}`);
});

await test('path distance field equals waypoint count minus one', async () => {
  assert(start != null, 'need a position');
  const found = await findReachableTarget();
  if (!found) {
    console.log('    (no reachable target nearby)');
    return;
  }
  const { resp } = found;
  assert(resp.distance === resp.path.length - 1,
    `distance (${resp.distance}) should equal path.length-1 (${resp.path.length - 1})`);
  assert(resp.length === resp.path.length, `length field should equal path array length`);
  assert(typeof resp.cost === 'number' && resp.cost >= 0, `cost should be a non-negative number, got ${resp.cost}`);
});

await test('path cost is at least the euclidean distance (admissible heuristic)', async () => {
  assert(start != null, 'need a position');
  const found = await findReachableTarget();
  if (!found) {
    console.log('    (no reachable target nearby)');
    return;
  }
  const { resp } = found;
  // A* path cost can never be shorter than the straight-line distance.
  assert(resp.cost >= resp.euclidean - 0.01,
    `path cost (${resp.cost}) should be >= euclidean (${resp.euclidean})`);
});

await test('path and reachable agree for the same target', async () => {
  assert(start != null, 'need a position');
  const found = await findReachableTarget();
  if (!found) {
    console.log('    (no reachable target nearby)');
    return;
  }
  const { target } = found;
  const reach = await cmd('reachable', target);
  assertNoError(reach, 'reachable');
  assert(reach.reachable === true,
    `reachable should be true for a target that path found a route to: ${JSON.stringify(target)}`);
});

await test('path to self is trivial (single waypoint, zero distance)', async () => {
  assert(start != null, 'need a position');
  const resp = await cmd('path', { x: Math.floor(start.x), y: Math.floor(start.y), z: Math.floor(start.z) });
  assertNoError(resp, 'path to self');
  assert(resp.path.length === 1, `path to self should have 1 waypoint, got ${resp.path.length}`);
  assert(resp.distance === 0, `path to self distance should be 0, got ${resp.distance}`);
});

await test('unreachable far target reports no path (within iteration budget)', async () => {
  assert(start != null, 'need a position');
  // A point far away and high in the air should be unreachable from the ground
  // without pillaring, which the default path does not allow.
  const target = { x: Math.floor(start.x) + 2, y: Math.floor(start.y) + 30, z: Math.floor(start.z) + 2 };
  const resp = await cmd('path', target);
  // Either "No path found" error, or a path that does NOT reach the floating target.
  if (resp.error) {
    assert(resp.error.includes('No path'), `expected no-path error, got: ${resp.error}`);
  } else {
    const last = resp.path[resp.path.length - 1];
    assert(last.y < target.y, `should not reach a floating target without pillaring (last.y=${last.y}, target.y=${target.y})`);
  }
});

await test('reachable reports euclidean even when unreachable', async () => {
  assert(start != null, 'need a position');
  const target = { x: Math.floor(start.x) + 2, y: Math.floor(start.y) + 40, z: Math.floor(start.z) + 2 };
  const resp = await cmd('reachable', target);
  assertNoError(resp, 'reachable far');
  assert(typeof resp.euclidean === 'number' && resp.euclidean > 0,
    `euclidean should be reported regardless of reachability, got ${resp.euclidean}`);
  if (!resp.reachable) {
    assert(resp.distance === null, 'distance should be null when unreachable');
    assert(resp.estimatedTime === null, 'estimatedTime should be null when unreachable');
  }
});
