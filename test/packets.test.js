import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildMovePlayer, buildPlayerAuthInput, buildChat, buildPlayerAction, buildItemUseTransaction, buildItemUseOnEntityTransaction, buildItemReleaseTransaction } from '../src/packets.js';
import { createState, setPosition, setRotation } from '../src/state.js';
import { radToDeg } from '../src/math.js';

describe('buildMovePlayer', () => {
  it('builds a normal movement packet (yaw radians → degrees on the wire)', () => {
    const state = { ...createState(), runtimeId: 42 };
    const pkt = buildMovePlayer(state, 10, 64, 20, 0, Math.PI / 2, 'normal');

    assert.equal(pkt.runtime_id, 42);
    assert.deepEqual(pkt.position, { x: 10, y: 64, z: 20 });
    assert.equal(pkt.pitch, 0);
    // Internal radians (PI/2) must be emitted as degrees (90).
    assert.equal(pkt.yaw, 90);
    assert.equal(pkt.head_yaw, 90);
    assert.equal(pkt.mode, 'normal');
    assert.equal(pkt.on_ground, true);
    assert.equal(pkt.ridden_runtime_id, 0);
    assert.equal(pkt.tick, 0n);
  });

  it('builds a teleport packet with cause', () => {
    const state = createState();
    const pkt = buildMovePlayer(state, 0, 64, 0, 0, 0, 'teleport');

    assert.equal(pkt.mode, 'teleport');
    assert.equal(pkt.teleport.cause, 'command');
    assert.equal(pkt.teleport.source_entity_type, 'player');
  });

  it('uses state defaults when yaw/pitch omitted (converted to degrees)', () => {
    const state = setRotation(setPosition(createState(), 5, 64, 5), 1.5, -0.3);
    const pkt = buildMovePlayer(state, 10, 64, 10);

    assert.ok(Math.abs(pkt.yaw - radToDeg(1.5)) < 1e-6);
    assert.ok(Math.abs(pkt.pitch - radToDeg(-0.3)) < 1e-6);
    assert.ok(Math.abs(pkt.head_yaw - radToDeg(1.5)) < 1e-6);
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
                   'down', 'left', 'right', 'item_interact', 'block_action',
                   'item_stack_request', 'client_predicted_vehicle'];
    for (const f of flags) {
      assert.equal(pkt.input_data[f], false, `flag ${f} should be false`);
    }
  });

  it('emits rotation in degrees, not radians', () => {
    const state = { ...createState(), pos: { x: 0, y: 64, z: 0 } };
    // yaw = PI radians should become 180 degrees
    const pkt = buildPlayerAuthInput(state, 0, 64, 0, Math.PI, 0);
    assert.ok(Math.abs(pkt.yaw - 180) < 1e-6, `yaw should be 180 deg, got ${pkt.yaw}`);
    assert.ok(Math.abs(pkt.head_yaw - 180) < 1e-6);
  });

  it('movement is driven by analog move_vector, never the up flag', () => {
    const state = { ...createState(), pos: { x: 0, y: 64, z: 0 } };
    // Moving to a new XZ position → local forward {x:0, z:1}, all analog vectors match.
    const moving = buildPlayerAuthInput(state, 5, 64, 0, 0, 0);
    assert.deepEqual(moving.move_vector, { x: 0, z: 1 });
    assert.deepEqual(moving.analogue_move_vector, { x: 0, z: 1 });
    assert.deepEqual(moving.raw_move_vector, { x: 0, z: 1 });
    // Real client never sets `up` while walking.
    assert.equal(moving.input_data.up, false);
    // Standing still → zero move vector.
    const still = buildPlayerAuthInput(state, 0, 64, 0, 0, 0);
    assert.deepEqual(still.move_vector, { x: 0, z: 0 });
    assert.equal(still.input_data.up, false);
  });

  it('moveForward sets an analog magnitude (ramp), clamped to 0..1', () => {
    const state = { ...createState(), pos: { x: 0, y: 64, z: 0 } };
    const ramp = buildPlayerAuthInput(state, 5, 64, 0, 0, 0, 'mouse', { moveForward: 0.35 });
    assert.ok(Math.abs(ramp.move_vector.z - 0.35) < 1e-9);
    assert.ok(Math.abs(ramp.analogue_move_vector.z - 0.35) < 1e-9);
    // Clamp above 1 and below 0.
    assert.equal(buildPlayerAuthInput(state, 5, 64, 0, 0, 0, 'mouse', { moveForward: 5 }).move_vector.z, 1);
    assert.equal(buildPlayerAuthInput(state, 5, 64, 0, 0, 0, 'mouse', { moveForward: -2 }).move_vector.z, 0);
  });

  it('sets ground/break flags like the real client', () => {
    const state = { ...createState(), pos: { x: 0, y: 64, z: 0 } };
    const onGround = buildPlayerAuthInput(state, 0, 64, 0, 0, 0);
    assert.equal(onGround.input_data.vertical_collision, true);
    assert.equal(onGround.input_data.block_breaking_delay_enabled, true);
    const airborne = buildPlayerAuthInput(state, 0, 64, 0, 0, 0, 'mouse', { onGround: false });
    assert.equal(airborne.input_data.vertical_collision, false);
  });

  it('tick comes from opts.tick (local monotonic counter)', () => {
    const state = { ...createState(), pos: { x: 0, y: 64, z: 0 } };
    const pkt = buildPlayerAuthInput(state, 0, 64, 0, 0, 0, 'mouse', { tick: 42n });
    assert.equal(pkt.tick, 42n);
  });

  it('delta carries world-space displacement to the target', () => {
    const state = { ...createState(), pos: { x: 1, y: 64, z: 2 } };
    const pkt = buildPlayerAuthInput(state, 4, 64, 6, 0, 0);
    assert.deepEqual(pkt.delta, { x: 3, y: 0, z: 4 });
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

describe('buildPlayerAction', () => {
  it('builds a start_break action', () => {
    const pkt = buildPlayerAction(42, 'start_break', { x: 10, y: 64, z: 20 }, { x: 10, y: 64, z: 20 }, 1);
    assert.equal(pkt.runtime_entity_id, 42);
    assert.equal(pkt.action, 'start_break');
    assert.deepEqual(pkt.position, { x: 10, y: 64, z: 20 });
    assert.deepEqual(pkt.result_position, { x: 10, y: 64, z: 20 });
    assert.equal(pkt.face, 1);
  });

  it('defaults position and face', () => {
    const pkt = buildPlayerAction(1, 'drop_item');
    assert.deepEqual(pkt.position, { x: 0, y: 0, z: 0 });
    assert.deepEqual(pkt.result_position, { x: 0, y: 0, z: 0 });
    assert.equal(pkt.face, 0);
  });
});

describe('buildItemUseTransaction', () => {
  it('builds a click_block transaction', () => {
    const pkt = buildItemUseTransaction('click_block', 'player_input', { x: 5, y: 60, z: 5 }, 1, 0, { network_id: 318 }, { x: 1, y: 64, z: 1 }, { x: 0.5, y: 0.5, z: 0.5 }, 123);
    const t = pkt.transaction;
    assert.equal(t.transaction_type, 'item_use');
    assert.deepEqual(t.legacy, { legacy_request_id: 0 });
    assert.deepEqual(t.actions, []);
    assert.equal(t.transaction_data.action_type, 'click_block');
    assert.equal(t.transaction_data.trigger_type, 'player_input');
    assert.deepEqual(t.transaction_data.block_position, { x: 5, y: 60, z: 5 });
    assert.equal(t.transaction_data.face, 1);
    assert.equal(t.transaction_data.hotbar_slot, 0);
    assert.deepEqual(t.transaction_data.held_item, { network_id: 318 });
    assert.equal(t.transaction_data.block_runtime_id, 123);
    assert.equal(t.transaction_data.client_prediction, 'success');
    assert.equal(t.transaction_data.client_cooldown_state, 'off');
  });

  it('builds a break_block transaction', () => {
    const pkt = buildItemUseTransaction('break_block', 'player_input', { x: 0, y: 0, z: 0 }, 0, 0, { network_id: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, 0);
    assert.equal(pkt.transaction.transaction_data.action_type, 'break_block');
  });
});

describe('buildItemUseOnEntityTransaction', () => {
  it('builds an attack transaction', () => {
    const pkt = buildItemUseOnEntityTransaction(99, 'attack', 0, { network_id: 307 }, { x: 1, y: 64, z: 1 }, { x: 2, y: 64, z: 2 });
    const t = pkt.transaction;
    assert.equal(t.transaction_type, 'item_use_on_entity');
    assert.deepEqual(t.legacy, { legacy_request_id: 0 });
    assert.deepEqual(t.actions, []);
    assert.equal(t.transaction_data.entity_runtime_id, 99);
    assert.equal(t.transaction_data.action_type, 'attack');
    assert.equal(t.transaction_data.hotbar_slot, 0);
    assert.deepEqual(t.transaction_data.held_item, { network_id: 307 });
  });

  it('builds an interact transaction', () => {
    const pkt = buildItemUseOnEntityTransaction(50, 'interact', 1, { network_id: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    assert.equal(pkt.transaction.transaction_data.action_type, 'interact');
  });
});

describe('buildItemReleaseTransaction', () => {
  it('builds a consume transaction', () => {
    const pkt = buildItemReleaseTransaction('consume', 0, { network_id: 260 }, { x: 1, y: 65, z: 1 });
    const t = pkt.transaction;
    assert.equal(t.transaction_type, 'item_release');
    assert.deepEqual(t.legacy, { legacy_request_id: 0 });
    assert.deepEqual(t.actions, []);
    assert.equal(t.transaction_data.action_type, 'consume');
    assert.equal(t.transaction_data.hotbar_slot, 0);
    assert.deepEqual(t.transaction_data.held_item, { network_id: 260 });
    assert.deepEqual(t.transaction_data.head_pos, { x: 1, y: 65, z: 1 });
  });

  it('builds a release transaction', () => {
    const pkt = buildItemReleaseTransaction('release', 2, { network_id: 344 }, { x: 0, y: 64, z: 0 });
    assert.equal(pkt.transaction.transaction_data.action_type, 'release');
    assert.equal(pkt.transaction.transaction_data.hotbar_slot, 2);
  });
});

describe('buildPlayerAuthInput sprint flag', () => {
  const state = createState();

  it('sprint flags are false by default', () => {
    const pkt = buildPlayerAuthInput(state, 0, 64, 0);
    assert.equal(pkt.input_data.sprinting, false);
    assert.equal(pkt.input_data.sprint_down, false);
    assert.equal(pkt.input_data.start_sprinting, false);
  });

  it('sprint flags are set when opts.sprinting=true', () => {
    const pkt = buildPlayerAuthInput(state, 0, 64, 0, undefined, undefined, 'mouse', { sprinting: true });
    assert.equal(pkt.input_data.sprinting, true);
    assert.equal(pkt.input_data.sprint_down, true);
    assert.equal(pkt.input_data.start_sprinting, true);
  });
});
