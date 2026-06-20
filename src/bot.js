#!/usr/bin/env node
/**
 * ClawMine — AI agent harness for Minecraft Bedrock
 *
 * JSON-in/JSON-out interface for LLMs to perceive and act
 * in a Bedrock world. Not a CLI tool — this is an agent loop.
 *
 * Usage:
 *   HOST=<server> PORT=<port> USERNAME=<bot> node src/bot.js
 *
 * Then pipe JSON commands (one per line) to stdin.
 * Responses come one per line on stdout.
 */
import bedrock from 'bedrock-protocol';
import readline from 'readline';
import { execSync } from 'child_process';

import { createState, applyMovePlayer, setPosition, setRotation } from './state.js';
import { faceAngles, walkSteps } from './math.js';
import { buildMovePlayer, buildPlayerAuthInput, buildChat } from './packets.js';
import { createEntityTracker, handleAddPlayer, handleAddEntity, handleAddItemEntity, handleMoveEntity, handleRemoveEntity, handlePlayerList, nearbyEntities } from './entities.js';
import { createChunkCache, setChunk, getBlock, getBlocks, chunkKey, chunkKeyFromPos, chunkStatus, getChunkAt, scan, direction, raycast } from './chunks.js';
import { findPath } from './pathfinding.js';
import { decodeLevelChunk, decodeSubChunk, applyBlockUpdates } from './decoder.js';

const HOST = process.env.HOST || '192.168.1.10';
const PORT = parseInt(process.env.PORT || '19132');
const USERNAME = process.env.USERNAME || 'ClawBot';
const OFFLINE = process.env.OFFLINE !== 'false';
const SEND_CMD = process.env.SEND_CMD || null;

const log = (...args) => process.stderr.write(`[${new Date().toISOString()}] ${args.join(' ')}\n`);
log(`Connecting to ${HOST}:${PORT} as ${USERNAME} (offline: ${OFFLINE})`);

// ── State ─────────────────────────────────────────────────

const state = createState();
let tracker = createEntityTracker();
let chunkCache = createChunkCache();
let tickInterval;
let _ignoreMoveUntil = 0;

// ── Client ─────────────────────────────────────────────────

const client = bedrock.createClient({
  host: HOST, port: PORT, username: USERNAME,
  offline: OFFLINE, timeout: 30000,
});

client.on('join', () => {
  output({ type: 'ready' });
  log('Joined');
});

client.on('spawn', () => {
  output({ type: 'spawn' });
  log('Spawned');

  tickInterval = setInterval(() => {
    client.queue('tick_sync', {
      request_time: BigInt(Date.now()),
      response_time: 0n,
    });
  }, 2000);
});

client.on('error', (err) => log('Error:', err.message));
client.on('end', (reason) => {
  log('End:', reason);
  if (tickInterval) clearInterval(tickInterval);
});

// ── Position tracking ─────────────────────────────────────

// Track teleported positions to avoid overwrite
let _tpAt = 0;

client.on('move_player', (pkt) => {
  if (!pkt) return;
  // Skip one packet after teleport
  if (Date.now() < _ignoreMoveUntil) return;
  // Also skip packets that arrive within 2s of a tp that match the tp target
  // (prevents stale server position from overwriting)
  const updated = applyMovePlayer(state, pkt);
  Object.assign(state, updated);
});

// ── Entity tracking ───────────────────────────────────────

client.on('add_player', (pkt) => {
  if (pkt) tracker = handleAddPlayer(tracker, pkt);
  log(`Player: ${pkt?.username || '?'} at ${JSON.stringify(pkt?.position)}`);
});

client.on('add_entity', (pkt) => {
  if (pkt) tracker = handleAddEntity(tracker, pkt);
});

client.on('add_item_entity', (pkt) => {
  if (pkt) tracker = handleAddItemEntity(tracker, pkt);
});

client.on('move_entity', (pkt) => {
  if (pkt) tracker = handleMoveEntity(tracker, pkt);
});

client.on('remove_entity', (pkt) => {
  if (pkt) tracker = handleRemoveEntity(tracker, pkt.runtime_id);
});

client.on('player_list', (pkt) => {
  if (pkt) tracker = handlePlayerList(tracker, pkt);
});

// ── Chunk tracking ────────────────────────────────────────

