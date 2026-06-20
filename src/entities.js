/**
 * ClawMine — Entity tracking
 *
 * Pure functions for tracking players, mobs, and items.
 * No I/O — fully testable.
 */

export function createEntityTracker() {
  return {
    /** @type {Map<number, Entity>} */
    players: new Map(),
    /** @type {Map<number, Entity>} */
    mobs: new Map(),
    /** @type {Map<number, Entity>} */
    items: new Map(),
    /** @type {Map<number, string>} */ // runtime_id → username
    playerNames: new Map(),
    /** @type {Map<number, {map: string, key: *}>} */ // runtimeId → location in tracker
    _ridIndex: new Map(),
  };
}

/**
 * Process an add_player packet and return updated tracker.
 */
export function handleAddPlayer(tracker, pkt) {
  const id = pkt.uuid;
  const e = {
    runtimeId: pkt.runtime_id,
    uuid: pkt.uuid,
    position: pkt.position ? { x: pkt.position.x, y: pkt.position.y, z: pkt.position.z } : null,
    name: pkt.username || 'unknown',
    type: 'player',
    metadata: pkt.metadata || {},
    seenAt: Date.now(),
  };

  const next = { ...tracker };
  next.players = new Map(tracker.players);
  next.players.set(id, e);
  next.playerNames = new Map(tracker.playerNames);
  next.playerNames.set(pkt.runtime_id, pkt.username);
  next._ridIndex = new Map(tracker._ridIndex);
  next._ridIndex.set(pkt.runtime_id, { map: 'players', key: id });
  return next;
}

/**
 * Process an add_entity (mob/vehicle) packet.
 */
export function handleAddEntity(tracker, pkt) {
  const e = {
    runtimeId: pkt.runtime_id,
    entityType: pkt.entity_type,
    position: pkt.position ? { x: pkt.position.x, y: pkt.position.y, z: pkt.position.z } : null,
    velocity: pkt.velocity || null,
    type: 'mob',
    metadata: pkt.metadata || {},
    seenAt: Date.now(),
  };

  const next = { ...tracker };
  next.mobs = new Map(tracker.mobs);
  next.mobs.set(pkt.runtime_id, e);
  next._ridIndex = new Map(tracker._ridIndex);
  next._ridIndex.set(pkt.runtime_id, { map: 'mobs', key: pkt.runtime_id });
  return next;
}

/**
 * Process an add_item_entity (dropped item) packet.
 */
export function handleAddItemEntity(tracker, pkt) {
  const e = {
    runtimeId: pkt.runtime_id,
    item: pkt.item || {},
    position: pkt.position ? { x: pkt.position.x, y: pkt.position.y, z: pkt.position.z } : null,
    type: 'item',
    seenAt: Date.now(),
  };

  const next = { ...tracker };
  next.items = new Map(tracker.items);
  next.items.set(pkt.runtime_id, e);
  next._ridIndex = new Map(tracker._ridIndex);
  next._ridIndex.set(pkt.runtime_id, { map: 'items', key: pkt.runtime_id });
  return next;
}

/**
 * Process a move_entity packet (position update).
 * Uses runtimeId index for O(1) lookup.
 */
export function handleMoveEntity(tracker, pkt) {
  const rid = pkt.runtime_id;
  const pos = pkt.position ? { x: pkt.position.x, y: pkt.position.y, z: pkt.position.z } : null;

  const loc = tracker._ridIndex.get(rid);
  if (!loc) return tracker;

  const entity = tracker[loc.map].get(loc.key);
  if (!entity) return tracker;

  const next = { ...tracker };
  next[loc.map] = new Map(tracker[loc.map]);
  next[loc.map].set(loc.key, { ...entity, position: pos ?? entity.position });
  return next;
}

/**
 * Process a remove_entity packet by runtime_id.
 */
export function handleRemoveEntity(tracker, rid) {
  const loc = tracker._ridIndex.get(rid);
  if (!loc) return tracker;

  const next = { ...tracker };
  next[loc.map] = new Map(tracker[loc.map]);
  next[loc.map].delete(loc.key);
  next._ridIndex = new Map(tracker._ridIndex);
  next._ridIndex.delete(rid);
  return next;
}

/**
 * Process a player_list packet to get online player names.
 */
export function handlePlayerList(tracker, pkt) {
  const next = { ...tracker, playerNames: new Map(tracker.playerNames) };

  if (pkt.entries) {
    for (const entry of pkt.entries) {
      if (entry.name) {
        next.playerNames.set(entry.runtime_entity_id || entry.id, entry.name);
      }
    }
  }

  return next;
}

/**
 * Get a summary of nearby entities.
 */
export function nearbyEntities(tracker, center, radius = 32) {
  const nearby = { players: [], mobs: [], items: [] };

  for (const [id, e] of tracker.players) {
    if (e.position && distance(e.position, center) <= radius) {
      nearby.players.push({ name: e.name, position: e.position, id });
    }
  }

  for (const [id, e] of tracker.mobs) {
    if (e.position && distance(e.position, center) <= radius) {
      nearby.mobs.push({ type: e.entityType, position: e.position, id });
    }
  }

  for (const [id, e] of tracker.items) {
    if (e.position && distance(e.position, center) <= radius) {
      nearby.items.push({ item: e.item, position: e.position, id });
    }
  }

  return nearby;
}

function distance(a, b) {
  return Math.sqrt(
    (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2,
  );
}
