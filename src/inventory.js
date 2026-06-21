/**
 * ClawCraft — Inventory state management
 *
 * Pure state tracking for inventory slots, armor, offhand, and held item.
 * Computes diffs on updates and generates semantic events.
 * No I/O, fully testable.
 */

import { resolveItem } from './items.js';

// ── State creation ────────────────────────────────────────

export function createInventory() {
  return {
    slots: new Array(36).fill(null),  // 0-8 hotbar, 9-35 main inventory
    armor: [null, null, null, null],  // helmet, chestplate, leggings, boots
    offhand: null,
    heldSlot: 0,
  };
}

// ── Item parsing ──────────────────────────────────────────

export function parseItem(raw, palette) {
  if (!raw || raw.network_id === 0) return null;
  const info = resolveItem(palette, raw.network_id);
  const maxDurability = info?.maxDurability || null;
  // metadata is used damage for tools (damage = metadata, remaining = max - damage)
  const durability = maxDurability ? maxDurability - (raw.metadata || 0) : null;
  return {
    networkId: raw.network_id,
    name: info?.displayName || `unknown_${raw.network_id}`,
    count: raw.count || 1,
    metadata: raw.metadata || 0,
    durability,
    maxDurability,
    stackId: raw.stack_id || null,
  };
}

// ── State updates ─────────────────────────────────────────

export function applyInventoryContent(inventory, windowId, items, palette) {
  const changes = [];
  const parsed = (items || []).map(i => parseItem(i, palette));

  if (windowId === 'inventory' || windowId === 0) {
    const newSlots = [...inventory.slots];
    const len = Math.min(parsed.length, 36);
    for (let i = 0; i < len; i++) {
      const oldItem = newSlots[i];
      const newItem = parsed[i];
      if (!itemEqual(oldItem, newItem)) {
        changes.push({ slot: i, windowId: 'inventory', oldItem, newItem });
      }
      newSlots[i] = newItem;
    }
    return { inventory: { ...inventory, slots: newSlots }, changes };
  }

  if (windowId === 'armor' || windowId === 120) {
    const newArmor = [...inventory.armor];
    const len = Math.min(parsed.length, 4);
    for (let i = 0; i < len; i++) {
      const oldItem = newArmor[i];
      const newItem = parsed[i];
      if (!itemEqual(oldItem, newItem)) {
        changes.push({ slot: i, windowId: 'armor', oldItem, newItem });
      }
      newArmor[i] = newItem;
    }
    return { inventory: { ...inventory, armor: newArmor }, changes };
  }

  if (windowId === 'offhand' || windowId === 119) {
    const oldItem = inventory.offhand;
    const newItem = parsed[0] || null;
    if (!itemEqual(oldItem, newItem)) {
      changes.push({ slot: 0, windowId: 'offhand', oldItem, newItem });
    }
    return { inventory: { ...inventory, offhand: newItem }, changes };
  }

  return { inventory, changes };
}

export function applyInventorySlot(inventory, windowId, slotIndex, rawItem, palette) {
  const newItem = parseItem(rawItem, palette);

  if (windowId === 'inventory' || windowId === 0) {
    if (slotIndex < 0 || slotIndex >= 36) return { inventory, change: null };
    const oldItem = inventory.slots[slotIndex];
    if (itemEqual(oldItem, newItem)) return { inventory, change: null };
    const newSlots = [...inventory.slots];
    newSlots[slotIndex] = newItem;
    const change = { slot: slotIndex, windowId: 'inventory', oldItem, newItem };
    return { inventory: { ...inventory, slots: newSlots }, change };
  }

  if (windowId === 'armor' || windowId === 120) {
    if (slotIndex < 0 || slotIndex >= 4) return { inventory, change: null };
    const oldItem = inventory.armor[slotIndex];
    if (itemEqual(oldItem, newItem)) return { inventory, change: null };
    const newArmor = [...inventory.armor];
    newArmor[slotIndex] = newItem;
    const change = { slot: slotIndex, windowId: 'armor', oldItem, newItem };
    return { inventory: { ...inventory, armor: newArmor }, change };
  }

  if (windowId === 'offhand' || windowId === 119) {
    const oldItem = inventory.offhand;
    if (itemEqual(oldItem, newItem)) return { inventory, change: null };
    const change = { slot: 0, windowId: 'offhand', oldItem, newItem };
    return { inventory: { ...inventory, offhand: newItem }, change };
  }

  return { inventory, change: null };
}

export function applyMobEquipment(inventory, selectedSlot) {
  if (selectedSlot < 0 || selectedSlot > 8) return { inventory, change: null };
  if (inventory.heldSlot === selectedSlot) return { inventory, change: null };
  const oldSlot = inventory.heldSlot;
  return {
    inventory: { ...inventory, heldSlot: selectedSlot },
    change: { type: 'held_slot_changed', oldSlot, newSlot: selectedSlot },
  };
}

