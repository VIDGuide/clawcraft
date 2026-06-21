import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createItemPalette, resolveItem, findItemByName } from '../src/items.js';
import {
  createInventory, parseItem, applyInventoryContent, applyInventorySlot,
  applyMobEquipment, applyMobArmor, applyArmorDamage,
  generateEvents, correlatePickup, getHeldItem, getSummary,
} from '../src/inventory.js';

// ── Test helpers ──────────────────────────────────────────

const mockItemstates = [
  { name: 'minecraft:diamond_pickaxe', runtime_id: 318 },
  { name: 'minecraft:stone', runtime_id: 1 },
  { name: 'minecraft:iron_sword', runtime_id: 307 },
  { name: 'minecraft:diamond_chestplate', runtime_id: 311 },
  { name: 'minecraft:air', runtime_id: 0 },
];

function palette() { return createItemPalette(mockItemstates); }

function rawItem(networkId, count = 1, metadata = 0, stackId = null) {
  return { network_id: networkId, count, metadata, has_stack_id: stackId ? 1 : 0, stack_id: stackId, block_runtime_id: 0, extra: {} };
}

// ── items.js tests ────────────────────────────────────────

describe('items.js', () => {
  it('createItemPalette builds a map from itemstates', () => {
    const p = palette();
    assert(p instanceof Map);
    assert(p.size >= 4); // excludes air (id=0) or includes it depending on implementation
    assert(p.get(318)?.displayName === 'diamond_pickaxe');
  });

  it('resolveItem returns null for id 0', () => {
    assert.strictEqual(resolveItem(palette(), 0), null);
  });

  it('resolveItem returns item info for valid id', () => {
    const item = resolveItem(palette(), 1);
    assert.strictEqual(item.displayName, 'stone');
    assert.strictEqual(item.name, 'minecraft:stone');
  });

  it('resolveItem returns null for unknown id', () => {
    assert.strictEqual(resolveItem(palette(), 99999), null);
  });

  it('findItemByName matches exact name', () => {
    const result = findItemByName(palette(), 'diamond_pickaxe');
    assert.strictEqual(result.networkId, 318);
  });

  it('findItemByName matches partial (substring)', () => {
    const result = findItemByName(palette(), 'pickaxe');
    assert.strictEqual(result.networkId, 318);
  });

  it('findItemByName is case-insensitive', () => {
    const result = findItemByName(palette(), 'DIAMOND_PICKAXE');
    assert.strictEqual(result.networkId, 318);
  });

  it('findItemByName strips minecraft: prefix', () => {
    const result = findItemByName(palette(), 'minecraft:stone');
    assert.strictEqual(result.networkId, 1);
  });

  it('findItemByName returns null for no match', () => {
    assert.strictEqual(findItemByName(palette(), 'nonexistent_item'), null);
  });
});

// ── inventory.js tests ────────────────────────────────────

