/**
 * ClawCraft — Packet structure builders
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
 * opts.sprinting: set sprint flags in input_data
 */
export function buildPlayerAuthInput(state, x, y, z, yawVal, pitchVal, inputMode = 'mouse', opts = {}) {
  const sprinting = opts.sprinting === true;
  return {
    pitch: pitchVal ?? state.pitch ?? 0,
    yaw: yawVal ?? state.yaw ?? 0,
    position: { x, y, z },
    move_vector: { x: 0, z: 0 },
    head_yaw: yawVal ?? state.headYaw ?? 0,
    input_data: {
      ascend: false, descend: false, north_jump: false, jump_down: false,
      sprint_down: sprinting, change_height: false, jumping: false,
      auto_jumping_in_water: false, sneaking: false, sneak_down: false,
      up: false, down: false, left: false, right: false,
      up_left: false, up_right: false, want_up: false, want_down: false,
      want_down_slow: false, want_up_slow: false, sprinting,
      ascend_block: false, descend_block: false, sneak_toggle_down: false,
      persist_sneak: false, start_sprinting: sprinting, stop_sprinting: false,
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
 * Build a mob_equipment packet for equipping/selecting a hotbar slot.
 */
export function buildMobEquipment(runtimeId, item, slot, selectedSlot, windowId = 'inventory') {
  return {
    runtime_entity_id: runtimeId ?? 0,
    item: item ? {
      network_id: item.networkId,
      count: item.count || 1,
      metadata: item.metadata || 0,
      has_stack_id: item.stackId ? 1 : 0,
      stack_id: item.stackId || 0,
      block_runtime_id: 0,
      extra: { has_nbt: false, nbt: undefined, can_place_on: [], can_destroy: [], blocking_tick: 0 },
    } : { network_id: 0 },
    slot,
    selected_slot: selectedSlot,
    window_id: windowId,
  };
}

/**
 * Build an inventory_transaction packet for moving items between slots.
 * actions: [{source_id: windowId, slot, old_item, new_item}, ...]
 */
export function buildInventoryTransaction(actions) {
  return {
    transaction: {
      legacy: { type: 'none' },
      transaction_type: 'normal',
      actions: actions.map(a => ({
        source_type: 'container',
        inventory_id: a.source_id,
        slot: a.slot,
        old_item: a.old_item || { network_id: 0 },
        new_item: a.new_item || { network_id: 0 },
      })),
    },
  };
}

/**
 * Build a player_action packet.
 * Actions: start_break, abort_break, stop_break, crack_break, drop_item, start_using_item, etc.
 */
export function buildPlayerAction(runtimeId, action, position, resultPosition, face = 0) {
  return {
    runtime_entity_id: runtimeId ?? 0,
    action,
    position: position || { x: 0, y: 0, z: 0 },
    result_position: resultPosition || { x: 0, y: 0, z: 0 },
    face: face ?? 0,
  };
}

/**
 * Build an inventory_transaction for item_use (click_block, click_air, break_block).
 */
export function buildItemUseTransaction(actionType, triggerType, blockPos, face, hotbarSlot, heldItem, playerPos, clickPos, blockRuntimeId) {
  return {
    transaction: {
      legacy: { type: 'none' },
      transaction_type: 'item_use',
      actions: [],
      transaction_data: {
        action_type: actionType,
        trigger_type: triggerType || 'player_input',
        block_position: blockPos || { x: 0, y: 0, z: 0 },
        face: face ?? 0,
        hotbar_slot: hotbarSlot ?? 0,
        held_item: heldItem || { network_id: 0 },
        player_pos: playerPos || { x: 0, y: 0, z: 0 },
        click_pos: clickPos || { x: 0, y: 0, z: 0 },
        block_runtime_id: blockRuntimeId ?? 0,
        client_prediction: 'success',
        client_cooldown_state: 'off',
      },
    },
  };
}

/**
 * Build an inventory_transaction for item_use_on_entity (interact, attack).
 */
export function buildItemUseOnEntityTransaction(entityRuntimeId, actionType, hotbarSlot, heldItem, playerPos, clickPos) {
  return {
    transaction: {
      legacy: { type: 'none' },
      transaction_type: 'item_use_on_entity',
      actions: [],
      transaction_data: {
        entity_runtime_id: entityRuntimeId ?? 0,
        action_type: actionType,
        hotbar_slot: hotbarSlot ?? 0,
        held_item: heldItem || { network_id: 0 },
        player_pos: playerPos || { x: 0, y: 0, z: 0 },
        click_pos: clickPos || { x: 0, y: 0, z: 0 },
      },
    },
  };
}

/**
 * Build an inventory_transaction for item_release (release, consume).
 */
export function buildItemReleaseTransaction(actionType, hotbarSlot, heldItem, headPos) {
  return {
    transaction: {
      legacy: { type: 'none' },
      transaction_type: 'item_release',
      actions: [],
      transaction_data: {
        action_type: actionType,
        hotbar_slot: hotbarSlot ?? 0,
        held_item: heldItem || { network_id: 0 },
        head_pos: headPos || { x: 0, y: 0, z: 0 },
      },
    },
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
