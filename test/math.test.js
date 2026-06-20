import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { faceAngles, walkSteps } from '../src/math.js';

describe('faceAngles', () => {
  it('looks east (positive x)', () => {
    const from = { x: 0, y: 64, z: 0 };
    const to = { x: 10, y: 64, z: 0 };
    const { yaw, pitch } = faceAngles(from, to);
    // East: yaw should be -PI/2
    assert.ok(Math.abs(yaw + Math.PI / 2) < 0.001);
    assert.ok(Math.abs(pitch) < 0.001);
  });

  it('looks west (negative x)', () => {
    const from = { x: 0, y: 64, z: 0 };
    const to = { x: -10, y: 64, z: 0 };
    const { yaw, pitch } = faceAngles(from, to);
    // West: yaw should be PI/2
    assert.ok(Math.abs(yaw - Math.PI / 2) < 0.001);
    assert.ok(Math.abs(pitch) < 0.001);
  });

  it('looks south (positive z)', () => {
    const from = { x: 0, y: 64, z: 0 };
    const to = { x: 0, y: 64, z: 10 };
    const { yaw, pitch } = faceAngles(from, to);
    // South: yaw should be 0
    assert.ok(Math.abs(yaw) < 0.001);
    assert.ok(Math.abs(pitch) < 0.001);
  });

  it('looks north (negative z)', () => {
    const from = { x: 0, y: 64, z: 0 };
    const to = { x: 0, y: 64, z: -10 };
    const { yaw, pitch } = faceAngles(from, to);
    // North: yaw should be ±PI (atan2 can return PI or -PI)
    assert.ok(Math.abs(Math.abs(yaw) - Math.PI) < 0.001);
    assert.ok(Math.abs(pitch) < 0.001);
  });

  it('looks upward', () => {
    const from = { x: 0, y: 64, z: 0 };
    const to = { x: 0, y: 80, z: 0 };
    const { yaw, pitch } = faceAngles(from, to);
    // Same x/z = pitch down (negative)
    assert(pitch < -1.5);
  });

  it('looks downward', () => {
    const from = { x: 0, y: 64, z: 0 };
    const to = { x: 0, y: 60, z: 0 };
    const { yaw, pitch } = faceAngles(from, to);
    // Same x/z looking down = pitch up (positive)
    assert(pitch > 1.5);
  });

  it('returns zero for same position', () => {
    const from = { x: 5, y: 64, z: 10 };
    const { yaw, pitch } = faceAngles(from, from);
    assert.equal(yaw, 0);
    assert.equal(pitch, 0);
  });

  it('45-degree diagonal', () => {
    const from = { x: 0, y: 64, z: 0 };
    const to = { x: 10, y: 64, z: 10 };
    const { yaw, pitch } = faceAngles(from, to);
    // SE diagonal: yaw should be -PI/4
    assert.ok(Math.abs(yaw + Math.PI / 4) < 0.001);
    assert.ok(Math.abs(pitch) < 0.001);
  });
});

describe('walkSteps', () => {
  it('returns empty array when already at destination', () => {
    const from = { x: 5, y: 64, z: 10 };
    const steps = walkSteps(from, from);
    assert.deepEqual(steps, []);
  });

  it('returns correct number of steps for distance', () => {
    const from = { x: 0, y: 64, z: 0 };
    const to = { x: 0, y: 64, z: 10 };
    const steps = walkSteps(from, to, 0.5);
    // 10 blocks / 0.5 = 20 steps
    assert.equal(steps.length, 20);
  });

  it('ends at destination', () => {
    const from = { x: 0, y: 64, z: 0 };
    const to = { x: 10, y: 64, z: 0 };
    const steps = walkSteps(from, to, 2);
    const last = steps[steps.length - 1];
    assert.equal(last.x, 10);
    assert.equal(last.y, 64);
    assert.equal(last.z, 0);
  });

  it('moves linearly', () => {
    const from = { x: 0, y: 64, z: 0 };
    const to = { x: 10, y: 64, z: 0 };
    const steps = walkSteps(from, to, 5);
    // 2 steps
    assert.equal(steps.length, 2);
    // Step 1: 5, 64, 0
    assert.deepEqual(steps[0], { x: 5, y: 64, z: 0 });
    // Step 2: 10, 64, 0
    assert.deepEqual(steps[1], { x: 10, y: 64, z: 0 });
  });

  it('handles 3D movement', () => {
    const from = { x: 0, y: 64, z: 0 };
    const to = { x: 2, y: 66, z: 2 };
    const steps = walkSteps(from, to, 1);
    assert.equal(steps.length, 4); // dist ~3.46 → ceil(3.46) = 4
    const last = steps[steps.length - 1];
    assert.ok(Math.abs(last.x - 2) < 0.001);
    assert.ok(Math.abs(last.y - 66) < 0.001);
    assert.ok(Math.abs(last.z - 2) < 0.001);
  });
});
