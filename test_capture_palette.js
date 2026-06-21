#!/usr/bin/env node
/**
 * ClawCraft — Block palette capture & hash computation
 *
 * Builds a runtime ID → block name mapping by computing FNV-1a 32-bit hashes
 * over canonical block state NBT data from pmmp/BedrockData.
 *
 * Algorithm (confirmed from CloudburstMC/Cloudburst source):
 *   1. For each block state, build NBT compound: { name: "minecraft:...", states: {sorted} }
 *   2. Serialize as little-endian NBT (u16 LE string lengths, 4-byte LE ints)
 *   3. Hash all bytes with FNV-1a 32-bit
 *
 * Data source: pmmp/BedrockData canonical_block_states.nbt (littleVarint format)
 *   - Downloaded from: https://github.com/pmmp/BedrockData/tree/bedrock-1.26.30
 *   - Each entry contains: name, states, version
 *   - For hashing: version field is EXCLUDED (only name + states)
 *
 * Status: Algorithm is correct but requires exact version match between
 * data file and server. Server runs 1.26.31, data is for 1.26.30.
 * Update canonical_block_states.nbt when pmmp publishes 1.26.31 data.
 *
 * Usage:
 *   # Update data file:
 *   curl -sL "https://raw.githubusercontent.com/pmmp/BedrockData/bedrock-1.26.30/canonical_block_states.nbt" \
 *     -o data/canonical_block_states.nbt
 *
 *   # Run:
 *   node test_capture_palette.js
 */
import nbt from 'prismarine-nbt';
import bedrock from 'bedrock-protocol';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { decodeSubChunkBuffer } from './src/blocks.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const PALETTE_PATH = join(DATA_DIR, 'block_palette.json');
const CANONICAL_PATH = join(DATA_DIR, 'canonical_block_states.nbt');

const HOST = process.env.HOST || '192.168.1.10';
const PORT = parseInt(process.env.PORT || '19132');
const USERNAME = process.env.USERNAME || 'KiroBot';

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

// ── Parse canonical_block_states.nbt (littleVarint sequential compounds) ──

function readUVarint(buf, off) {
  let r = 0, s = 0;
  while (off < buf.length) { const b = buf[off++]; r |= (b & 0x7f) << s; s += 7; if (!(b & 0x80)) break; }
  return [r >>> 0, off];
}
function readZigzag(buf, off) { const [r, o] = readUVarint(buf, off); return [(r >>> 1) ^ -(r & 1), o]; }
function skipString(buf, off) { const [len, o] = readUVarint(buf, off); return o + len; }
function skipTag(buf, off, type) {
  switch (type) {
    case 1: return off + 1; case 2: return off + 2; case 5: return off + 4; case 6: return off + 8;
    case 3: { const [, o] = readZigzag(buf, off); return o; }
    case 4: { let o = off; while (o < buf.length && (buf[o] & 0x80)) o++; return o + 1; }
    case 7: { const [len, o] = readZigzag(buf, off); return o + len; }
    case 8: return skipString(buf, off);
    case 9: { const lt = buf[off++]; const [cnt, o] = readZigzag(buf, off); off = o; for (let i = 0; i < cnt; i++) off = skipTag(buf, off, lt); return off; }
    case 10: return skipCompound(buf, off);
    case 11: { const [len, o] = readZigzag(buf, off); off = o; for (let i = 0; i < len; i++) { const [, o2] = readZigzag(buf, off); off = o2; } return off; }
    default: throw new Error('Unknown tag type ' + type + ' at offset ' + off);
  }
}
function skipCompound(buf, off) {
  while (off < buf.length) { const t = buf[off++]; if (t === 0) return off; off = skipString(buf, off); off = skipTag(buf, off, t); }
  return off;
}

// ── Build palette ──

