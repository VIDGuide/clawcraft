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
import net from 'net';
import fs from 'fs';
import { execFileSync } from 'child_process';

import { createState, applyMovePlayer, setPosition, setRotation } from './state.js';
import { faceAngles, walkSteps } from './math.js';
import { buildMovePlayer, buildPlayerAuthInput, buildChat } from './packets.js';
import { createEntityTracker, handleAddPlayer, handleAddEntity, handleAddItemEntity, handleMoveEntity, handleRemoveEntity, handlePlayerList, nearbyEntities } from './entities.js';
import { createChunkCache, setChunk, getBlock, getBlocks, chunkKey, chunkKeyFromPos, chunkStatus, getChunkAt, scan, direction, raycast } from './chunks.js';
import { findPath } from './pathfinding.js';
import { decodeSubChunkBuffer } from './blocks.js';
import { decodeLevelChunk, applyBlockUpdates } from './decoder.js';
import { createChatConfig, processIncoming } from './chat.js';
import { titleFor, uuidFor, count as emoteCount } from './emotes.js';
import { createPlayerRoster, processPlayerList, processPlayerAppear, processPlayerDisappear, createProximityTracker, checkProximity, removeFromProximity } from './players.js';

const HOST = process.env.HOST || '192.168.1.10';
const PORT = parseInt(process.env.PORT || '19132');
const USERNAME = process.env.BOT_USERNAME || process.env.USERNAME || 'ClawBot';
const OFFLINE = process.env.OFFLINE !== 'false';
const SEND_CMD = process.env.SEND_CMD || null;
const CLAWMINE_PORT = parseInt(process.env.CLAWMINE_PORT || '3001');
const CLAWMINE_EVENTS = process.env.CLAWMINE_EVENTS || './events.jsonl';
const chatConfig = createChatConfig();

const log = (...args) => process.stderr.write(`[${new Date().toISOString()}] ${args.join(' ')}\n`);
log(`Connecting to ${HOST}:${PORT} as ${USERNAME} (offline: ${OFFLINE})`);

// ── State ─────────────────────────────────────────────────

let state = createState();
let tracker = createEntityTracker();
let chunkCache = createChunkCache();
let roster = createPlayerRoster();
let proxTracker = createProximityTracker();
let tickInterval;
let _ignoreMoveUntil = 0;
const _startedAt = Date.now();
let _initialized = false;
const _pendingSubchunkRequests = [];
const _seenPackets = new Set();

// ── Client ─────────────────────────────────────────────────

const client = bedrock.createClient({
  host: HOST, port: PORT, username: USERNAME,
  offline: OFFLINE, timeout: 30000,
});

client.on('join', () => {
  emitEvent({ type: 'ready' });
  log('Joined');

  // Break the chicken-and-egg deadlock: server won't respond to subchunk
  // requests until set_local_player_as_initialized is sent, but bedrock-protocol
  // waits for player_spawn which never comes when sub_chunk_count=-2.
  setTimeout(() => {
    const eid = client.entityId || client.startGameData?.runtime_entity_id || 0n;
    client.write('set_local_player_as_initialized', { runtime_entity_id: eid });
    log('Sent set_local_player_as_initialized (entity=' + eid + ')');
    if (!tickInterval) {
      tickInterval = setInterval(() => {
        client.queue('tick_sync', { request_time: BigInt(Date.now()), response_time: 0n });
      }, 2000);
    }
    // Delay sub-chunk requests so server can process init first
    setTimeout(() => {
      _initialized = true;
      for (const [cx, cz] of _pendingSubchunkRequests) requestSubChunks(cx, cz);
      _pendingSubchunkRequests.length = 0;
    }, 1000);
  }, 500);
});

client.on('spawn', () => {
  emitEvent({ type: 'spawn' });
  log('Spawned');

  if (!tickInterval) {
    tickInterval = setInterval(() => {
      client.queue('tick_sync', { request_time: BigInt(Date.now()), response_time: 0n });
    }, 2000);
  }
});