describe('inventory.js — state', () => {
  it('createInventory returns correct initial structure', () => {
    const inv = createInventory();
    assert.strictEqual(inv.slots.length, 36);
    assert(inv.slots.every(s => s === null));
    assert.strictEqual(inv.armor.length, 4);
    assert.strictEqual(inv.offhand, null);
    assert.strictEqual(inv.heldSlot, 0);
  });

  it('parseItem returns null for empty/air', () => {
    assert.strictEqual(parseItem(null, palette()), null);
    assert.strictEqual(parseItem({ network_id: 0 }, palette()), null);
  });

  it('parseItem parses a valid item', () => {
    const item = parseItem(rawItem(318, 1, 5), palette());
    assert.strictEqual(item.networkId, 318);
    assert.strictEqual(item.name, 'diamond_pickaxe');
    assert.strictEqual(item.count, 1);
    assert.strictEqual(item.metadata, 5);
  });

  it('applyInventoryContent sets slots and returns changes', () => {
    const inv = createInventory();
    const items = [rawItem(1, 64), rawItem(318, 1)];
    const { inventory: newInv, changes } = applyInventoryContent(inv, 'inventory', items, palette());
    assert.strictEqual(newInv.slots[0].name, 'stone');
    assert.strictEqual(newInv.slots[0].count, 64);
    assert.strictEqual(newInv.slots[1].name, 'diamond_pickaxe');
    assert.strictEqual(changes.length, 2);
    assert.strictEqual(changes[0].oldItem, null);
    assert.strictEqual(changes[0].newItem.name, 'stone');
  });

  it('applyInventorySlot updates a single slot', () => {
    const inv = createInventory();
    const { inventory: newInv, change } = applyInventorySlot(inv, 'inventory', 5, rawItem(1, 32), palette());
    assert.strictEqual(newInv.slots[5].name, 'stone');
    assert.strictEqual(newInv.slots[5].count, 32);
    assert(change !== null);
    assert.strictEqual(change.slot, 5);
  });

  it('applyInventorySlot returns no change if same item', () => {
    const inv = createInventory();
    const { inventory: inv2 } = applyInventorySlot(inv, 'inventory', 0, rawItem(1, 32), palette());
    const { change } = applyInventorySlot(inv2, 'inventory', 0, rawItem(1, 32), palette());
    assert.strictEqual(change, null);
  });

  it('applyMobEquipment changes held slot', () => {
    const inv = createInventory();
    const { inventory: newInv, change } = applyMobEquipment(inv, 3);
    assert.strictEqual(newInv.heldSlot, 3);
    assert.strictEqual(change.oldSlot, 0);
    assert.strictEqual(change.newSlot, 3);
  });

  it('applyMobEquipment returns no change for same slot', () => {
    const inv = createInventory();
    const { change } = applyMobEquipment(inv, 0);
    assert.strictEqual(change, null);
  });

  it('applyMobArmor sets armor slots', () => {
    const p = palette();
    const inv = createInventory();
    const { inventory: newInv, changes } = applyMobArmor(inv, rawItem(311), null, null, null, p);
    assert.strictEqual(newInv.armor[0].name, 'diamond_chestplate');
    assert.strictEqual(changes.length, 1);
  });

  it('applyArmorDamage decrements durability', () => {
    const p = palette();
    const inv = createInventory();
    // Manually set armor with durability
    const armorItem = { networkId: 311, name: 'diamond_chestplate', count: 1, metadata: 0, durability: 528, maxDurability: 528, stackId: null };
    const invWithArmor = { ...inv, armor: [armorItem, null, null, null] };
    const { inventory: newInv, changes } = applyArmorDamage(invWithArmor, { helmet: 3 });
    assert.strictEqual(newInv.armor[0].durability, 525);
    assert.strictEqual(changes.length, 1);
  });

  it('getHeldItem returns current held item', () => {
    const inv = createInventory();
    const { inventory: newInv } = applyInventorySlot(inv, 'inventory', 0, rawItem(318, 1), palette());
    const held = getHeldItem(newInv);
    assert.strictEqual(held.name, 'diamond_pickaxe');
  });

  it('getSummary reports occupied count and item list', () => {
    const inv = createInventory();
    const items = [rawItem(1, 64), rawItem(1, 32), rawItem(318, 1)];
    const { inventory: newInv } = applyInventoryContent(inv, 'inventory', items, palette());
    const summary = getSummary(newInv);
    assert.strictEqual(summary.occupied, 3);
    assert.strictEqual(summary.total, 36);
    assert.strictEqual(summary.items.length, 2); // stone + diamond_pickaxe
    assert.strictEqual(summary.items[0].name, 'stone');
    assert.strictEqual(summary.items[0].totalCount, 96);
  });
});

// ── Event generation tests ────────────────────────────────

