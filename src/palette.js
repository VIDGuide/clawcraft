/**
 * ClawCraft — Block palette lookup
 *
 * Maps runtime block IDs (FNV-1a hashes) to block names using the
 * pre-computed palette in data/block_palette.json.
 *
 * Generate/update the palette with: node test_capture_palette.js
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PALETTE_PATH = join(__dirname, '..', 'data', 'block_palette.json');

let idToName = new Map();
let loaded = false;

/**
 * Load the palette from disk. Safe to call multiple times.
 * Returns the number of entries loaded.
 */
export function loadPalette(path = PALETTE_PATH) {
  if (!existsSync(path)) {
    loaded = false;
    return 0;
  }
  try {
    const entries = JSON.parse(readFileSync(path, 'utf8'));
    idToName = new Map();
    for (const e of entries) {
      if (!idToName.has(e.runtimeId)) idToName.set(e.runtimeId, e.name);
    }
    loaded = true;
    return idToName.size;
  } catch {
    loaded = false;
    return 0;
  }
}

/**
 * Look up a block name by runtime ID.
 * Returns the block name (e.g. "minecraft:stone") or null if unknown.
 * Lazily loads the palette on first call to avoid blocking startup.
 */
export function nameFor(runtimeId) {
  if (!loaded) loadPalette();
  return idToName.get(runtimeId) ?? null;
}

/**
 * Whether a palette has been successfully loaded.
 */
export function isLoaded() {
  return loaded;
}
