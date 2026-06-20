/**
 * ClawMine — Chunk decoder (stub)
 *
 * Notes: prismarine-chunk + prismarine-registry + minecraft-data have a
 * CJS/ESM module cache collision when loaded alongside bedrock-protocol
 * (which also depends on minecraft-data). Disabling full chunk decode
 * until a workaround is found.
 *
 * Raw chunk data is still stored in the chunk cache for future decode.
 * Block queries will return null (chunk not available).
 * Entity tracking, movement, pathfinding are unaffected.
 */

export async function decodeLevelChunk(cx, cz, payload, subChunkCount) {
  // Store minimal metadata — full decode disabled
  const chunk = { x: cx, z: cz, rawSize: payload?.length || 0, subChunkCount, decoded: false };
  return chunk;
}

export async function decodeSubChunk(chunk, cy, buffer) {
  // Sub-chunk decode disabled
  return chunk;
}

export function applyBlockUpdates(chunk, blockUpdates) {
  // Block updates disabled
}

export async function createBlankChunk(cx, cz) {
  return { x: cx, z: cz, rawSize: 0, decoded: false };
}
