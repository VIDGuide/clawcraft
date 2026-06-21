#!/usr/bin/env node
/**
 * ClawCraft — AI agent harness for Minecraft Bedrock
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

import { createState, applyMovePlayer } from './state.js';
import { createEntityTracker, handleAddPlayer, handleAddEntity, handleAddItemEntity, handleMoveEntity, handleRemoveEntity, handlePlayerList } from './entities.js';
import { createChunkCache, setChunk, chunkKeyFromPos, evictChunks } from './chunks.js';
import { decodeSubChunkBuffer } from './blocks.js';
import { decodeLevelChunk, applyBlockUpdates } from './decoder.js';
import { createChatConfig, processIncoming } from './chat.js';
import { titleFor } from './emotes.js';
import { createPlayerRoster, processPlayerList, processPlayerAppear, processPlayerDisappear, createProximityTracker, checkProximity, removeFromProximity } from './players.js';
import { createItemPalette } from './items.js';
import { createInventory, applyInventoryContent, applyInventorySlot, applyMobEquipment as applyMobEquip, applyMobArmor, applyArmorDamage, generateEvents, correlatePickup } from './inventory.js';
import { createVitals, applyAttributes, applyEffect, applyDeath, applyRespawn, createBuffer, bufferChanges, setHurt, setDeathInfo, flushBuffer } from './vitals.js';
import { handle as handleCommand } from './commands.js';
import { checkDangerAlerts } from './alerts.js';

const HOST = process.env.HOST || '192.168.1.10';
const PORT = parseInt(process.env.PORT || '19132');
const USERNAME = process.env.BOT_USERNAME || process.env.USERNAME || 'ClawBot';
const OFFLINE = process.env.OFFLINE !== 'false';
const CLAWCRAFT_AUTH_DIR = process.env.CLAWCRAFT_AUTH_DIR || undefined;
const SEND_CMD = process.env.SEND_CMD || null;
const CLAWCRAFT_PORT = parseInt(process.env.CLAWCRAFT_PORT || '4099');
const CLAWCRAFT_EVENTS = process.env.CLAWCRAFT_EVENTS || './events.jsonl';
const CLAWCRAFT_RECONNECT = process.env.CLAWCRAFT_RECONNECT === 'true';
const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];
const CLAWCRAFT_CHUNK_CACHE_MAX = parseInt(process.env.CLAWCRAFT_CHUNK_CACHE_MAX || '512');
const CLAWCRAFT_CHUNK_EVICT_DIST = parseInt(process.env.CLAWCRAFT_CHUNK_EVICT_DIST || '256');
const DANGER_CONFIG = {
  mobDistance: parseFloat(process.env.CLAWCRAFT_DANGER_MOB_DIST || '8'),
  lowHealth: parseFloat(process.env.CLAWCRAFT_DANGER_HEALTH || '6'),
  lowHunger: parseFloat(process.env.CLAWCRAFT_DANGER_HUNGER || '4'),
};
const chatConfig = createChatConfig();

const log = (...args) => process.stderr.write(`[${new Date().toISOString()}] ${args.join(' ')}\n`);
log(`Connecting to ${HOST}:${PORT} as ${USERNAME} (offline: ${OFFLINE})`);

// ── State ─────────────────────────────────────────────────

let state = createState();
let tracker = createEntityTracker();
let chunkCache = createChunkCache();
let roster = createPlayerRoster();
let proxTracker = createProximityTracker();
let itemPalette = null;
let inventory = createInventory();
let vitals = createVitals();
let _vitalsBuffer = createBuffer();
let _vitalsFlushTimer = null;
const _recentItemRemovals = []; // ring buffer for pickup correlation
let _activeMine = null;  // {timer, crackTimer, id, pos, block}
let _activeEat = null;   // {timer, id, item}
let _activeWalk = null;  // {timer, id, steps, stepIdx, allSteps}
let _lastAlerts = new Map();
let _lastDeathPos = null;
let _lastDeathInventory = null;
let tickInterval;
let _ignoreMoveUntil = 0;
const _startedAt = Date.now();
let _initialized = false;
const _pendingSubchunkRequests = [];
let _reconnectAttempt = 0;
let _reconnecting = false;

// ── Client ─────────────────────────────────────────────────

let client;

// ── Sub-chunk request (module scope so handle()/ctx can call it) ──
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
  if (requests.length === 0) return;
  try {
    setupSubchunkSerializer();
    // Offsets (x/y/z) are i8 relative to origin; origin holds the absolute chunk coords (li32).
    client.write('subchunk_request', {
      dimension: 0,
      requests,
      origin: { x: cx, y: -4, z: cz },
    });
    log('Rq cx=' + cx + ' cz=' + cz + ' center=' + centerSub + ' count=' + requests.length);
  } catch(e) { log('Rq err: ' + e.message); }
}

function connect() {
  _initialized = false;
  _pendingSubchunkRequests.length = 0;
  client = bedrock.createClient({
    host: HOST, port: PORT, username: USERNAME,
    offline: OFFLINE, timeout: 30000,
    profilesFolder: CLAWCRAFT_AUTH_DIR,
    onMsaCode: OFFLINE ? undefined : (data) => {
      log(`Xbox auth required: ${data.verification_uri} — code: ${data.user_code}`);
      emitEvent({ type: 'auth_required', url: data.verification_uri, code: data.user_code });
    },
  });

client.on('join', () => {
  _reconnectAttempt = 0; // reset backoff on successful connection
  emitEvent({ type: _reconnectAttempt > 0 ? 'reconnected' : 'ready' });
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

  // Fallback: set initial position from start_game data if not yet known.
  if (!state.pos && client.startGameData?.player_position) {
    const p = client.startGameData.player_position;
    log('DEBUG start_game player_position: ' + JSON.stringify(p));
    if (typeof p.y === 'number' && p.y > -64 && p.y < 320) {
      state = { ...state, pos: { x: p.x, y: p.y, z: p.z } };
      log('Initial position from start_game on spawn: ' + JSON.stringify(state.pos));
    }
  } else if (!state.pos) {
    log('DEBUG no start_game player_position; startGameData keys: ' + Object.keys(client.startGameData || {}).join(','));
  }

  if (!tickInterval) {
    tickInterval = setInterval(() => {
      client.queue('tick_sync', { request_time: BigInt(Date.now()), response_time: 0n });
    }, 2000);
  }
});

// ── Item palette (network_id → name) ─────────────────────

client.on('start_game', (pkt) => {
  if (pkt?.itemstates) {
    itemPalette = createItemPalette(pkt.itemstates);
    log('Item palette built: ' + itemPalette.size + ' items');
  }
  // Extract runtime entity ID from start_game
  if (pkt?.runtime_entity_id) {
    state = { ...state, runtimeId: Number(pkt.runtime_entity_id) };
  }
});

client.on('item_registry', (pkt) => {
  if (pkt?.itemstates) {
    itemPalette = createItemPalette(pkt.itemstates);
    log('Item palette updated: ' + itemPalette.size + ' items');
  }
});

// ── Inventory tracking ────────────────────────────────────

function processInventoryChanges(changes) {
  let events = generateEvents(changes);
  events = correlatePickup(events, _recentItemRemovals, state.pos);
  for (const ev of events) emitEvent(ev);
}

client.on('inventory_content', (pkt) => {
  if (!pkt || !itemPalette) return;
  const { inventory: inv, changes } = applyInventoryContent(inventory, pkt.window_id, pkt.input, itemPalette);
  inventory = inv;
  if (changes.length) processInventoryChanges(changes);
});

client.on('inventory_slot', (pkt) => {
  if (!pkt || !itemPalette) return;
  const { inventory: inv, change } = applyInventorySlot(inventory, pkt.window_id, pkt.slot, pkt.item, itemPalette);
  inventory = inv;
  if (change) processInventoryChanges([change]);
});

client.on('mob_equipment', (pkt) => {
  if (!pkt || !itemPalette) return;
  // Only track our own equipment
  if (state.runtimeId && Number(pkt.runtime_entity_id) !== Number(state.runtimeId)) return;
  const { inventory: inv, change } = applyMobEquip(inventory, pkt.selected_slot);
  inventory = inv;
  if (change) emitEvent({ type: 'held_slot_changed', ...change });
});

client.on('mob_armor_equipment', (pkt) => {
  if (!pkt || !itemPalette) return;
  if (state.runtimeId && Number(pkt.runtime_entity_id) !== Number(state.runtimeId)) return;
  const { inventory: inv, changes } = applyMobArmor(inventory, pkt.helmet, pkt.chestplate, pkt.leggings, pkt.boots, itemPalette);
  inventory = inv;
  if (changes.length) processInventoryChanges(changes);
});

client.on('player_armor_damage', (pkt) => {
  if (!pkt) return;
  const damages = {};
  if (pkt.helmet_damage) damages.helmet = pkt.helmet_damage;
  if (pkt.chestplate_damage) damages.chestplate = pkt.chestplate_damage;
  if (pkt.leggings_damage) damages.leggings = pkt.leggings_damage;
  if (pkt.boots_damage) damages.boots = pkt.boots_damage;
  if (Object.keys(damages).length === 0) return;
  const { inventory: inv, changes } = applyArmorDamage(inventory, damages);
  inventory = inv;
  if (changes.length) processInventoryChanges(changes);
});

// ── Vitals tracking ───────────────────────────────────────

function scheduleVitalsFlush() {
  if (_vitalsFlushTimer) return;
  _vitalsFlushTimer = setTimeout(() => {
    _vitalsFlushTimer = null;
    const event = flushBuffer(_vitalsBuffer);
    _vitalsBuffer = createBuffer();
    if (event) emitEvent(event);
    // Check danger alerts after vitals change
    const { events: dangerEvents, lastAlerts } = checkDangerAlerts(tracker, state, vitals, _lastAlerts, DANGER_CONFIG);
    _lastAlerts = lastAlerts;
    for (const ev of dangerEvents) emitEvent(ev);
  }, 150);
}

client.on('update_attributes', (pkt) => {
  if (!pkt || !pkt.attributes) return;
  if (state.runtimeId && Number(pkt.runtime_entity_id) !== Number(state.runtimeId)) return;
  const { vitals: v, changes } = applyAttributes(vitals, pkt.attributes);
  vitals = v;
  if (changes.length) {
    _vitalsBuffer = bufferChanges(_vitalsBuffer, changes);
    scheduleVitalsFlush();
  }
});

client.on('mob_effect', (pkt) => {
  if (!pkt) return;
  if (state.runtimeId && Number(pkt.runtime_entity_id) !== Number(state.runtimeId)) return;
  const { vitals: v, event } = applyEffect(vitals, {
    eventId: pkt.event_id, effectId: pkt.effect_id,
    amplifier: pkt.amplifier, duration: pkt.duration, particles: pkt.particles,
  });
  vitals = v;
  if (event) emitEvent(event);
});

client.on('set_health', (pkt) => {
  if (!pkt) return;
  const oldHealth = vitals.health;
  if (pkt.health !== oldHealth) {
    vitals = { ...vitals, health: pkt.health };
    _vitalsBuffer = bufferChanges(_vitalsBuffer, [{ attr: 'health', old: oldHealth, new: pkt.health, max: vitals.maxHealth }]);
    scheduleVitalsFlush();
  }
});

client.on('entity_event', (pkt) => {
  if (!pkt) return;
  if (state.runtimeId && Number(pkt.runtime_entity_id) !== Number(state.runtimeId)) return;
  if (pkt.event_id === 'hurt_animation' || pkt.event_id === 2) {
    _vitalsBuffer = setHurt(_vitalsBuffer, 'attack');
  }
});

client.on('death_info', (pkt) => {
  if (!pkt) return;
  const { vitals: v, event } = applyDeath(vitals, pkt.cause, pkt.messages);
  vitals = v;
  _vitalsBuffer = setDeathInfo(_vitalsBuffer, pkt.cause, pkt.messages);
  if (event) emitEvent(event);

  // Snapshot position and inventory at death
  _lastDeathPos = state.pos ? { ...state.pos } : null;
  _lastDeathInventory = inventory.slots.filter(Boolean);
  emitEvent({
    type: 'death_details',
    pos: _lastDeathPos,
    items: _lastDeathInventory,
    cause: pkt.cause,
    messages: pkt.messages,
  });

  // Auto-respawn if configured
  if (CLAWCRAFT_RESPAWN) {
    setTimeout(() => {
      try {
        client.write('respawn', {
          player_runtime_id: state.runtimeId ?? 0n,
          state: 'client_ready_to_play',
        });
        log('Auto-respawn sent');
      } catch (e) { log('Auto-respawn failed:', e.message); }
    }, 1000);
  }
});

client.on('respawn', (pkt) => {
  if (!pkt) return;
  const { vitals: v, event } = applyRespawn(vitals);
  vitals = v;
  if (event) emitEvent(event);
});

client.on('packet', (des) => {
  const name = String(des?.data?.name || '');
  if (name === 'packet_violation_warning') {
    log('VIOLATION: ' + JSON.stringify(des?.data?.params));
  }
});
client.on('error', (err) => {
  log('Error:', err.message);
  emitEvent({ type: 'disconnected', reason: err.message });
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  if (CLAWCRAFT_RECONNECT) scheduleReconnect();
});
client.on('end', (reason) => {
  log('End:', reason);
  emitEvent({ type: 'disconnected', reason: reason || 'end' });
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
  if (CLAWCRAFT_RECONNECT) scheduleReconnect();
});

// ── Position tracking ─────────────────────────────────────

// Track teleported positions to avoid overwrite
let _tpAt = 0;

client.on('move_player', (pkt) => {
  if (!pkt) return;
  // Skip one packet after teleport
  if (Date.now() < _ignoreMoveUntil) return;

  const prevPos = state.pos;
  const updated = applyMovePlayer(state, pkt);
  state = { ...state, ...updated };

  // Detect position desync: server-initiated teleport or large position jump
  if (prevPos && state.pos) {
    const isServerCorrection = pkt.mode === 'teleport' || pkt.mode === 'reset';
    const drift = Math.sqrt(
      (state.pos.x - prevPos.x) ** 2 +
      (state.pos.y - prevPos.y) ** 2 +
      (state.pos.z - prevPos.z) ** 2,
    );
    if (isServerCorrection || drift > 3) {
      emitEvent({
        type: 'position_desync',
        serverPos: { ...state.pos },
        localPos: prevPos,
        drift: Math.round(drift * 10) / 10,
        mode: pkt.mode,
      });
      // Abort active walk on desync
      if (_activeWalk) {
        clearInterval(_activeWalk.timer);
        if (_activeWalk._watchdog) clearTimeout(_activeWalk._watchdog);
        emitEvent({ type: 'walk_done', id: _activeWalk.id, walked: _activeWalk.stepIdx, pos: state.pos, aborted: true, reason: 'desync' });
        _activeWalk = null;
      }
    }
  }

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
  // Detect self: username matches or starts with our name (server may add suffix like "(2)")
  const pktName = (pkt?.username || '').toLowerCase();
  const isSelf = pktName === USERNAME.toLowerCase() || pktName.startsWith(USERNAME.toLowerCase() + '(') ||
    (state.runtimeId && Number(pkt.runtime_id) === state.runtimeId);
  if (pkt && !isSelf) {
    const ev = processPlayerAppear(pkt);
    if (ev) emitEvent(ev);
  } else if (pkt && isSelf && pkt.position) {
    // Self add_player — set initial position
    state = { ...state, pos: { x: pkt.position.x, y: pkt.position.y, z: pkt.position.z } };
    if (pkt.runtime_id && !state.runtimeId) state = { ...state, runtimeId: Number(pkt.runtime_id) };
    log('Initial position from add_player: ' + JSON.stringify(state.pos));
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
    // Check danger alerts when any entity moves
    const { events: dangerEvents, lastAlerts } = checkDangerAlerts(tracker, state, vitals, _lastAlerts, DANGER_CONFIG);
    _lastAlerts = lastAlerts;
    for (const ev of dangerEvents) emitEvent(ev);
  }
});

client.on('remove_entity', (pkt) => {
  if (pkt) {
    // Track item entity removal for pickup correlation
    const loc = tracker._ridIndex.get(pkt.runtime_id);
    if (loc && loc.map === 'items') {
      const entity = tracker.items.get(loc.key);
      if (entity && entity.position && state.pos) {
        _recentItemRemovals.push({
          networkId: entity.networkId,
          position: entity.position,
          timestamp: Date.now(),
        });
        if (_recentItemRemovals.length > 20) _recentItemRemovals.shift();
      }
    }

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

} // end connect()

// ── JSON command interface ────────────────────────────────

function output(data) {
  console.log(JSON.stringify(data, (key, val) =>
    typeof val === 'bigint' ? Number(val) : val,
  ));
}

const CLAWCRAFT_MAX_EVENTS_BYTES = parseInt(process.env.CLAWCRAFT_MAX_EVENTS_MB || '5') * 1024 * 1024;

// ── Event file writer ─────────────────────────────────────

let eventStream = fs.createWriteStream(CLAWCRAFT_EVENTS, { flags: 'a' });
eventStream.on('error', (err) => log('Event file write error:', err.message));

function rotateEventLog() {
  try {
    const stat = fs.statSync(CLAWCRAFT_EVENTS);
    if (stat.size < CLAWCRAFT_MAX_EVENTS_BYTES) return;
    eventStream.end();
    fs.renameSync(CLAWCRAFT_EVENTS, CLAWCRAFT_EVENTS + '.1');
    eventStream = fs.createWriteStream(CLAWCRAFT_EVENTS, { flags: 'a' });
    eventStream.on('error', (err) => log('Event file write error:', err.message));
    log(`Event log rotated (was ${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
  } catch (e) {
    log('Event log rotation failed:', e.message);
  }
}

// Check on startup and every 5 minutes
rotateEventLog();
setInterval(rotateEventLog, 5 * 60 * 1000).unref();

function emitEvent(obj) {
  const withTs = { ...obj, timestamp: obj.timestamp ?? Date.now() };
  output(withTs);
  eventStream.write(JSON.stringify(withTs, (k, v) => typeof v === 'bigint' ? Number(v) : v) + '\n');
}

// ── Inventory item → raw protocol format ──────────────────

function itemToRaw(item) {
  if (!item) return { network_id: 0 };
  return {
    network_id: item.networkId,
    count: item.count || 1,
    metadata: item.metadata || 0,
    has_stack_id: item.stackId ? 1 : 0,
    stack_id: item.stackId || 0,
    block_runtime_id: 0,
    extra: { has_nbt: false, nbt: undefined, can_place_on: [], can_destroy: [], blocking_tick: 0 },
  };
}

function handle(cmd, outputFn = output) {
  const ctx = {
    client,
    state,
    tracker,
    chunkCache,
    roster,
    inventory,
    vitals,
    itemPalette,
    USERNAME,
    SEND_CMD,
    startedAt: _startedAt,
    execFileSync,
    emitEvent,
    itemToRaw,
    getActiveMine: () => _activeMine,
    setActiveMine: (v) => {
      if (_activeMine?._watchdog) clearTimeout(_activeMine._watchdog);
      if (v) {
        v._watchdog = setTimeout(() => {
          if (!_activeMine || _activeMine.id !== v.id) return;
          clearTimeout(_activeMine.timer);
          clearInterval(_activeMine.crackTimer);
          _activeMine = null;
          emitEvent({ type: 'command_timeout', command: 'mine', id: v.id });
        }, 30000);
      }
      _activeMine = v;
    },
    getActiveEat: () => _activeEat,
    setActiveEat: (v) => {
      if (_activeEat?._watchdog) clearTimeout(_activeEat._watchdog);
      if (v) {
        v._watchdog = setTimeout(() => {
          if (!_activeEat || _activeEat.id !== v.id) return;
          clearTimeout(_activeEat.timer);
          _activeEat = null;
          emitEvent({ type: 'command_timeout', command: 'eat', id: v.id });
        }, 10000);
      }
      _activeEat = v;
    },
    getActiveWalk: () => _activeWalk,
    setActiveWalk: (v) => {
      if (_activeWalk?._watchdog) clearTimeout(_activeWalk._watchdog);
      if (v) {
        v._watchdog = setTimeout(() => {
          if (!_activeWalk || _activeWalk.id !== v.id) return;
          clearInterval(_activeWalk.timer);
          _activeWalk = null;
          emitEvent({ type: 'command_timeout', command: 'walk', id: v.id });
        }, 60000);
      }
      _activeWalk = v;
    },
    setIgnoreMoveUntil: (t) => { _ignoreMoveUntil = t; },
    getLastDeath: () => _lastDeathPos ? { pos: _lastDeathPos, items: _lastDeathInventory } : null,
    requestSubChunksNear: (x, z) => {
      const scope = 2;
      const cx = Math.floor(x / 16);
      const cz = Math.floor(z / 16);
      for (let dx = -scope; dx <= scope; dx++)
        for (let dz = -scope; dz <= scope; dz++) {
          try { requestSubChunks(cx + dx, cz + dz); } catch (e) { log('requestSubChunksNear err: ' + e.message); }
        }
    },
  };
  handleCommand(cmd, ctx, outputFn);
  // Sync mutable state back from ctx
  state = ctx.state;
  inventory = ctx.inventory;
}

function scheduleReconnect() {
  if (_reconnecting) return;
  _reconnecting = true;
  const delay = RECONNECT_DELAYS[Math.min(_reconnectAttempt, RECONNECT_DELAYS.length - 1)];
  _reconnectAttempt++;
  emitEvent({ type: 'reconnecting', attempt: _reconnectAttempt, delay });
  log(`Reconnecting in ${delay}ms (attempt ${_reconnectAttempt})`);
  setTimeout(() => {
    _reconnecting = false;
    // Reset all session state
    state = createState();
    tracker = createEntityTracker();
    chunkCache = createChunkCache();
    roster = createPlayerRoster();
    proxTracker = createProximityTracker();
    itemPalette = null;
    inventory = createInventory();
    vitals = createVitals();
    _vitalsBuffer = createBuffer();
    _lastAlerts = new Map();
    // Abort any active operations
    if (_activeMine) { clearTimeout(_activeMine.timer); clearInterval(_activeMine.crackTimer); _activeMine = null; }
    if (_activeEat) { clearTimeout(_activeEat.timer); _activeEat = null; }
    if (_activeWalk) { clearInterval(_activeWalk.timer); _activeWalk = null; }
    connect();
  }, delay);
}

// ── Chunk LRU eviction ────────────────────────────────────

setInterval(() => {
  if (!state.pos) return;
  const { cache, evicted } = evictChunks(chunkCache, state.pos.x, state.pos.z, CLAWCRAFT_CHUNK_CACHE_MAX, CLAWCRAFT_CHUNK_EVICT_DIST);
  if (evicted > 0) {
    chunkCache = cache;
    emitEvent({ type: 'chunks_evicted', count: evicted, remaining: chunkCache.chunks.size });
    log(`Evicted ${evicted} chunks, ${chunkCache.chunks.size} remaining`);
  }
}, 60 * 1000).unref();

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
tcpServer.listen(CLAWCRAFT_PORT, '127.0.0.1', () => {
  log('TCP server listening on port ' + CLAWCRAFT_PORT);
});

emitEvent({ type: 'startup', version: '0.5.0' });

// Initial connection
connect();

// ── Graceful shutdown ─────────────────────────────────────

function shutdown() {
  log('Shutting down...');
  _reconnecting = true; // prevent reconnect on graceful shutdown
  if (tickInterval) clearInterval(tickInterval);
  rl.close();
  tcpServer.close();
  try { if (client) client.close(); } catch {}
  emitEvent({ type: 'shutdown' });
  eventStream.end(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
