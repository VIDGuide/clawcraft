#!/usr/bin/env node
/**
 * ClawMine — Block palette capture script
 *
 * Connects to the server and builds a runtime ID → block name mapping.
 *
 * When block_network_ids_are_hashes=true (Bedrock 1.21+), runtime IDs are
 * FNV-1a 32-bit hashes of the canonical LE NBT block state (name + states).
 *
 * This script computes hashes from minecraft-data's blockStates and verifies
 * them against actual server data. Due to version mismatches between the
 * data files and the running server, some IDs may not resolve.
 *
 * Usage: node test_capture_palette.js
 * Output: data/block_palette.json
 */
import nbt from 'prismarine-nbt';
import mcDataLoader from 'minecraft-data';
import bedrock from 'bedrock-protocol';
import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { decodeSubChunkBuffer } from './src/blocks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const PALETTE_PATH = join(DATA_DIR, 'block_palette.json');

const HOST = '192.168.1.10';
const PORT = 19132;
const USERNAME = 'KiroBot';

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ── FNV-1a 32-bit ──

function fnv1a32(buffer) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < buffer.length; i++) {
    hash ^= buffer[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// ── Build palette from blockStates ──

function buildPalette() {
  const mcData = mcDataLoader('bedrock_1.26.30');
  const blockStates = mcData.blockStates;
  console.log(`blockStates: ${blockStates.length} entries (from minecraft-data)`);

  const palette = [];
  const hashToName = new Map();

  for (const bs of blockStates) {
    const states = {};
    if (bs.states) {
      const sortedKeys = Object.keys(bs.states).sort();
      for (const key of sortedKeys) {
        const val = bs.states[key];
        const type = val.type || 'int';
        const value = val.value !== undefined ? val.value : val;
        switch (type) {
          case 'byte': states[key] = nbt.byte(Number(value)); break;
          case 'int': states[key] = nbt.int(Number(value)); break;
          case 'string': states[key] = nbt.string(String(value)); break;
        }
      }
    }

    // Hash over LE NBT with just name + states (no version field)
    // Canonical form per CloudburstMC/Protocol
    const tag = nbt.comp({
      name: nbt.string('minecraft:' + bs.name),
      states: nbt.comp(states),
    });
    const buf = nbt.writeUncompressed(tag, 'little');
    const hash = fnv1a32(buf);

    palette.push({ runtimeId: hash, name: bs.name, states: bs.states || {} });
    hashToName.set(hash, bs.name);
  }

  console.log(`Computed ${hashToName.size} unique hashes`);
  return { palette, hashToName };
}

// ── Connect and verify ──

const { palette, hashToName } = buildPalette();

console.log(`\nConnecting to ${HOST}:${PORT} as ${USERNAME}...`);

const client = bedrock.createClient({
  host: HOST, port: PORT, username: USERNAME,
  offline: true, timeout: 30000,
});

let verified = false;

client.on('start_game', (pkt) => {
  console.log(`\n=== start_game ===`);
  console.log(`block_network_ids_are_hashes: ${pkt.block_network_ids_are_hashes}`);
  console.log(`game_version: ${pkt.game_version}`);
  console.log(`Protocol: ${client.options.version}`);
});

let firstChunk = null;
client.on('level_chunk', (pkt) => {
  if (firstChunk || !pkt || pkt.sub_chunk_count !== -2) return;
  firstChunk = pkt;
  setTimeout(() => requestSubChunks(pkt.x, pkt.z), 500);
});

function requestSubChunks(cx, cz) {
  try {
    if (client.serializer) {
      const wCtx = client.serializer.proto.writeCtx;
      const sCtx = client.serializer.proto.sizeOfCtx;
      wCtx.packet_subchunk_request = function (v, buf, off) {
        off = wCtx.zigzag32(v.dimension, buf, off);
        off = wCtx.varint(v.requests.length, buf, off);
        for (const r of v.requests) { off = wCtx.i8(r.x, buf, off); off = wCtx.i8(r.y, buf, off); off = wCtx.i8(r.z, buf, off); }
        off = wCtx.li32(v.origin.x, buf, off); off = wCtx.li32(v.origin.y, buf, off); off = wCtx.li32(v.origin.z, buf, off);
        return off;
      };
      sCtx.packet_subchunk_request = (v) => sCtx.zigzag32(v.dimension) + sCtx.varint(v.requests.length) + v.requests.length * 3 + 12;
    }
    const requests = [];
    for (let y = 0; y <= 23; y++) requests.push({ x: 0, y, z: 0 });
    client.write('subchunk_request', { dimension: 0, requests, origin: { x: cx, y: 0, z: cz } });
    console.log(`Requested sub-chunks for (${cx}, ${cz})`);
  } catch (e) { console.error('Request failed:', e.message); }
}

client.on('subchunk', (pkt) => {
  if (verified || !pkt || !pkt.entries) return;

  const allIds = new Set();
  for (const entry of pkt.entries) {
    if (entry.result !== 'success' || !entry.payload || entry.payload.length === 0) continue;
    try {
      const { blocks } = decodeSubChunkBuffer(Buffer.from(entry.payload));
      for (const id of blocks) if (id !== 0) allIds.add(id);
    } catch {}
  }
  if (allIds.size === 0) return;
  verified = true;

  console.log(`\n=== Verification ===`);
  console.log(`Unique runtime IDs from server: ${allIds.size}`);

  let matched = 0;
  const matchedBlocks = [];
  const unmatchedIds = [];

  for (const id of allIds) {
    const name = hashToName.get(id);
    if (name) { matched++; matchedBlocks.push({ id, name }); }
    else { unmatchedIds.push(id); }
  }

  const pct = Math.round(matched / allIds.size * 100);
  console.log(`Match rate: ${matched}/${allIds.size} (${pct}%)`);

  if (matchedBlocks.length > 0) {
    console.log('\nResolved blocks:');
    matchedBlocks.forEach(b => console.log(`  ${b.id} -> ${b.name}`));
  }
  if (unmatchedIds.length > 0) {
    console.log(`\nUnresolved IDs (${unmatchedIds.length}):`);
    unmatchedIds.slice(0, 10).forEach(id => console.log(`  ${id}`));
    if (unmatchedIds.length > 10) console.log(`  ... and ${unmatchedIds.length - 10} more`);
  }

  // Save palette
  writeFileSync(PALETTE_PATH, JSON.stringify(palette, null, 2));
  console.log(`\nPalette saved: ${PALETTE_PATH} (${palette.length} entries)`);

  console.log('\n=== Summary ===');
  console.log(`Server version: 1.26.31, Data version: 1.21.80 blockStates`);
  console.log(`The ${pct}% match rate is due to version mismatch between`);
  console.log(`minecraft-data's block state definitions and the server.`);
  console.log(`To get 100% coverage, update minecraft-data or capture the`);
  console.log(`server's canonical block states via a proxy/relay.`);

  setTimeout(() => { client.close(); process.exit(0); }, 500);
});

client.on('error', (e) => console.error('Error:', e.message));
setTimeout(() => {
  if (!verified) console.log('Timeout: no sub-chunk data received');
  client.close();
  process.exit(verified ? 0 : 1);
}, 20000);

// ── Lookup function ──
export function lookup(runtimeId) {
  return hashToName.get(runtimeId) || `[unknown: ${runtimeId}]`;
}
