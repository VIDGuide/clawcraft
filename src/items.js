/**
 * ClawCraft — Item palette resolution
 *
 * Maps item network_id → human-readable names and durability metadata.
 * Built from the server's itemstates (start_game or item_registry packet).
 * No I/O, fully testable.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load maxDurability data from minecraft-data
let durabilityMap = new Map();
try {
  const items = require('minecraft-data/minecraft-data/data/bedrock/1.21.80/items.json');
  for (const item of items) {
    if (item.maxDurability) durabilityMap.set(item.name, item.maxDurability);
  }
} catch { /* graceful fallback — durability just won't be enriched */ }

/**
 * Create an item palette from server itemstates.
 * @param {Array<{name: string, runtime_id: number}>} itemstates
 * @returns {Map<number, {name: string, displayName: string, maxDurability: number|null}>}
 */
export function createItemPalette(itemstates) {
  const palette = new Map();
  if (!itemstates) return palette;
  for (const state of itemstates) {
    const name = state.name || '';
    const displayName = name.replace(/^minecraft:/, '');
    const maxDurability = durabilityMap.get(displayName) || null;
    palette.set(state.runtime_id, { name, displayName, maxDurability });
  }
  return palette;
}

/**
 * Resolve an item network_id to its info.
 * @returns {{name, displayName, maxDurability}|null}
 */
export function resolveItem(palette, networkId) {
  if (!networkId || networkId === 0) return null;
  return palette.get(networkId) || null;
}

/**
 * Find an item by name (case-insensitive substring match).
 * @returns {{networkId, name, displayName, maxDurability}|null}
 */
export function findItemByName(palette, query) {
  if (!query) return null;
  const q = query.toLowerCase().replace(/^minecraft:/, '');
  // Exact match first
  for (const [networkId, info] of palette) {
    if (info.displayName === q) return { networkId, ...info };
  }
  // Substring match
  for (const [networkId, info] of palette) {
    if (info.displayName.includes(q)) return { networkId, ...info };
  }
  return null;
}
