/**
 * Test script: Diagnose subchunk_request packet format for Bedrock 1.26.30
 * 
 * FINDINGS:
 * 1. The protocol.json for 1.26.30 has field order: dimension → requests → origin
 *    BUT all previous versions (1.19-1.21) had: dimension → origin → requests
 * 2. The origin type changed from vec3i (zigzag32) to vec3li (li32)
 * 3. The requests count type changed from lu32 to varint
 * 4. The gophertunnel reference uses: Dimension(varint32) → Position(SubChunkPos) → Offsets
 *    where SubChunkPos.Y = "absolute sub-chunk index"
 *
 * This script tests:
 * - Sends subchunk_request with origin.y set to the correct sub-chunk index
 * - Logs the response to see if data comes back
 */

import { createClient } from 'bedrock-protocol';

const client = createClient({
  host: '192.168.1.10',
  port: 19132,
  username: 'SubChunkTest',
  offline: true,
});

let spawned = false;
let playerPos = { x: 0, y: 64, z: 0 };
const timeout = setTimeout(() => {
  console.log('Timeout — no subchunk response received after 30s');
  process.exit(1);
}, 30000);

client.on('spawn', () => {
  spawned = true;
  console.log('Spawned! Waiting for level_chunk with sub_chunk_count=-2...');
});

client.on('move_player', (pkt) => {
  if (pkt.runtime_id === client.entityId) {
    playerPos = pkt.position;
  }
});

client.on('level_chunk', (pkt) => {
  if (!spawned) return;
  console.log(`level_chunk: (${pkt.x}, ${pkt.z}) sub_chunk_count=${pkt.sub_chunk_count} highest=${pkt.highest_subchunk_count || 'N/A'}`);

  if (pkt.sub_chunk_count === -2 || pkt.sub_chunk_count === -1) {
    // Request sub-chunks for this chunk
    // The Y in origin is the "absolute sub-chunk index" used as center reference
    // In overworld: sub-chunks go from -4 (Y=-64) to +19 (Y=304) for 24 total
    // We pick a center around the player's Y
    const playerSubY = Math.floor((playerPos.y + 64) / 16) - 4; // convert to absolute sub-chunk index
    const centerY = Math.max(-4, Math.min(19, playerSubY));

    // Request a range of sub-chunks around player height
    const requests = [];
    for (let dy = -2; dy <= 2; dy++) {
      const absY = centerY + dy;
      if (absY >= -4 && absY <= 19) {
        requests.push({ x: 0, y: dy, z: 0 });
      }
    }

    console.log(`Requesting subchunks for chunk (${pkt.x}, ${pkt.z}), origin.y=${centerY}, offsets: [${requests.map(r=>r.y).join(',')}]`);

    try {
      client.queue('subchunk_request', {
        dimension: 0,
        origin: { x: pkt.x, y: centerY, z: pkt.z },
        requests,
      });
    } catch (e) {
      console.error('Queue error:', e.message);
    }
  }
});

client.on('subchunk', (pkt) => {
  console.log(`\n=== SUBCHUNK RESPONSE ===`);
  console.log(`  cache_enabled: ${pkt.cache_enabled}`);
  console.log(`  dimension: ${pkt.dimension}`);
  console.log(`  origin: (${pkt.origin?.x}, ${pkt.origin?.y}, ${pkt.origin?.z})`);

  if (!pkt.entries || pkt.entries.length === 0) {
    console.log('  NO ENTRIES');
    return;
  }

  console.log(`  entries: ${pkt.entries.length}`);
  for (const entry of pkt.entries) {
    const payloadLen = entry.payload ? entry.payload.length : 0;
    console.log(`    dx=${entry.dx} dy=${entry.dy} dz=${entry.dz} result=${entry.result} payload=${payloadLen} bytes`);
  }

  // If we got success, we're done
  const hasSuccess = pkt.entries.some(e => e.result === 'success' || e.result === 'success_all_air');
  if (hasSuccess) {
    console.log('\n✓ SUCCESS! Got valid subchunk data.');
    console.log('The protocol format works with the current prismarine definition.');
    console.log('Key insight: origin.y must be an absolute sub-chunk index (not 0)');
    clearTimeout(timeout);
    setTimeout(() => process.exit(0), 1000);
  } else {
    console.log('\n✗ No successful entries. Results:', [...new Set(pkt.entries.map(e => e.result))]);
    console.log('This might mean:');
    console.log('  - y_index_out_of_bounds: origin.y or dy offset is wrong');
    console.log('  - chunk_not_found: chunk not loaded or dx/dz offset wrong');
    console.log('  - player_not_found: auth issue or not fully spawned');
  }
});

client.on('error', (err) => console.error('Error:', err.message));
client.on('close', () => { console.log('Disconnected'); process.exit(0); });

console.log('Connecting to 192.168.1.10:19132...');
console.log('Protocol test: subchunk_request with correct origin.y');