client.on('level_chunk', (pkt) => {
  if (!pkt) return;
  log(`Chunk at (${pkt.x}, ${pkt.z}) — ${pkt.sub_chunk_count} sub-chunks`);

  decodeLevelChunk(pkt.x, pkt.z, pkt.payload, pkt.sub_chunk_count)
    .then((chunk) => {
      chunkCache = setChunk(chunkCache, pkt.x, pkt.z, chunk);
      log(`Decoded chunk (${pkt.x}, ${pkt.z})`);
    })
    .catch((err) => {
      log(`Chunk decode failed: ${err.message}`);
    });
});

client.on('subchunk', (pkt) => {
  if (!pkt || !pkt.entries) return;
  for (const entry of pkt.entries) {
    const cx = pkt.origin.x + entry.dx;
    const cz = pkt.origin.z + entry.dz;
    const key = chunkKeyFromPos(cx, cz);
    let chunk = chunkCache.chunks.get(key);
    if (!chunk) {
      const Chunk = null; // Will be created on level_chunk
      log(`Sub-chunk for unloaded chunk (${cx}, ${cz}), skipping`);
      continue;
    }
    decodeSubChunk(chunk, entry.dy, Buffer.from(entry.payload))
      .then(() => log(`Sub-chunk at (${cx}, ${entry.dy}, ${cz})`))
      .catch((err) => log(`Sub-chunk decode failed: ${err.message}`));
  }
});

client.on('update_subchunk_blocks', (pkt) => {
  if (!pkt) return;
  const key = chunkKeyFromPos(pkt.x, pkt.z);
  const chunk = chunkCache.chunks.get(key);
  if (chunk) {
    applyBlockUpdates(chunk, pkt.blocks);
  }
});

// ── Messages ──────────────────────────────────────────────

client.on('text', (pkt) => {
  if (pkt.type === 'chat' || pkt.type === 'system') {
    output({
      type: 'msg',
      from: pkt.source_name || '',
      msg: pkt.message,
    });
  }
});

// ── JSON command interface ────────────────────────────────

function output(data) {
  console.log(JSON.stringify(data, (key, val) =>
    typeof val === 'bigint' ? Number(val) : val,
  ));
}

let cid = 0;