export function applyMobArmor(inventory, helmet, chestplate, leggings, boots, palette) {
  const pieces = [helmet, chestplate, leggings, boots].map(r => parseItem(r, palette));
  const changes = [];
  const newArmor = [...inventory.armor];
  for (let i = 0; i < 4; i++) {
    if (!itemEqual(newArmor[i], pieces[i])) {
      changes.push({ slot: i, windowId: 'armor', oldItem: newArmor[i], newItem: pieces[i] });
      newArmor[i] = pieces[i];
    }
  }
  return { inventory: { ...inventory, armor: newArmor }, changes };
}

export function applyArmorDamage(inventory, damages) {
  // damages: {helmet, chestplate, leggings, boots} — damage amounts to apply
  const changes = [];
  const newArmor = [...inventory.armor];
  const keys = ['helmet', 'chestplate', 'leggings', 'boots'];
  for (let i = 0; i < 4; i++) {
    const dmg = damages[keys[i]];
    if (!dmg || !newArmor[i] || !newArmor[i].durability) continue;
    const oldDurability = newArmor[i].durability;
    const newDurability = Math.max(0, oldDurability - dmg);
    newArmor[i] = { ...newArmor[i], durability: newDurability, metadata: (newArmor[i].maxDurability || 0) - newDurability };
    changes.push({ slot: i, windowId: 'armor', oldItem: { ...newArmor[i], durability: oldDurability }, newItem: newArmor[i] });
  }
  return { inventory: { ...inventory, armor: newArmor }, changes };
}

// ── Event generation ──────────────────────────────────────

export function generateEvents(changes) {
  const events = [];
  for (const ch of changes) {
    if (!ch) continue;
    const { oldItem, newItem, slot, windowId } = ch;

    if (!oldItem && newItem) {
      events.push({ type: 'item_added', item: newItem, slot, windowId });
    } else if (oldItem && !newItem) {
      // Tool broken if it had durability and was at 1 or less
      if (oldItem.maxDurability && oldItem.durability !== null && oldItem.durability <= 1) {
        events.push({ type: 'tool_broken', item: oldItem, slot, windowId });
      } else {
        events.push({ type: 'item_removed', item: oldItem, slot, windowId });
      }
    } else if (oldItem && newItem) {
      if (oldItem.networkId === newItem.networkId) {
        if (oldItem.count !== newItem.count) {
          events.push({ type: 'item_count_changed', item: newItem, slot, windowId, oldCount: oldItem.count, newCount: newItem.count });
        }
        if (oldItem.durability !== null && newItem.durability !== null && newItem.durability < oldItem.durability) {
          events.push({ type: 'item_damaged', item: newItem, slot, windowId, previousDurability: oldItem.durability, durability: newItem.durability });
        }
      } else {
        // Different item replaced
        events.push({ type: 'item_removed', item: oldItem, slot, windowId });
        events.push({ type: 'item_added', item: newItem, slot, windowId });
      }
    }
  }
  return events;
}

/**
 * Correlate item_added events with recently removed item entities.
 * Enriches matching events with pickup source info.
 */
export function correlatePickup(events, recentItemEntities, botPos, now = Date.now()) {
  if (!recentItemEntities || !recentItemEntities.length || !botPos) return events;
  return events.map(ev => {
    if (ev.type !== 'item_added') return ev;
    const match = recentItemEntities.find(e =>
      e.networkId === ev.item.networkId &&
      (now - e.timestamp) < 2000 &&
      dist(e.position, botPos) < 5
    );
    if (match) return { ...ev, source: 'pickup', entityPosition: match.position };
    return ev;
  });
}

// ── Query helpers ─────────────────────────────────────────

export function getHeldItem(inventory) {
  return inventory.slots[inventory.heldSlot] || null;
}

export function getSummary(inventory) {
  const occupied = inventory.slots.filter(s => s !== null).length;
  const itemCounts = new Map();
  for (const s of inventory.slots) {
    if (!s) continue;
    const existing = itemCounts.get(s.name) || 0;
    itemCounts.set(s.name, existing + s.count);
  }
  const items = [];
  for (const [name, count] of itemCounts) items.push({ name, totalCount: count });
  items.sort((a, b) => b.totalCount - a.totalCount);
  return { occupied, total: 36, items };
}

// ── Helpers ───────────────────────────────────────────────

function itemEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.networkId === b.networkId && a.count === b.count && a.metadata === b.metadata && a.stackId === b.stackId;
}

function dist(a, b) {
  if (!a || !b) return Infinity;
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}
