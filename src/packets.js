/**
 * ClawMine — Packet structure builders
 *
 * Pure functions for constructing Bedrock protocol packet payloads.
 * Returns plain objects ready to pass to client.queue().
 * No I/O, fully testable.
 */

/**
 * Build a move_player packet.
 * Mode: 'normal' | 'reset' | 'teleport' | 'rotation'
 */
export function buildMovePlayer(state, x, y, z, pitch, yaw, mode = 'normal') {
  const pkt = {
    runtime_id: state.runtimeId ?? 0,
    position: { x, y, z },
    pitch: pitch ?? state.pitch ?? 0,
    yaw: yaw ?? state.yaw ?? 0,
    head_yaw: yaw ?? state.headYaw ?? 0,
    mode,
    on_ground: true,
    ridden_runtime_id: 0,
    tick: 0n,
  };

  if (mode === 'teleport') {
    pkt.teleport = { cause: 'command', source_entity_type: 'player' };
  }

  return pkt;
}

/**
 * Build a player_auth_input packet.
 */
export function buildPlayerAuthInput(state, x, y, z, yawVal, pitchVal, inputMode = 'mouse') {
  return {
    pitch: pitchVal ?? state.pitch ?? 0,
    yaw: yawVal ?? state.yaw ?? 0,
    position: { x, y, z },
    move_vector: { x: 0, z: 0 },
    head_yaw: yawVal ?? state.headYaw ?? 0,
    input_data: {
      ascend: false, descend: false, jumping: false,
      sneaking: false, sprinting: false, up: false,
      down: false, left: false, right: false,
    },
    input_mode: inputMode,
    play_mode: 'normal',
    interaction_model: 'touch',
    interact_rotation: { x: 0, y: 0 },
    tick: 0n,
    delta: { x: 0, y: 0, z: 0 },
    item_stack_request: { id: 0, requests: [] },
    block_actions: [],
    predicted_vehicles: [],
    vehicle_stack: { id: 0, amount: 0 },
  };
}

/**
 * Build a text (chat) packet.
 * Type: 'raw' | 'chat' | 'whisper' | 'system'
 */
export function buildChat(message, type = 'raw') {
  const pkt = {
    type,
    needs_translation: false,
    xuid: '',
    platform_chat_id: '',
  };

  if (type === 'chat' || type === 'whisper') {
    pkt.source_name = '';
    pkt.message = message;
  } else {
    pkt.message = message;
  }

  return pkt;
}
