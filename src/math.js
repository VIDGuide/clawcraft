/**
 * ClawCraft — Coordinate math
 *
 * Pure functions for movement calculations.
 * No I/O, fully testable.
 *
 * ANGLE CONVENTION: this module (and the rest of the internal state) works in
 * RADIANS. The Bedrock wire protocol uses DEGREES for yaw/pitch/head_yaw. The
 * conversion happens once, at the packet boundary, in packets.js via radToDeg().
 * The orientation matches Minecraft's yaw (0 = south/+Z, +90° = west/-X,
 * ±180° = north/-Z, -90° = east/+X), just expressed in radians here.
 */

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/** Convert radians → degrees (Bedrock wire format for rotation fields). */
export function radToDeg(rad) {
  return rad * RAD_TO_DEG;
}

/** Convert degrees (from the server) → radians (internal convention). */
export function degToRad(deg) {
  return deg * DEG_TO_RAD;
}

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
export function walkSteps(from, to, speed = 0.18) {
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
