#!/usr/bin/env node
/**
 * ClawMine — Bedrock Minecraft bot
 *
 * Connects to a Bedrock server, stays alive with tick sync,
 * and accepts JSON commands via stdin.
 *
 * Environment:
 *   HOST      Server address (default: 192.168.1.10)
 *   PORT      Bedrock port (default: 19132)
 *   USERNAME  Bot name (default: ClawBot)
 *   OFFLINE   Offline mode (default: true)
 *   SEND_CMD  Server command tool path (default: send-command)
 */
import bedrock from 'bedrock-protocol';
import readline from 'readline';
import { execSync } from 'child_process';

const HOST = process.env.HOST || '192.168.1.10';
const PORT = parseInt(process.env.PORT || '19132');
const USERNAME = process.env.USERNAME || 'ClawBot';
const OFFLINE = process.env.OFFLINE !== 'false';
const SEND_CMD = process.env.SEND_CMD || null;

const log = (...args) => process.stderr.write(`[${new Date().toISOString()}] ${args.join(' ')}\n`);

log(`Connecting to ${HOST}:${PORT} as ${USERNAME} (offline: ${OFFLINE})`);

// ── State ─────────────────────────────────────────────────

const state = {
  connected: false,
  spawned: false,
  pos: null,       // { x, y, z }
  yaw: 0,
  pitch: 0,
  headYaw: 0,
  runtimeId: null,
};

// ── Client ─────────────────────────────────────────────────

const client = bedrock.createClient({
  host: HOST,
  port: PORT,
  username: USERNAME,
  offline: OFFLINE,
  timeout: 30000,
});

client.on('join', () => {
  state.connected = true;
  output({ type: 'ready' });
  log('Joined');
});

client.on('spawn', () => {
  state.spawned = true;
  output({ type: 'spawn' });
  log('Spawned');
});

client.on('error', (err) => log('Error:', err.message));
client.on('end', (reason) => {
  state.connected = false;
  state.spawned = false;
  log('End:', reason);
});

// ── Position tracking ─────────────────────────────────────

client.on('move_player', (pkt) => {
  if (!pkt) return;
  // Store position from server updates
  state.pos = pkt.position;
  state.yaw = pkt.yaw;
  state.pitch = pkt.pitch;
  state.headYaw = pkt.head_yaw;
  state.runtimeId = pkt.runtime_id;
});

// Track our own entity's position on spawn
client.on('spawn', () => {
  if (client.entity?.position) {
    state.pos = client.entity.position;
  }
});

// ── Teleport (via server command) ─────────────────────────

function teleportViaCmd(x, y, z, yawDeg) {
  const cmd = yawDeg !== undefined
    ? `tp ${USERNAME} ${x} ${y} ${z} ${yawDeg}`
    : `tp ${USERNAME} ${x} ${y} ${z}`;

  if (SEND_CMD) {
    try {
      execSync(`${SEND_CMD} "${cmd}"`, { timeout: 5000 });
      return true;
    } catch (e) {
      log('Teleport cmd failed:', e.message);
      return false;
    }
  }

  log('No SEND_CMD configured for teleport');
  return false;
}

// ── Client-side movement ──────────────────────────────────

function sendMovePlayer(x, y, z, pitch, yaw, mode = 'normal') {
  if (!state.connected) return false;

  const pkt = {
    runtime_id: state.runtimeId || 0,
    position: { x, y, z },
    pitch: pitch ?? state.pitch ?? 0,
    yaw: yaw ?? state.yaw ?? 0,
    head_yaw: yaw ?? state.headYaw ?? 0,
    mode,
    on_ground: true,
    ridden_runtime_id: 0,
    tick: BigInt(0),
  };

  if (mode === 'teleport') {
    pkt.cause = 'command';
    pkt.source_entity_type = 'player';
  }

  client.queue('move_player', pkt);

  // Update local state
  state.pos = { x, y, z };
  state.yaw = yaw ?? state.yaw ?? 0;
  state.pitch = pitch ?? state.pitch ?? 0;
  state.headYaw = yaw ?? state.headYaw ?? 0;

  return true;
}