async function buildPalette() {
  if (!existsSync(CANONICAL_PATH)) {
    console.error(`Missing: ${CANONICAL_PATH}`);
    console.error('Download with: curl -sL "https://raw.githubusercontent.com/pmmp/BedrockData/bedrock-1.26.30/canonical_block_states.nbt" -o data/canonical_block_states.nbt');
    process.exit(1);
  }

  const data = readFileSync(CANONICAL_PATH);
  console.log(`Parsing ${CANONICAL_PATH} (${data.length} bytes)...`);

  // Find entry boundaries
  const slices = [];
  let offset = 0;
  while (offset < data.length && data[offset] === 0x0A) {
    const start = offset;
    offset++; offset = skipString(data, offset); offset = skipCompound(data, offset);
    slices.push(data.subarray(start, offset));
  }
  console.log(`Found ${slices.length} block state entries`);

  // Parse each entry, rebuild without version, serialize as LE NBT, hash
  const hashMap = new Map();
  const palette = [];

  for (let i = 0; i < slices.length; i++) {
    const { parsed } = await nbt.parse(slices[i], 'littleVarint');

    // Rebuild: name + states (sorted), no version
    const statesVal = {};
    if (parsed.value.states?.value) {
      const keys = Object.keys(parsed.value.states.value).sort();
      for (const k of keys) statesVal[k] = parsed.value.states.value[k];
    }

    const rebuilt = { type: 'compound', name: '', value: {
      name: parsed.value.name,
      states: { type: 'compound', value: statesVal },
    }};

    const leBuf = nbt.writeUncompressed(rebuilt, 'little');
    const h = fnv1a32(leBuf);
    const blockName = parsed.value.name.value;

    hashMap.set(h, blockName);
    palette.push({ runtimeId: h, index: i, name: blockName });
  }

  console.log(`Computed ${hashMap.size} unique hashes`);
  return { palette, hashMap };
}

// ── Main ──

const { palette, hashMap } = await buildPalette();

// Save palette
writeFileSync(PALETTE_PATH, JSON.stringify(palette, null, 2));
console.log(`Saved: ${PALETTE_PATH}`);

// Connect and verify
console.log(`\nConnecting to ${HOST}:${PORT} as ${USERNAME}...`);

const client = bedrock.createClient({ host: HOST, port: PORT, username: USERNAME, offline: true, timeout: 30000 });

let verified = false;
client.on('start_game', (pkt) => {
  console.log(`Server: block_network_ids_are_hashes=${pkt.block_network_ids_are_hashes}, protocol=${client.options.version}`);
});

let requested = false;
client.on('level_chunk', (pkt) => {
  if (requested || !pkt || pkt.sub_chunk_count !== -2) return;
  requested = true;
  setTimeout(() => {
    if (client.serializer) {
      const w = client.serializer.proto.writeCtx, s = client.serializer.proto.sizeOfCtx;
      w.packet_subchunk_request = (v, buf, off) => { off=w.zigzag32(v.dimension,buf,off); off=w.varint(v.requests.length,buf,off); for(const r of v.requests){off=w.i8(r.x,buf,off);off=w.i8(r.y,buf,off);off=w.i8(r.z,buf,off);} off=w.li32(v.origin.x,buf,off);off=w.li32(v.origin.y,buf,off);off=w.li32(v.origin.z,buf,off); return off; };
      s.packet_subchunk_request = (v) => s.zigzag32(v.dimension)+s.varint(v.requests.length)+v.requests.length*3+12;
    }
    const reqs = []; for (let y = 0; y <= 23; y++) reqs.push({x:0,y,z:0});
    client.write('subchunk_request', { dimension: 0, requests: reqs, origin: { x: pkt.x, y: 0, z: pkt.z } });
  }, 500);
});

client.on('subchunk', (pkt) => {
  if (verified || !pkt?.entries) return;
  const allIds = new Set();
  for (const e of pkt.entries) {
    if (e.result !== 'success' || !e.payload?.length) continue;
    try { const { blocks } = decodeSubChunkBuffer(Buffer.from(e.payload)); for (const id of blocks) if (id) allIds.add(id); } catch {}
  }
  if (!allIds.size) return;
  verified = true;

  let matched = 0;
  for (const id of allIds) if (hashMap.has(id)) matched++;
  const pct = Math.round(matched / allIds.size * 100);

  console.log(`\nVerification: ${matched}/${allIds.size} IDs resolved (${pct}%)`);
  if (matched > 0) {
    console.log('Resolved blocks:');
    for (const id of allIds) { const n = hashMap.get(id); if (n) console.log(`  ${id} -> ${n}`); }
  }
  if (pct < 100) {
    const unmatched = [...allIds].filter(id => !hashMap.has(id));
    console.log(`\nUnresolved (${unmatched.length}): version mismatch between data file and server.`);
    console.log('Update canonical_block_states.nbt when newer data is available.');
  }

  setTimeout(() => { client.close(); process.exit(0); }, 500);
});

client.on('error', () => {});
setTimeout(() => { if (!verified) console.log('Timeout'); client.close(); process.exit(0); }, 15000);

// ── Export lookup ──
export function lookup(runtimeId) { return hashMap.get(runtimeId) || null; }