client.on('packet', (des) => {
  const name = String(des?.data?.name || '');
  if (name.includes('subchunk') || name.includes('sub_chunk')) {
    log('DEBUG PKT: ' + name);
  }
  // Temporarily log all unique packet names after init
  if (_initialized && !_seenPackets.has(name)) {
    _seenPackets.add(name);
    log('NEW PKT TYPE: ' + name);
  }
  if (name === 'packet_violation_warning') {
    log('VIOLATION: ' + JSON.stringify(des?.data?.params));
  }
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
  state = { ...state, ...updated };

  // Re-check proximity when bot position changes
  if (state.pos && tracker.players.size > 0) {
    const players = [];
    for (const [, e] of tracker.players) {
      if (e.position && e.uuid) players.push({ name: e.name, uuid: e.uuid, position: e.position });
    }
    const { tracker: pt, events } = checkProximity(proxTracker, players, state.pos);
    proxTracker = pt;
    for (const ev of events) emitEvent(ev);
  }
});

// ── Entity tracking ───────────────────────────────────────

client.on('add_player', (pkt) => {
  if (pkt) tracker = handleAddPlayer(tracker, pkt);
  if (pkt && pkt.username?.toLowerCase() !== USERNAME.toLowerCase()) {
    const ev = processPlayerAppear(pkt);
    if (ev) emitEvent(ev);
  }
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
  if (pkt && state.pos) {
    // Check if moved entity is a player — run proximity check
    const loc = tracker._ridIndex.get(pkt.runtime_id);
    if (loc && loc.map === 'players') {
      const players = [];
      for (const [, e] of tracker.players) {
        if (e.position && e.uuid) players.push({ name: e.name, uuid: e.uuid, position: e.position });
      }
      const { tracker: pt, events } = checkProximity(proxTracker, players, state.pos);
      proxTracker = pt;
      for (const ev of events) emitEvent(ev);
    }
  }
});

client.on('remove_entity', (pkt) => {
  if (pkt) {
    const ev = processPlayerDisappear(pkt.runtime_id, tracker);
    if (ev) {
      emitEvent(ev);
      proxTracker = removeFromProximity(proxTracker, ev.uuid);
    }
    tracker = handleRemoveEntity(tracker, pkt.runtime_id);
  }
});

client.on('player_list', (pkt) => {
  if (pkt) tracker = handlePlayerList(tracker, pkt);
  if (pkt) {
    const { roster: r, events } = processPlayerList(roster, pkt, USERNAME);
    roster = r;
    for (const ev of events) emitEvent(ev);
  }
});

// ── Chunk tracking ────────────────────────────────────────

client.on('level_chunk', (pkt) => {
  if (!pkt) return;
  log(`Chunk at (${pkt.x}, ${pkt.z}) — ${pkt.sub_chunk_count} sub-chunks, cache=${pkt.cache_enabled}, dim=${pkt.dimension}, blobs=${pkt.blobs ? pkt.blobs.length : 0}`);

  decodeLevelChunk(pkt.x, pkt.z, pkt.payload, pkt.sub_chunk_count)
    .then((chunk) => {
      chunkCache = setChunk(chunkCache, pkt.x, pkt.z, chunk);
      log(`Decoded chunk (${pkt.x}, ${pkt.z})`);

      // Request sub-chunks when server signals data not included
      if (pkt.sub_chunk_count === -2 || pkt.sub_chunk_count === -1) {
        if (_initialized) requestSubChunks(pkt.x, pkt.z);
        else _pendingSubchunkRequests.push([pkt.x, pkt.z]);
      }
    })
    .catch((err) => {
      log(`Chunk decode failed: ${err.message}`);
    });
});

let _subchunkSerializerPatched = false;