describe('inventory.js — events', () => {
  it('generates item_added for new item in empty slot', () => {
    const changes = [{ slot: 0, windowId: 'inventory', oldItem: null, newItem: { networkId: 1, name: 'stone', count: 64 } }];
    const events = generateEvents(changes);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'item_added');
    assert.strictEqual(events[0].item.name, 'stone');
  });

  it('generates item_removed for item disappearing', () => {
    const changes = [{ slot: 0, windowId: 'inventory', oldItem: { networkId: 1, name: 'stone', count: 64, maxDurability: null, durability: null }, newItem: null }];
    const events = generateEvents(changes);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'item_removed');
  });

  it('generates tool_broken when durable item with durability <= 1 disappears', () => {
    const changes = [{ slot: 0, windowId: 'inventory', oldItem: { networkId: 318, name: 'diamond_pickaxe', count: 1, maxDurability: 1561, durability: 1 }, newItem: null }];
    const events = generateEvents(changes);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'tool_broken');
    assert.strictEqual(events[0].item.name, 'diamond_pickaxe');
  });

  it('generates item_count_changed for same item count change', () => {
    const changes = [{ slot: 0, windowId: 'inventory', oldItem: { networkId: 1, name: 'stone', count: 32, metadata: 0 }, newItem: { networkId: 1, name: 'stone', count: 64, metadata: 0 } }];
    const events = generateEvents(changes);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].type, 'item_count_changed');
    assert.strictEqual(events[0].oldCount, 32);
    assert.strictEqual(events[0].newCount, 64);
  });

  it('generates item_damaged for durability decrease', () => {
    const changes = [{
      slot: 0, windowId: 'inventory',
      oldItem: { networkId: 318, name: 'diamond_pickaxe', count: 1, metadata: 0, durability: 100, maxDurability: 1561 },
      newItem: { networkId: 318, name: 'diamond_pickaxe', count: 1, metadata: 1, durability: 99, maxDurability: 1561 },
    }];
    const events = generateEvents(changes);
    assert(events.some(e => e.type === 'item_damaged'));
    const dmgEvt = events.find(e => e.type === 'item_damaged');
    assert.strictEqual(dmgEvt.previousDurability, 100);
    assert.strictEqual(dmgEvt.durability, 99);
  });

  it('correlatePickup enriches item_added with nearby entity removal', () => {
    const events = [{ type: 'item_added', item: { networkId: 1, name: 'stone', count: 1 }, slot: 0, windowId: 'inventory' }];
    const recentRemovals = [{ networkId: 1, position: { x: 10, y: 64, z: 10 }, timestamp: Date.now() - 500 }];
    const botPos = { x: 10, y: 64, z: 12 };
    const enriched = correlatePickup(events, recentRemovals, botPos);
    assert.strictEqual(enriched[0].source, 'pickup');
    assert.deepStrictEqual(enriched[0].entityPosition, { x: 10, y: 64, z: 10 });
  });

  it('correlatePickup does not match if too far', () => {
    const events = [{ type: 'item_added', item: { networkId: 1, name: 'stone', count: 1 }, slot: 0, windowId: 'inventory' }];
    const recentRemovals = [{ networkId: 1, position: { x: 100, y: 64, z: 100 }, timestamp: Date.now() - 500 }];
    const botPos = { x: 10, y: 64, z: 10 };
    const enriched = correlatePickup(events, recentRemovals, botPos);
    assert.strictEqual(enriched[0].source, undefined);
  });

  it('correlatePickup does not match if too old', () => {
    const events = [{ type: 'item_added', item: { networkId: 1, name: 'stone', count: 1 }, slot: 0, windowId: 'inventory' }];
    const recentRemovals = [{ networkId: 1, position: { x: 10, y: 64, z: 10 }, timestamp: Date.now() - 5000 }];
    const botPos = { x: 10, y: 64, z: 10 };
    const enriched = correlatePickup(events, recentRemovals, botPos);
    assert.strictEqual(enriched[0].source, undefined);
  });
});
