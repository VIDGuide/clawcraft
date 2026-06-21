/**
 * ClawCraft — Action helpers (Layer 5)
 *
 * Block hardness, tool speed, tool matching, item/block classification.
 * Pure logic, fully testable. No I/O.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ── Block data ────────────────────────────────────────────

let blockData = new Map();
try {
  const blocks = require('minecraft-data/minecraft-data/data/bedrock/1.21.80/blocks.json');
  for (const b of blocks) {
    blockData.set(b.name, { hardness: b.hardness, material: b.material || null, harvestTools: b.harvestTools || null });
  }
} catch { /* graceful fallback */ }

// ── Tool speed multipliers ────────────────────────────────

const TOOL_SPEEDS = { wooden: 2, stone: 4, iron: 6, diamond: 8, netherite: 9, golden: 12 };
const TOOL_TIER_RE = /^(wooden|stone|iron|diamond|netherite|golden)_/;
const TOOL_TYPE_RE = /_(pickaxe|axe|shovel|hoe|sword)$/;

// Material → tool type mapping
const MATERIAL_TOOL = {
  'mineable/pickaxe': 'pickaxe',
  'mineable/axe': 'axe',
  'mineable/shovel': 'shovel',
  'mineable/hoe': 'hoe',
};

// ── Break time calculation ────────────────────────────────

/**
 * Get break time in ticks for a block.
 * @param {string} blockName - e.g. 'stone' or 'minecraft:stone'
 * @param {{name?: string, displayName?: string}|null} heldItem - currently held item info
 * @returns {number} ticks to break (Infinity if unbreakable, minimum 1)
 */
export function getBreakTime(blockName, heldItem) {
  const name = blockName.replace(/^minecraft:/, '');
  const info = blockData.get(name);
  if (!info) return 20; // unknown block, default 1 second
  if (info.hardness < 0) return Infinity; // unbreakable (bedrock, etc.)
  if (info.hardness === 0) return 1; // instant break

  const toolType = info.material ? MATERIAL_TOOL[info.material] : null;
  const itemName = (heldItem?.displayName || heldItem?.name || '').replace(/^minecraft:/, '');
  const tierMatch = itemName.match(TOOL_TIER_RE);
  const typeMatch = itemName.match(TOOL_TYPE_RE);

  let speed = 1;
  if (toolType && typeMatch && typeMatch[1] === toolType && tierMatch) {
    speed = TOOL_SPEEDS[tierMatch[1]] || 1;
  }

  // Standard formula: damage_per_tick = speed / (hardness * 30) for correct tool
  // or speed / (hardness * 100) for wrong tool. Ticks = 1 / damage_per_tick.
  const canHarvest = !info.harvestTools || (heldItem && hasCorrectTool(info.harvestTools, itemName));
  const multiplier = canHarvest && speed > 1 ? 30 : 100;
  const ticks = Math.ceil((info.hardness * multiplier) / speed);
  return Math.max(1, ticks);
}

function hasCorrectTool(harvestTools, itemName) {
  // harvestTools is keyed by item runtime_id which we can't easily resolve here,
  // so fall back to material/type matching
  if (!itemName) return false;
  return TOOL_TYPE_RE.test(itemName);
}

// ── Tool matching ─────────────────────────────────────────

/**
 * Find the best tool in inventory for a given block.
 * @param {Array} slots - inventory slots array
 * @param {string} blockName - block name
 * @returns {number|null} slot index of best tool, or null
 */
export function findBestTool(slots, blockName) {
  const name = blockName.replace(/^minecraft:/, '');
  const info = blockData.get(name);
  if (!info || !info.material) return null;

  const neededType = MATERIAL_TOOL[info.material];
  if (!neededType) return null;

  let bestSlot = null;
  let bestSpeed = 0;

  for (let i = 0; i < slots.length; i++) {
    const item = slots[i];
    if (!item) continue;
    const itemName = (item.displayName || item.name || '').replace(/^minecraft:/, '');
    const typeMatch = itemName.match(TOOL_TYPE_RE);
    if (!typeMatch || typeMatch[1] !== neededType) continue;
    const tierMatch = itemName.match(TOOL_TIER_RE);
    const speed = tierMatch ? (TOOL_SPEEDS[tierMatch[1]] || 1) : 1;
    if (speed > bestSpeed) {
      bestSpeed = speed;
      bestSlot = i;
    }
  }
  return bestSlot;
}

// ── Classification helpers ────────────────────────────────

const INTERACTABLE_RE = /door|lever|button|trapdoor|gate|daylight_detector|repeater|comparator|noteblock|jukebox|bell|grindstone|stonecutter|loom|cartography|smithing|bed/;
const FOOD_RE = /apple|bread|beef|pork|chicken|mutton|rabbit|cod|salmon|tropical_fish|pufferfish|mushroom_stew|beetroot_soup|rabbit_stew|suspicious_stew|cookie|melon_slice|dried_kelp|baked_potato|potato|poisonous_potato|golden_apple|enchanted_golden_apple|golden_carrot|carrot|sweet_berries|glow_berries|honey_bottle|chorus_fruit|rotten_flesh|spider_eye|cake/;
const THROWABLE_RE = /^(egg|snowball|ender_pearl|experience_bottle|splash_potion|lingering_potion|trident)$/;

export function isInteractable(blockName) {
  const name = (blockName || '').replace(/^minecraft:/, '');
  return INTERACTABLE_RE.test(name);
}

export function isFood(itemName) {
  const name = (itemName || '').replace(/^minecraft:/, '');
  return FOOD_RE.test(name);
}

export function isThrowable(itemName) {
  const name = (itemName || '').replace(/^minecraft:/, '');
  return THROWABLE_RE.test(name);
}