function setupSubchunkSerializer() {
  if (_subchunkSerializerPatched || !client.serializer) return;
  _subchunkSerializerPatched = true;

  const wCtx = client.serializer.proto.writeCtx;
  const sCtx = client.serializer.proto.sizeOfCtx;

  // Correct order per gophertunnel: dimension(varint32) → offsets(varuint32 + i8×3[]) → position(3×li32)
  wCtx.packet_subchunk_request = function(value, buffer, offset) {
    offset = wCtx.zigzag32(value.dimension, buffer, offset);
    offset = wCtx.varint(value.requests.length, buffer, offset);
    for (let i = 0; i < value.requests.length; i++) {
      offset = wCtx.i8(value.requests[i].x, buffer, offset);
      offset = wCtx.i8(value.requests[i].y, buffer, offset);
      offset = wCtx.i8(value.requests[i].z, buffer, offset);
    }
    offset = wCtx.li32(value.origin.x, buffer, offset);
    offset = wCtx.li32(value.origin.y, buffer, offset);
    offset = wCtx.li32(value.origin.z, buffer, offset);
    return offset;
  };
  sCtx.packet_subchunk_request = function(value) {
    return sCtx.zigzag32(value.dimension) +
           sCtx.varint(value.requests.length) + value.requests.length * 3 +
           12;
  };
}

function requestSubChunks(cx, cz) {
  const botY = state.pos?.y ?? 64;
  const centerSub = Math.floor((botY + 64) / 16);
  const requests = [];
  // Request sub-chunks around bot Y, allowing negative offsets for deep terrain.
  // origin.y = -4 (world minimum sub-chunk), dy is offset from that.
  for (let r = -3; r <= 3; r++) {
    const dy = centerSub + r;
    if (dy >= -4 && dy <= 19) requests.push({ x: 0, y: dy, z: 0 });
  }
  try {
    setupSubchunkSerializer();
    client.write('subchunk_request', {
      dimension: 0,
      requests: [{ x: 0, y: cx, z: cz }, ...requests],
      origin: { x: cx, y: -4, z: cz },
    });
    log('Rq cx=' + cx + ' cz=' + cz + ' center=' + centerSub + ' count=' + requests.length);
  } catch(e) { log('Rq err: ' + e.message); }
}

client.on('subchunk', (pkt) => {
  log('Subchunk pkt: origin=(' + pkt.origin.x + ',' + pkt.origin.y + ',' + pkt.origin.z + ') cache=' + pkt.cache_enabled + ' entries=' + (pkt.entries ? pkt.entries.length : 0));
  if (!pkt || !pkt.entries) return;
  for (const entry of pkt.entries) {
    if (entry.result !== 'success' && entry.result !== 'success_all_air') {
      log('Subchunk entry: result=' + entry.result + ' dx=' + entry.dx + ' dy=' + entry.dy + ' dz=' + entry.dz);
      continue;
    }
    const cx = pkt.origin.x + entry.dx;
    const cz = pkt.origin.z + entry.dz;
    const cy = pkt.origin.y + entry.dy;
    const key = chunkKeyFromPos(cx, cz);
    if (!entry.payload || entry.payload.length === 0) {
      // Server confirmed this sub-chunk is entirely air — store sentinel
      const latest = chunkCache.chunks.get(key);
      if (latest) {
        const subChunks = new Map(latest.subChunks);
        subChunks.set(cy, 'air');
        chunkCache = setChunk(chunkCache, cx, cz, { ...latest, subChunks });
      }
      log(`Sub-chunk at (${cx}, ${entry.dy}, ${cz}) — cy=${cy} (all air)`);
      continue;
    }
    // Decode synchronously and update the latest chunk to avoid
    // race conditions (all 7 entries target the same chunk)
    try {
      const { blocks } = decodeSubChunkBuffer(Buffer.from(entry.payload));
      const latest = chunkCache.chunks.get(key);
      if (latest) {
        const subChunks = new Map(latest.subChunks);
        subChunks.set(cy, blocks);
        chunkCache = setChunk(chunkCache, cx, cz, { ...latest, subChunks });
        log(`Sub-chunk at (${cx}, ${entry.dy}, ${cz}) — cy=${cy}`);
      }
    } catch (e) {
      log(`Sub-chunk decode failed: ${e.message}`);
    }
  }
});

