import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createState, applyMovePlayer, setPosition, setRotation, setConnected, setSpawned, setMovementAuthority } from '../src/state.js';

describe('state', () => {
  it('creates default state', () => {
    const s = createState();
    assert.equal(s.connected, false);
    assert.equal(s.spawned, false);
    assert.equal(s.pos, null);
    assert.equal(s.yaw, 0);
    assert.equal(s.pitch, 0);
    assert.equal(s.headYaw, 0);
    assert.equal(s.runtimeId, null);
    assert.equal(s.movementAuthority, 'server');
    assert.equal(s.rewindHistorySize, 0);
  });

  it('applies move_player packet to update position (server degrees → internal radians)', () => {
    const s = createState();
    // Server sends rotation in DEGREES; applyMovePlayer converts to radians.
    const pkt = {
      position: { x: 10.5, y: 64, z: -20.3 },
      yaw: 90,
      pitch: -45,
      head_yaw: 90,
      runtime_id: 42,
    };
    const updated = applyMovePlayer(s, pkt);

    assert.deepEqual(updated.pos, { x: 10.5, y: 64, z: -20.3 });
    assert.ok(Math.abs(updated.yaw - Math.PI / 2) < 1e-6, 'yaw 90° → PI/2 rad');
    assert.ok(Math.abs(updated.pitch + Math.PI / 4) < 1e-6, 'pitch -45° → -PI/4 rad');
    assert.ok(Math.abs(updated.headYaw - Math.PI / 2) < 1e-6, 'head_yaw 90° → PI/2 rad');
    // runtimeId is intentionally NOT updated from move_player (set from start_game only)
    assert.equal(updated.runtimeId, null);
  });

  it('preserves existing position on null packet', () => {
    const s = setPosition(createState(), 1, 2, 3);
    const updated = applyMovePlayer(s, null);
    assert.deepEqual(updated.pos, { x: 1, y: 2, z: 3 });
  });

  it('setPosition updates position', () => {
    const s = setPosition(createState(), 100, 200, 300);
    assert.deepEqual(s.pos, { x: 100, y: 200, z: 300 });
  });

  it('setRotation updates yaw/pitch/headYaw', () => {
    const s = setRotation(createState(), 1.5, -0.7);
    assert.equal(s.yaw, 1.5);
    assert.equal(s.pitch, -0.7);
    assert.equal(s.headYaw, 1.5);
  });

  it('setConnected also unsets spawned', () => {
    const s = setSpawned(setConnected(createState(), true), true);
    assert.equal(s.connected, true);
    assert.equal(s.spawned, true);

    const d = setConnected(s, false);
    assert.equal(d.connected, false);
    assert.equal(d.spawned, false);
  });

  it('setMovementAuthority updates authority and rewind size', () => {
    const s = setMovementAuthority(createState(), 'server_with_rewind', 20);
    assert.equal(s.movementAuthority, 'server_with_rewind');
    assert.equal(s.rewindHistorySize, 20);
  });

  it('setMovementAuthority preserves existing values when args omitted', () => {
    const base = setMovementAuthority(createState(), 'server_with_rewind', 20);
    const s = setMovementAuthority(base, undefined, undefined);
    assert.equal(s.movementAuthority, 'server_with_rewind');
    assert.equal(s.rewindHistorySize, 20);
  });
});
