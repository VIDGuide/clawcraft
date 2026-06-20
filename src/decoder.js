/**
 * ClawMine — Chunk decoder (packet decode layer)
 *
 * Decodes Bedrock level_chunk and subchunk packet buffers into
 * prismarine-chunk objects using prismarine-chunk's network decode.
 */

let _Chunk = null;
let _chunkPromise = null;

async function getChunkClass() {
  if (_Chunk) return _Chunk;

  if (!_chunkPromise) {
    _chunkPromise = (async () => {
      // Use ESM import() for everything — avoids CJS/ESM module cache
      // interop issues that corrupt minecraft-data's internal state.
      const [chunkMod, regMod] = await Promise.all([
        import('prismarine-chunk'),
        import('prismarine-registry'),
      ]);
      const loader = chunkMod.default || chunkMod;
      const reg = regMod.default || regMod;
      const registry = reg('bedrock_1.21');
      _Chunk = loader(registry);
      return _Chunk;
    })();
  }

  try {
    return await _chunkPromise;
  } catch (e) {
    _chunkPromise = null;
    throw new Error(`Failed to init chunk class${e.message ? ': ' + e.message : ''}`);
  }
}

export async function decodeLevelChunk(cx, cz, payload, subChunkCount) {
  const Chunk = await getChunkClass();

  if (subChunkCount === -1) {
    const empty = new Chunk();
    empty.x = cx; empty.z = cz;
    return empty;
  }

  const chunk = new Chunk();
  chunk.x = cx; chunk.z = cz;

  const blobs = [];
  const blobStore = { has: () => false, get: () => null, set: () => {} };
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Decode timed out')), 5000));

  try {
    const missing = await Promise.race([chunk.networkDecode(blobs, blobStore, payload), timeout]);
    if (missing && missing.length > 0) return chunk;
  } catch (e) {
    if (e.message?.includes('blobs')) return chunk;
    if (e.message?.includes('border blocks')) {
      console.error(`Border blocks at (${cx}, ${cz}), returning blank`);
      return chunk;
    }
    console.error(`Chunk decode error at (${cx}, ${cz}): ${e.message}`);
    return chunk;
  }

  return chunk;
}

export async function decodeSubChunk(chunk, cy, buffer) {
  if (!chunk) throw new Error('Chunk must be created first');
  try {
    await chunk.networkDecodeSubChunkNoCache(cy, buffer);
  } catch (e) {
    throw new Error(`Sub-chunk decode failed at Y=${cy}: ${e.message}`);
  }
  return chunk;
}

export function applyBlockUpdates(chunk, blockUpdates) {
  if (!chunk || !blockUpdates || blockUpdates.length === 0) return;
  for (const update of blockUpdates) {
    try {
      const lx = ((update.x % 16) + 16) % 16;
      const lz = ((update.z % 16) + 16) % 16;
      chunk.setBlock(lx, update.y, lz, {
        name: update.block?.name || 'air',
        stateId: update.block?.stateId || 0,
        states: update.block?.states || {},
      });
    } catch { /* skip failures */ }
  }
}

export async function createBlankChunk(cx, cz) {
  const Chunk = await getChunkClass();
  const chunk = new Chunk();
  chunk.x = cx; chunk.z = cz;
  return chunk;
}