function handle(cmd) {
  const id = cmd.id ?? cid++;
  const ok = (d) => output({ type: 'response', id, ...d });

  try {
    switch (cmd.action) {

      case 'chat':
        client.queue('text', buildChat(cmd.message));
        return ok({ sent: true });

      case 'pos':
        return ok({ pos: state.pos, yaw: state.yaw, pitch: state.pitch });

      case 'tp': {
        const cmdStr = 'tp ' + USERNAME + ' ' + cmd.x + ' ' + cmd.y + ' ' + cmd.z + (cmd.yaw !== undefined ? ' ' + cmd.yaw : '');
        if (!SEND_CMD) return ok({ error: 'No SEND_CMD configured' });
        execSync(SEND_CMD + ' "' + cmdStr + '"', { timeout: 5000 });
        Object.assign(state, setPosition(state, cmd.x, cmd.y, cmd.z));
        if (cmd.yaw !== undefined) Object.assign(state, setRotation(state, cmd.yaw, state.pitch));
        _ignoreMoveUntil = Date.now() + 30000;
        return ok({ teleported: true, pos: state.pos });
      }

      case 'move': {
        if (!state.pos) return ok({ error: 'No position' });
        const steps = walkSteps(state.pos, { x: cmd.x, y: cmd.y, z: cmd.z });
        for (const step of steps) {
          client.queue('move_player', buildMovePlayer(state, step.x, step.y, step.z));
          client.queue('player_auth_input', buildPlayerAuthInput(state, step.x, step.y, step.z));
          Object.assign(state, setPosition(state, step.x, step.y, step.z));
        }
        return ok({ moved: true, steps: steps.length, pos: state.pos });
      }

      case 'setpos': {
        const pkt = buildMovePlayer(state, cmd.x, cmd.y, cmd.z, cmd.pitch, cmd.yaw, 'teleport');
        client.queue('move_player', pkt);
        client.queue('player_auth_input', buildPlayerAuthInput(state, cmd.x, cmd.y, cmd.z));
        Object.assign(state, setPosition(state, cmd.x, cmd.y, cmd.z));
        if (cmd.yaw !== undefined) Object.assign(state, setRotation(state, cmd.yaw, cmd.pitch ?? 0));
        return ok({ pos: state.pos });
      }

      case 'face': {
        if (!state.pos) return ok({ error: 'No position' });
        const angles = faceAngles(state.pos, { x: cmd.x, y: cmd.y, z: cmd.z });
        client.queue('move_player', buildMovePlayer(state, state.pos.x, state.pos.y, state.pos.z, angles.pitch, angles.yaw, 'rotation'));
        Object.assign(state, setRotation(state, angles.yaw, angles.pitch));
        return ok({ yaw: angles.yaw, pitch: angles.pitch });
      }

      case 'nearby': {
        const radius = cmd.radius ?? 32;
        const center = cmd.position ?? state.pos;
        if (!center) return ok({ error: 'No position' });
        return ok({ nearby: nearbyEntities(tracker, center, radius) });
      }

      case 'block': {
        if (cmd.x === undefined || cmd.y === undefined || cmd.z === undefined) {
          return ok({ error: 'Need x, y, z' });
        }
        const block = getBlock(chunkCache, cmd.x, cmd.y, cmd.z);
        return ok({ block, pos: { x: cmd.x, y: cmd.y, z: cmd.z } });
      }

      case 'blocks': {
        if (cmd.x1 === undefined) return ok({ error: 'Need x1, y1, z1, x2, y2, z2' });
        const blocks = getBlocks(chunkCache, cmd.x1, cmd.y1, cmd.z1, cmd.x2, cmd.y2, cmd.z2, cmd.filter);
        return ok({ count: blocks.length, blocks });
      }

      case 'chunks':
        return ok({ chunks: chunkStatus(chunkCache, state.pos?.x ?? 0, state.pos?.z ?? 0, cmd.radius ?? 4) });

      case 'scan': {
        const sx = cmd.x ?? state.pos?.x;
        const sy = cmd.y ?? state.pos?.y;
        const sz = cmd.z ?? state.pos?.z;
        if (sx === undefined) return ok({ error: 'No position' });
        const r = cmd.radius ?? 4;
        const ry = cmd.radiusY ?? 2;
        const result = scan(chunkCache, sx, sy, sz, r, ry, r);
        return ok(result);
      }

      case 'look': {
        if (!state.pos) return ok({ error: 'No position' });
        const dist = cmd.distance ?? 10;
        const result = direction(chunkCache, state.pos, state.yaw, state.pitch, dist);
        return ok(result);
      }

      case 'raycast': {
        if (!state.pos || cmd.x === undefined) return ok({ error: 'Need position and target' });
        const result = raycast(chunkCache, state.pos.x, state.pos.y, state.pos.z, cmd.x, cmd.y ?? state.pos.y, cmd.z);
        return ok(result);
      }

      case 'path': {
        if (!state.pos || cmd.x === undefined) return ok({ error: 'Need position and target' });
        const path = findPath(chunkCache, state.pos.x, state.pos.y, state.pos.z, cmd.x, cmd.y ?? state.pos.y, cmd.z);
        if (!path) return ok({ error: 'No path found' });
        return ok({ path, length: path.length, start: state.pos, end: { x: cmd.x, y: cmd.y ?? state.pos.y, z: cmd.z } });
      }

      case 'walk': {
        if (!state.pos || cmd.x === undefined) return ok({ error: 'Need target' });
        const wPath = findPath(chunkCache, state.pos.x, state.pos.y, state.pos.z, cmd.x, cmd.y ?? state.pos.y, cmd.z);
        if (!wPath) return ok({ error: 'No path found' });

        // Walk each waypoint
        let walked = 0;
        for (const wp of wPath) {
          if (wp.x === Math.floor(state.pos.x) && wp.y === Math.floor(state.pos.y) && wp.z === Math.floor(state.pos.z)) continue;
          const steps = walkSteps(state.pos, wp);
          for (const step of steps) {
            client.queue('move_player', buildMovePlayer(state, step.x, step.y, step.z));
            client.queue('player_auth_input', buildPlayerAuthInput(state, step.x, step.y, step.z));
            Object.assign(state, setPosition(state, step.x, step.y, step.z));
            walked++;
          }
        }
        return ok({ walked, path: wPath, pos: state.pos });
      }

      default:
        return ok({ error: `Unknown action: ${cmd.action}` });
    }
  } catch (e) {
    ok({ error: e.message });
  }
}

// ── Stdin reader ──────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const t = line.trim();
  if (t) {
    try { handle(JSON.parse(t)).catch(e => log('cmd error:', e)); }
    catch { /* non-JSON */ }
  }
});

output({ type: 'startup', version: '0.4.0' });
