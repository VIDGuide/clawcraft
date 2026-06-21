/**
 * ClawCraft — Coordinate math
 *
 * Pure functions for movement calculations.
 * No I/O, fully testable.
 */

/**
 * Calculate yaw and pitch to look from `from` toward `to`.
 * Returns { yaw, pitch } in radians.
 */
export function faceAngles(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist === 0) return { yaw: 0, pitch: 0 };

  return {
    pitch: -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)),
    yaw: Math.atan2(-dx, dz),
  };
}

/**
 * Calculate walk steps from `from` to `to`.
 * Returns array of intermediate positions (excluding start, including end).
 */
export function walkSteps(from, to, speed = 0.5) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist < 0.01) return [];

  const nSteps = Math.ceil(dist / speed);
  const steps = [];

  for (let i = 1; i <= nSteps; i++) {
    const t = i / nSteps;
    steps.push({
      x: from.x + dx * t,
      y: from.y + dy * t,
      z: from.z + dz * t,
    });
  }

  return steps;
}