client.on('update_subchunk_blocks', (pkt) => {
  if (!pkt) return;
  const key = chunkKeyFromPos(pkt.x, pkt.z);
  const chunk = chunkCache.chunks.get(key);
  if (chunk) {
    const updated = applyBlockUpdates(chunk, pkt.blocks);
    chunkCache = setChunk(chunkCache, pkt.x, pkt.z, updated);
  }
});

// ── Messages ──────────────────────────────────────────────

client.on('text', (pkt) => {
  const msg = processIncoming(pkt, chatConfig, USERNAME);
  if (msg) emitEvent(msg);
});

// ── Emotes ────────────────────────────────────────────────

client.on('emote', (pkt) => {
  if (!pkt) return;
  // Resolve entity_id to a player name via the runtimeId index
  const loc = tracker._ridIndex.get(Number(pkt.entity_id));
  const entity = loc ? tracker[loc.map]?.get(loc.key) : null;
  const from = entity?.name || null;

  // Ignore own emotes (server echoes them back)
  if (from && from.toLowerCase() === USERNAME.toLowerCase()) return;

  const emoteId = pkt.emote_id;
  const title = titleFor(emoteId);

  emitEvent({
    type: 'emote',
    from,
    emote: title || emoteId,
    emoteId,
    known: title !== null,
    timestamp: Date.now(),
  });
});

// ── JSON command interface ────────────────────────────────

function output(data) {
  console.log(JSON.stringify(data, (key, val) =>
    typeof val === 'bigint' ? Number(val) : val,
  ));
}

// ── Event file writer ─────────────────────────────────────

const eventStream = fs.createWriteStream(CLAWMINE_EVENTS, { flags: 'a' });
eventStream.on('error', (err) => log('Event file write error:', err.message));

function emitEvent(obj) {
  const withTs = { ...obj, timestamp: obj.timestamp ?? Date.now() };
  output(withTs);
  eventStream.write(JSON.stringify(withTs, (k, v) => typeof v === 'bigint' ? Number(v) : v) + '\n');
}

let cid = 0;

