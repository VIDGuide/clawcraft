import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createState, applyMovePlayer, setPosition, setRotation, setConnected, setSpawned } from '../src/state.js';

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
  });

  it('applies move_player packet to update position', () => {
    const s = createState();
    const pkt = {
      position: { x: 10.5, y: 64, z: -20.3 },
      yaw: 1.2,
      pitch: -0.5,
      head_yaw: 1.2,
      runtime_id: 42,
    };
    const updated = applyMovePlayer(s, pkt);

    assert.deepEqual(updated.pos, { x: 10.5, y: 64, z: -20.3 });
    assert.equal(updated.yaw, 1.2);
    assert.equal(updated.pitch, -0.5);
    assert.equal(updated.headYaw, 1.2);
    assert.equal(updated.runtimeId, 42);
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
});
