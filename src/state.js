/**
 * ClawCraft — Pure state management
 *
 * Tracks bot position, rotation, and connection state.
 * No I/O — pure data, fully testable.
 */

export function createState() {
  return {
    connected: false,
    spawned: false,
    pos: null,        // { x, y, z }
    yaw: 0,           // radians, internal convention (0=south, +Z). Converted to degrees at packet boundary.
    pitch: 0,         // radians
    headYaw: 0,       // radians
    runtimeId: null,
    // Movement authority negotiated with the server. One of:
    //   'client'             — client owns position (legacy, rare on modern BDS)
    //   'server'             — server simulates from input; position is a prediction
    //   'server_with_rewind' — server simulates with a rewind history window
    // Modern BDS (1.20+) is server-authoritative; client-auth was effectively removed.
    movementAuthority: 'server',
    rewindHistorySize: 0,
  };
}

/**
 * Apply movement-authority info learned from start_game / set_movement_authority.
 */
export function setMovementAuthority(state, authority, rewindHistorySize) {
  return {
    ...state,
    movementAuthority: authority ?? state.movementAuthority,
    rewindHistorySize: rewindHistorySize ?? state.rewindHistorySize,
  };
}

export function applyMovePlayer(state, pkt) {
  if (!pkt) return state;
  // Incoming yaw/pitch/head_yaw are DEGREES (Bedrock wire format). Convert to the
  // internal RADIANS convention. (Avoid importing to keep this module dependency-free.)
  const DEG_TO_RAD = Math.PI / 180;
  return {
    ...state,
    pos: pkt.position ? { x: pkt.position.x, y: pkt.position.y, z: pkt.position.z } : state.pos,
    yaw: pkt.yaw != null ? pkt.yaw * DEG_TO_RAD : state.yaw,
    pitch: pkt.pitch != null ? pkt.pitch * DEG_TO_RAD : state.pitch,
    headYaw: pkt.head_yaw != null ? pkt.head_yaw * DEG_TO_RAD : state.headYaw,
    // Note: runtimeId is intentionally NOT updated here. It is set once from
    // start_game / self add_player. Updating it from move_player would let another
    // entity's packet hijack our identity.
  };
}

export function setPosition(state, x, y, z) {
  return { ...state, pos: { x, y, z } };
}

export function setRotation(state, yaw, pitch) {
  return { ...state, yaw, pitch, headYaw: yaw };
}

export function setConnected(state, connected) {
  return { ...state, connected, spawned: connected ? state.spawned : false };
}

export function setSpawned(state, spawned) {
  return { ...state, spawned };
}
