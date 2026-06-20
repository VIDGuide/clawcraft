import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMovePlayer, buildPlayerAuthInput, buildChat } from '../src/packets.js';
import { createState, setPosition, setRotation } from '../src/state.js';

describe('buildMovePlayer', () => {
  it('builds a normal movement packet', () => {
    const state = { ...createState(), runtimeId: 42 };
    const pkt = buildMovePlayer(state, 10, 64, 20, 0, Math.PI / 2, 'normal');

    assert.equal(pkt.runtime_id, 42);
    assert.deepEqual(pkt.position, { x: 10, y: 64, z: 20 });
    assert.equal(pkt.pitch, 0);
    assert.equal(pkt.yaw, Math.PI / 2);
    assert.equal(pkt.head_yaw, Math.PI / 2);
    assert.equal(pkt.mode, 'normal');
    assert.equal(pkt.on_ground, true);
    assert.equal(pkt.ridden_runtime_id, 0);
    assert.equal(pkt.tick, 0n);
  });

  it('builds a teleport packet with cause', () => {
    const state = createState();
    const pkt = buildMovePlayer(state, 0, 64, 0, 0, 0, 'teleport');

    assert.equal(pkt.mode, 'teleport');
    assert.equal(pkt.cause, 'command');
    assert.equal(pkt.source_entity_type, 'player');
  });

  it('uses state defaults when yaw/pitch omitted', () => {
    const state = setRotation(setPosition(createState(), 5, 64, 5), 1.5, -0.3);
    const pkt = buildMovePlayer(state, 10, 64, 10);

    assert.equal(pkt.yaw, 1.5);
    assert.equal(pkt.pitch, -0.3);
    assert.equal(pkt.head_yaw, 1.5);
  });

  it('defaults runtime_id to 0 when unknown', () => {
    const state = createState();
    const pkt = buildMovePlayer(state, 0, 64, 0);
    assert.equal(pkt.runtime_id, 0);
  });
});

describe('buildPlayerAuthInput', () => {
  it('builds a valid auth input packet', () => {
    const state = { ...createState(), runtimeId: 42 };
    const pkt = buildPlayerAuthInput(state, 10, 64, 20);

    assert.deepEqual(pkt.position, { x: 10, y: 64, z: 20 });
    assert.equal(typeof pkt.tick, 'bigint');
    assert.equal(pkt.play_mode, 'normal');
    assert.equal(pkt.input_mode, 'mouse');
    assert.equal(pkt.interaction_model, 'touch');

    // Check input_data has all required flags as false
    const flags = ['ascend', 'descend', 'jumping', 'sneaking', 'sprinting',
                   'up', 'down', 'left', 'right'];
    for (const f of flags) {
      assert.equal(pkt.input_data[f], false, `flag ${f} should be false`);
    }
  });
});

describe('buildChat', () => {
  it('builds a raw chat packet', () => {
    const pkt = buildChat('Hello world', 'raw');

    assert.equal(pkt.type, 'raw');
    assert.equal(pkt.message, 'Hello world');
    assert.equal(pkt.needs_translation, false);
  });

  it('builds a chat-type packet with source_name', () => {
    const pkt = buildChat('Hello', 'chat');

    assert.equal(pkt.type, 'chat');
    assert.equal(pkt.message, 'Hello');
    assert.equal(typeof pkt.source_name, 'string');
  });

  it('includes required xuid and platform_chat_id', () => {
    const pkt = buildChat('Hi', 'raw');
    assert.equal(typeof pkt.xuid, 'string');
    assert.equal(typeof pkt.platform_chat_id, 'string');
  });
});