function sendPlayerAuthInput(x, y, z, yaw, pitch, inputMode = 'mouse') {
  if (!state.connected) return;

  client.queue('player_auth_input', {
    pitch: pitch ?? state.pitch ?? 0,
    yaw: yaw ?? state.yaw ?? 0,
    position: { x, y, z },
    move_vector: { x: 0, z: 0 },
    head_yaw: yaw ?? state.headYaw ?? 0,
    input_data: {
      ascend: false,
      descend: false,
      jumping: false,
      sneaking: false,
      sprinting: false,
      up: false,
      down: false,
      left: false,
      right: false,
    },
    input_mode: inputMode,
    play_mode: 'normal',
    interaction_model: 'touch',
    interact_rotation: { x: 0, y: 0 },
    tick: BigInt(0),
    delta: { x: 0, y: 0, z: 0 },
    item_stack_request: { id: 0, requests: [] },
    block_actions: [],
    predicted_vehicles: [],
    vehicle_stack: { id: 0, amount: 0 },
  });
}

// ── Path movement (simple step-by-step walk) ──────────────

const WALK_SPEED = 0.5; // blocks per send

function sendWalkTo(targetX, targetY, targetZ) {
  if (!state.pos) return false;

  const dx = targetX - state.pos.x;
  const dy = targetY - state.pos.y;
  const dz = targetZ - state.pos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (dist < 0.5) return false; // already there

  const steps = Math.ceil(dist / WALK_SPEED);
  const sx = dx / steps;
  const sy = dy / steps;
  const sz = dz / steps;

  for (let i = 1; i <= steps; i++) {
    const nx = state.pos.x + sx;
    const ny = state.pos.y + sy;
    const nz = state.pos.z + sz;

    sendMovePlayer(nx, ny, nz);
    sendPlayerAuthInput(nx, ny, nz);
  }

  // Final exact position
  sendMovePlayer(targetX, targetY, targetZ);
  sendPlayerAuthInput(targetX, targetY, targetZ);

  return true;
}

// ── JSON command interface ────────────────────────────────

function output(data) { console.log(JSON.stringify(data)); }

let cid = 0;

function handle(cmd) {
  const id = cmd.id ?? cid++;
  const ok = (d) => output({ type: 'response', id, ...d });

  try {
    switch (cmd.action) {

      case 'chat':
        client.queue('text', {
          type: 'raw',
          needs_translation: false,
          message: cmd.message,
          xuid: '',
          platform_chat_id: '',
        });
        return ok({ sent: true });

      case 'pos':
        return ok({ pos: state.pos, yaw: state.yaw, pitch: state.pitch });

      case 'tp': {
        const success = teleportViaCmd(cmd.x, cmd.y, cmd.z, cmd.yaw);
        // Update local state after teleport
        state.pos = { x: cmd.x, y: cmd.y, z: cmd.z };
        if (cmd.yaw !== undefined) {
          state.yaw = cmd.yaw;
          state.headYaw = cmd.yaw;
        }
        return ok({ teleported: success, pos: state.pos });
      }

      case 'move': {
        if (!state.pos) return ok({ error: 'No position known yet' });
        sendWalkTo(cmd.x, cmd.y, cmd.z);
        return ok({ moved: true, pos: state.pos });
      }

      case 'setpos': {
        // Directly set server-side position (client-side teleport)
        sendMovePlayer(cmd.x, cmd.y, cmd.z, cmd.pitch ?? state.pitch, cmd.yaw ?? state.yaw, 'teleport');
        sendPlayerAuthInput(cmd.x, cmd.y, cmd.z);
        return ok({ pos: state.pos });
      }

      case 'face': {
        // Look at a specific coordinate
        if (!state.pos) return ok({ error: 'No position' });
        const dx = cmd.x - state.pos.x;
        const dy = cmd.y - state.pos.y;
        const dz = cmd.z - state.pos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist === 0) return ok({ error: 'Same position' });

        const pitch = -Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
        const yaw = Math.atan2(-dx, dz);

        sendMovePlayer(state.pos.x, state.pos.y, state.pos.z, pitch, yaw, 'rotation');
        state.yaw = yaw;
        state.pitch = pitch;
        state.headYaw = yaw;
        return ok({ yaw, pitch });
      }

      default:
        return ok({ error: `Unknown action: ${cmd.action}` });
    }
  } catch (e) {
    ok({ error: e.message });
  }
}

// ── Line-by-line stdin reader ─────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on('line', (line) => {
  const t = line.trim();
  if (t) {
    try { handle(JSON.parse(t)); }
    catch { /* ignore non-JSON */ }
  }
});

output({ type: 'startup', version: '0.2.0' });
