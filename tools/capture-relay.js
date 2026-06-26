/**
 * capture-relay.js — Man-in-the-middle packet capture for protocol diagnosis.
 *
 * Sits between a real Minecraft Bedrock client (via bedrock-connect) and the
 * destination server, decoding and logging traffic. Used to discover how the
 * live 1.26.31 server's packets (player_auth_input, command_request, move_player)
 * differ from the bundled 1.26.30 schema that bedrock-protocol negotiates.
 *
 * TOPOLOGY (with bedrock-connect):
 *   console → bedrock-connect → [this relay :RELAY_PORT] → server :19132
 * Point a bedrock-connect server entry at the relay's host:port instead of the
 * real server. The relay forwards everything to DEST_HOST:DEST_PORT.
 *
 * Usage:
 *   RELAY_PORT=19200 DEST_HOST=192.168.1.10 DEST_PORT=19132 \
 *     node tools/capture-relay.js
 *
 * Output:
 *   - tools/capture.jsonl   — decoded packets (one JSON object per line)
 *   - tools/capture-raw.log — raw hex for the packets of interest + parse failures
 *   - stderr                — live human-readable summary
 *
 * Env:
 *   RELAY_PORT   (default 19200)  UDP port the relay listens on
 *   DEST_HOST    (default 192.168.1.10)
 *   DEST_PORT    (default 19132)
 *   VERSION      (default 1.26.30) protocol version to negotiate
 *   OFFLINE      (default true)   set false if the destination needs Xbox auth
 *   FILTER       (default player_auth_input,command_request,move_player,
 *                correct_player_move_prediction) comma-separated packet names to
 *                log in full; use "*" to log every packet name (counts only)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bedrock from 'bedrock-protocol';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RELAY_PORT = parseInt(process.env.RELAY_PORT || '19200');
const DEST_HOST = process.env.DEST_HOST || '192.168.1.10';
const DEST_PORT = parseInt(process.env.DEST_PORT || '19132');
const VERSION = process.env.VERSION || '1.26.30';
const OFFLINE = process.env.OFFLINE !== 'false';
const FILTER = (process.env.FILTER ||
  'player_auth_input,command_request,move_player,correct_player_move_prediction')
  .split(',').map(s => s.trim()).filter(Boolean);
const LOG_ALL = FILTER.includes('*');

const OUT_TAG = process.env.CAPTURE_TAG || '';
const OUT_JSONL = path.join(__dirname, `capture${OUT_TAG}.jsonl`);
const OUT_RAW = path.join(__dirname, `capture${OUT_TAG}-raw.log`);
fs.writeFileSync(OUT_JSONL, '');
fs.writeFileSync(OUT_RAW, '');

// Heavy packets: record their name + size + order in the sequence, but never dump
// the (potentially multi-hundred-KB) decoded body or raw hex. Keeps the capture
// readable when FILTER='*'. We still see WHERE they occur in the handshake.
const BULK = new Set([
  'level_chunk', 'subchunk', 'client_cache_blob_status', 'biome_definition_list',
  'available_commands', 'crafting_data', 'creative_content', 'start_game',
  'item_registry', 'item_component', 'resource_packs_info', 'resource_pack_stack',
  'sync_entity_property',
]);

const log = (...a) => process.stderr.write(a.join(' ') + '\n');
const bigintReplacer = (k, v) => (typeof v === 'bigint' ? v.toString() : v);

// Per-packet-name counters so we can see the full traffic profile without
// drowning in output. Keyed by the literal direction label ('C->S' / 'S->C').
const counts = {};
function bump(dir, name) {
  if (!counts[dir]) counts[dir] = {};
  counts[dir][name] = (counts[dir][name] || 0) + 1;
}

// Subclass note: bedrock-protocol's relay.js exports only `Relay`. We tap the
// per-player readPacket/readUpstream hooks after join (below) to forward raw
// bytes transparently AND capture decoded copies. Forwarding raw on parse
// failure keeps the session alive through packets the 1.26.30 schema can't
// decode (e.g. 1.26.31 biome_definition_list) — the failure is itself a clue.
const { Relay } = bedrock;

const relay = new Relay({
  host: '0.0.0.0',
  port: RELAY_PORT,
  offline: OFFLINE,
  version: VERSION,
  // Keep going if a packet fails to parse — we want to capture its raw bytes,
  // not tear down the session.
  omitParseErrors: true,
  destination: { host: DEST_HOST, port: DEST_PORT, offline: OFFLINE },
});

relay.on('join', (player, upstream) => {
  log(`\n=== client joined relay; forwarding to ${DEST_HOST}:${DEST_PORT} ===`);

  const MAX_RAW_DUMP = 4096; // never dump huge packets (chunks, biome list, etc.)

  function maybeDecodeAndLog(dir, packet) {
    // Decode for logging ONLY. Never re-encode (avoids 1.26.31↔1.26.30 mismatch).
    let name = null, params = null;
    try {
      const des = relay.deserializer.parsePacketBuffer(packet);
      name = des?.data?.name; params = des?.data?.params;
    } catch (e) {
      // Unparseable under 1.26.30 schema — that's expected for some 1.26.31
      // packets. Record a short note + small raw sample, never the whole packet.
      bump(dir, `PARSE-FAIL`);
      if (packet.length <= MAX_RAW_DUMP) {
        fs.appendFileSync(OUT_RAW, `[${dir} PARSE-FAIL] len=${packet.length} err=${e.message.slice(0, 60)}\n${packet.toString('hex')}\n\n`);
      } else {
        fs.appendFileSync(OUT_RAW, `[${dir} PARSE-FAIL] len=${packet.length} err=${e.message.slice(0, 60)} (first 256B)\n${packet.slice(0, 256).toString('hex')}\n\n`);
      }
      // Still record the order/occurrence in the sequence log so the handshake
      // diff sees that *something* unparseable arrived here.
      fs.appendFileSync(OUT_JSONL, JSON.stringify({ dir, name: 'PARSE-FAIL', len: packet.length, head: packet.slice(0, 4).toString('hex') }) + '\n');
      return;
    }
    if (!name) return;
    bump(dir, name);
    const interesting = LOG_ALL || FILTER.includes(name);
    if (!interesting) return;
    try {
      if (BULK.has(name)) {
        // Heavy packet (chunks, big tables): record name + size in the sequence,
        // but don't dump the (potentially huge) decoded body or raw hex.
        fs.appendFileSync(OUT_JSONL, JSON.stringify({ dir, name, len: packet.length, bulk: true }) + '\n');
      } else {
        fs.appendFileSync(OUT_JSONL, JSON.stringify({ dir, name, params }, bigintReplacer) + '\n');
        if (packet.length <= MAX_RAW_DUMP) {
          fs.appendFileSync(OUT_RAW, `[${dir}] ${name} len=${packet.length}\n${packet.toString('hex')}\n\n`);
        }
      }
      if (counts[dir][name] <= 2) {
        log(`[${dir}] ${name}${BULK.has(name) ? ' (bulk, len=' + packet.length + ')' : '  ' + JSON.stringify(params, bigintReplacer).slice(0, 200)}`);
      }
    } catch (e) { log(`log ${dir} err: ${e.message}`); }
  }

  // ── Serverbound (Client → Server): override readPacket to forward raw on
  //    parse failure instead of dropping, and to capture decoded copies. ──
  player.readPacket = (packet) => {
    maybeDecodeAndLog('C->S', packet);
    if (player.startRelaying && player.upstream) {
      player.flushUpQueue?.();
      player.upstream.sendBuffer(packet); // forward raw decrypted bytes upstream
    } else {
      player.upQ.push(packet);
    }
  };

  // ── Clientbound (Server → Client): override readUpstream to forward raw,
  //    including packets the 1.26.30 schema can't parse (e.g. biome list). ──
  player.readUpstream = (packet) => {
    if (!player.startRelaying) { player.downQ.push(packet); return; }
    maybeDecodeAndLog('S->C', packet);
    player.sendBuffer(packet); // forward raw decrypted bytes to the console
  };
});

relay.on('error', (e) => log('relay error: ' + (e?.message || e)));

relay.listen();
log(`Capture relay listening on 0.0.0.0:${RELAY_PORT} (UDP)`);
log(`Destination: ${DEST_HOST}:${DEST_PORT}  version=${VERSION}  offline=${OFFLINE}`);
log(`Logging packets: ${LOG_ALL ? 'ALL (counts) + raw for none' : FILTER.join(', ')}`);
log(`Decoded -> ${OUT_JSONL}`);
log(`Raw hex -> ${OUT_RAW}`);
log('Point a bedrock-connect entry at this host:' + RELAY_PORT + ', then walk around.\n');

// Print a traffic summary on exit (Ctrl-C).
function summary() {
  for (const dir of Object.keys(counts)) {
    log(`\n=== packet counts (${dir}) ===`);
    for (const [n, c] of Object.entries(counts[dir]).sort((a, b) => b[1] - a[1])) log(`  ${c}\t${n}`);
  }
  process.exit(0);
}
process.on('SIGINT', summary);
process.on('SIGTERM', summary);