function handle(cmd, outputFn = output) {
  if (!cmd || typeof cmd !== 'object' || !cmd.action) {
    return outputFn({ type: 'response', error: 'Invalid command: need {action}' });
  }
  // Coerce coordinate fields to numbers where present
  for (const k of ['x', 'y', 'z', 'x1', 'y1', 'z1', 'x2', 'y2', 'z2', 'yaw', 'pitch', 'radius', 'distance']) {
    if (k in cmd) {
      cmd[k] = Number(cmd[k]);
      if (Number.isNaN(cmd[k])) return outputFn({ type: 'response', error: `Invalid ${k}: must be a number` });
    }
  }
  const id = cmd.id ?? cid++;
  const ok = (d) => outputFn({ type: 'response', id, ...d });

  try {
    switch (cmd.action) {

      case 'chat':
        client.queue('text', {
          type: 'chat',
          needs_translation: false,
          category: 'authored',
          source_name: USERNAME,
          message: cmd.message,
          xuid: '',
          platform_chat_id: '',
          has_filtered_message: false,
        });
        return ok({ sent: true });

      case 'say':
        if (!SEND_CMD) return ok({ error: 'No SEND_CMD configured' });
        const sayCmd = 'say <ClawBot> ' + (cmd.message ?? '');
        const sayParts = SEND_CMD.split(/\s+/);
        execFileSync(sayParts[0], [...sayParts.slice(1), sayCmd], { timeout: 5000 });
        return ok({ sent: true });

      case 'whisper':
        if (!cmd.to) return ok({ error: 'Need "to" player name' });
        client.queue('text', { ...buildChat(cmd.message, 'whisper'), source_name: USERNAME, parameters: [cmd.to, cmd.message] });
        return ok({ sent: true, to: cmd.to });

      case 'emote': {
        // Accept either a UUID directly or a name (fuzzy-matched)
        const emoteId = cmd.emoteId || (cmd.name ? uuidFor(cmd.name) : null);
        if (!emoteId) return ok({ error: cmd.name ? `Unknown emote: ${cmd.name}` : 'Need emoteId or name' });
        client.queue('emote', {
          entity_id: state.runtimeId ?? 0n,
          emote_id: emoteId,
          emote_length_ticks: 0,
          xuid: '',
          platform_id: '',
          flags: 'server_side',
        });
        return ok({ sent: true, emoteId, emote: titleFor(emoteId) || emoteId });
      }

      case 'pos':
        return ok({ pos: state.pos, yaw: state.yaw, pitch: state.pitch });

      case 'tp': {
        if (!SEND_CMD) return ok({ error: 'No SEND_CMD configured' });
        const cmdStr = `tp ${USERNAME} ${cmd.x} ${cmd.y} ${cmd.z}${cmd.yaw !== undefined ? ' ' + cmd.yaw : ''}`;
        const parts = SEND_CMD.split(/\s+/);
        execFileSync(parts[0], [...parts.slice(1), cmdStr], { timeout: 5000 });
        state = { ...state, ...setPosition(state, cmd.x, cmd.y, cmd.z) };
        if (cmd.yaw !== undefined) state = { ...state, ...setRotation(state, cmd.yaw, state.pitch) };
        _ignoreMoveUntil = Date.now() + 2000;
        // Request sub-chunks for chunks near the teleported position
        const scope = 2;
        const tx = Math.floor(cmd.x / 16);
        const tz = Math.floor(cmd.z / 16);
        for (let dx = -scope; dx <= scope; dx++) {
          for (let dz = -scope; dz <= scope; dz++) {
            requestSubChunks(tx + dx, tz + dz);
          }
        }
        return ok({ teleported: true, pos: state.pos });
      }

      case 'move': {
        if (!state.pos) return ok({ error: 'No position' });
        const steps = walkSteps(state.pos, { x: cmd.x, y: cmd.y, z: cmd.z });
        for (const step of steps) {
          client.queue('move_player', buildMovePlayer(state, step.x, step.y, step.z));
          client.queue('player_auth_input', buildPlayerAuthInput(state, step.x, step.y, step.z));
          state = { ...state, ...setPosition(state, step.x, step.y, step.z) };
        }
        return ok({ moved: true, steps: steps.length, pos: state.pos });
      }

      case 'setpos': {
        const pkt = buildMovePlayer(state, cmd.x, cmd.y, cmd.z, cmd.pitch, cmd.yaw, 'teleport');
        client.queue('move_player', pkt);
        client.queue('player_auth_input', buildPlayerAuthInput(state, cmd.x, cmd.y, cmd.z));
        state = { ...state, ...setPosition(state, cmd.x, cmd.y, cmd.z) };
        if (cmd.yaw !== undefined) state = { ...state, ...setRotation(state, cmd.yaw, cmd.pitch ?? 0) };
        return ok({ pos: state.pos });
      }

      case 'face': {
        if (!state.pos) return ok({ error: 'No position' });
        const angles = faceAngles(state.pos, { x: cmd.x, y: cmd.y, z: cmd.z });
        client.queue('move_player', buildMovePlayer(state, state.pos.x, state.pos.y, state.pos.z, angles.pitch, angles.yaw, 'rotation'));
        state = { ...state, ...setRotation(state, angles.yaw, angles.pitch) };
        return ok({ yaw: angles.yaw, pitch: angles.pitch });
      }

      case 'nearby': {
        const radius = cmd.radius ?? 32;
        const center = cmd.position ?? state.pos;
        if (!center) return ok({ error: 'No position' });
        const result = nearbyEntities(tracker, center, radius);
        result.players = result.players.filter(p => p.name.toLowerCase() !== USERNAME.toLowerCase());
        return ok({ nearby: result });
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

        // Build all steps from path waypoints
        const allSteps = [];
        let simPos = { ...state.pos };
        for (const wp of wPath) {
          if (wp.x === Math.floor(simPos.x) && wp.y === Math.floor(simPos.y) && wp.z === Math.floor(simPos.z)) continue;
          const steps = walkSteps(simPos, wp);
          for (const step of steps) {
            allSteps.push(step);
            simPos = step;
          }
        }

        if (allSteps.length === 0) return ok({ walked: 0, pos: state.pos });

        // Pace movement at 50ms per step (~20 tps)
        const walkId = id;
        let stepIdx = 0;
        const walkTimer = setInterval(() => {
          if (stepIdx >= allSteps.length) {
            clearInterval(walkTimer);
            emitEvent({ type: 'walk_done', id: walkId, walked: allSteps.length, pos: state.pos });
            return;
          }
          const step = allSteps[stepIdx++];
          client.queue('move_player', buildMovePlayer(state, step.x, step.y, step.z));
          client.queue('player_auth_input', buildPlayerAuthInput(state, step.x, step.y, step.z));
          state = { ...state, ...setPosition(state, step.x, step.y, step.z) };
        }, 50);

        return ok({ walking: true, steps: allSteps.length, path: wPath });
      }

      case 'cmd': {
        if (!SEND_CMD) return ok({ error: 'No SEND_CMD configured' });
        const cmdStr = cmd.cmd ?? cmd.command;
        if (!cmdStr) return ok({ error: 'Need cmd field' });
        const parts = SEND_CMD.split(/\s+/);
        execFileSync(parts[0], [...parts.slice(1), cmdStr], { timeout: 5000 });
        return ok({ cmd: cmdStr });
      }

      case 'status': {
        return ok({
          connected: !!client.status,
          pos: state.pos,
          uptime: Math.floor((Date.now() - _startedAt) / 1000),
          chunks: chunkCache.chunks.size,
          entities: {
            players: tracker.players.size,
            mobs: tracker.mobs.size,
            items: tracker.items.size,
          },
          emotes: emoteCount(),
        });
      }

      case 'players': {
        const list = [];
        for (const [, p] of roster.players) {
          list.push({ name: p.name, uuid: p.uuid, platform: p.platform, joinedAt: p.joinedAt });
        }
        return ok({ players: list, count: list.length });
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
  if (!t) return;
  let cmd;
  try { cmd = JSON.parse(t); } catch { return; }
  handle(cmd);
});

// ── TCP command server ────────────────────────────────────

const tcpServer = net.createServer((socket) => {
  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk.toString();
    const nl = buf.indexOf('\n');
    if (nl === -1) return;
    const line = buf.slice(0, nl).trim();
    buf = '';
    let cmd;
    try { cmd = JSON.parse(line); } catch {
      socket.write(JSON.stringify({ type: 'response', error: 'Invalid JSON' }) + '\n');
      socket.end();
      return;
    }
    const respond = (data) => {
      try {
        socket.write(JSON.stringify(data, (k, v) => typeof v === 'bigint' ? Number(v) : v) + '\n');
        socket.end();
      } catch {}
    };
    handle(cmd, respond);
  });
  socket.on('error', () => {});
});

tcpServer.on('error', (err) => {
  log('TCP server error: ' + err.message + ' (continuing without TCP)');
});
tcpServer.listen(CLAWMINE_PORT, '127.0.0.1', () => {
  log('TCP server listening on port ' + CLAWMINE_PORT);
});

emitEvent({ type: 'startup', version: '0.4.0' });

// ── Graceful shutdown ─────────────────────────────────────

function shutdown() {
  log('Shutting down...');
  if (tickInterval) clearInterval(tickInterval);
  rl.close();
  tcpServer.close();
  try { client.close(); } catch {}
  emitEvent({ type: 'shutdown' });
  eventStream.end(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
