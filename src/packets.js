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
      ascend: false, descend: false, north_jump: false, jump_down: false,
      sprint_down: false, change_height: false, jumping: false,
      auto_jumping_in_water: false, sneaking: false, sneak_down: false,
      up: false, down: false, left: false, right: false,
      up_left: false, up_right: false, want_up: false, want_down: false,
      want_down_slow: false, want_up_slow: false, sprinting: false,
      ascend_block: false, descend_block: false, sneak_toggle_down: false,
      persist_sneak: false, start_sprinting: false, stop_sprinting: false,
      start_sneaking: false, stop_sneaking: false, start_swimming: false,
      stop_swimming: false, start_jumping: false, start_gliding: false,
      stop_gliding: false, item_interact: false, block_action: false,
      item_stack_request: false, handled_teleport: false, emoting: false,
      missed_swing: false, start_crawling: false, stop_crawling: false,
      start_flying: false, stop_flying: false, received_server_data: false,
      client_predicted_vehicle: false, paddling_left: false, paddling_right: false,
      block_breaking_delay_enabled: false, horizontal_collision: false,
      vertical_collision: false, down_left: false, down_right: false,
      start_using_item: false, camera_relative_movement_enabled: false,
      rot_controlled_by_move_direction: false, start_spin_attack: false,
      stop_spin_attack: false, hotbar_only_touch: false,
      jump_released_raw: false, jump_pressed_raw: false, jump_current_raw: false,
      sneak_released_raw: false, sneak_pressed_raw: false, sneak_current_raw: false,
    },
    input_mode: inputMode,
    play_mode: 'normal',
    interaction_model: 'touch',
    interact_rotation: { x: 0, z: 0 },
    tick: 0n,
    delta: { x: 0, y: 0, z: 0 },
    analogue_move_vector: { x: 0, z: 0 },
    camera_orientation: { x: 0, y: 0, z: 0 },
    raw_move_vector: { x: 0, z: 0 },
  };
}

/**
 * Build a text (chat) packet.
 * Type: 'raw' | 'chat' | 'whisper' | 'system'
 */
export function buildChat(message, type = 'raw', sourceName = '') {
  // Category determines how the message is styled in chat:
  //   'authored' — player-authored messages (shown with player name)
  //   'message_only' — system/message-of-the-day style (no name prefix)
  //   'parameters' — formatted messages with parameters
  const category = (type === 'chat' || type === 'whisper') ? 'authored' : 'message_only';

  const pkt = {
    type,
    needs_translation: false,
    category,
    xuid: '',
    platform_chat_id: '',
    has_filtered_message: false,
  };

  if (type === 'chat' || type === 'whisper') {
    pkt.source_name = sourceName;
    pkt.message = message;
  } else {
    pkt.message = message;
  }

  return pkt;
}
