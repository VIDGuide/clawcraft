/**
 * ClawMine — Player awareness
 *
 * Pure functions for:
 * - Server-wide player roster (join/leave from player_list packets)
 * - Render-distance appear/disappear events
 * - Proximity zone tracking with transition events
 *
 * No I/O — fully testable.
 */

const PLATFORMS = {
  0: 'unknown', 1: 'android', 2: 'ios', 3: 'osx', 4: 'fireos',
  5: 'gearvr', 6: 'hololens', 7: 'windows', 8: 'win32', 9: 'dedicated',
  10: 'tvos', 11: 'playstation', 12: 'nx', 13: 'xbox', 14: 'windowsphone',
  15: 'linux',
};

const ZONE_CLOSE = 8;
const ZONE_NEAR = 16;

function dist3d(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
}

function zoneFor(distance) {
  if (distance <= ZONE_CLOSE) return 'close';
  if (distance <= ZONE_NEAR) return 'near';
  return 'far';
}

// ── Roster (server-wide join/leave) ───────────────────────

export function createPlayerRoster() {
  return { players: new Map() };
}

export function processPlayerList(roster, pkt, botName) {
  if (!pkt || !pkt.records) return { roster, events: [] };

  const events = [];
  const next = { players: new Map(roster.players) };
  const type = pkt.records.type;

  if (type === 'add' && pkt.records.records) {
    for (const r of pkt.records.records) {
      if (r.username && r.username.toLowerCase() === (botName || '').toLowerCase()) continue;
      if (next.players.has(r.uuid)) continue;
      const platform = PLATFORMS[r.build_platform] || 'unknown';
      const entry = { name: r.username, uuid: r.uuid, platform, joinedAt: Date.now() };
      next.players.set(r.uuid, entry);
      events.push({ type: 'player_join', name: r.username, uuid: r.uuid, platform });
    }
  } else if (type === 'remove' && pkt.records.records) {
    for (const r of pkt.records.records) {
      const existing = next.players.get(r.uuid);
      if (!existing) continue;
      next.players.delete(r.uuid);
      events.push({ type: 'player_leave', name: existing.name, uuid: r.uuid });
    }
  }

  return { roster: next, events };
}

// ── Appear/Disappear (render distance) ───────────────────

export function processPlayerAppear(pkt) {
  if (!pkt || !pkt.username) return null;
  return {
    type: 'player_appear',
    name: pkt.username,
    uuid: pkt.uuid || null,
    position: pkt.position ? { x: pkt.position.x, y: pkt.position.y, z: pkt.position.z } : null,
  };
}

export function processPlayerDisappear(runtimeId, tracker) {
  const loc = tracker._ridIndex.get(runtimeId);
  if (!loc || loc.map !== 'players') return null;
  const entity = tracker.players.get(loc.key);
  if (!entity) return null;
  return { type: 'player_disappear', name: entity.name, uuid: entity.uuid || loc.key };
}

// ── Proximity tracking ───────────────────────────────────

export function createProximityTracker() {
  return { zones: new Map() };
}

export function checkProximity(proxTracker, playerPositions, botPos) {
  if (!botPos) return { tracker: proxTracker, events: [] };

  const events = [];
  const nextZones = new Map(proxTracker.zones);

  for (const { name, uuid, position } of playerPositions) {
    if (!position || !uuid) continue;
    const d = dist3d(position, botPos);
    const newZone = zoneFor(d);
    const oldZone = nextZones.get(uuid) || 'far';

    if (newZone !== oldZone) {
      nextZones.set(uuid, newZone);
      // Emit transition event
      if (newZone === 'far') {
        events.push({ type: 'player_left_nearby', name, uuid, zone: oldZone, distance: Math.round(d) });
      } else {
        events.push({ type: 'player_nearby', name, uuid, zone: newZone, distance: Math.round(d) });
      }
    }
  }

  return { tracker: { zones: nextZones }, events };
}

export function removeFromProximity(proxTracker, uuid) {
  if (!proxTracker.zones.has(uuid)) return proxTracker;
  const nextZones = new Map(proxTracker.zones);
  nextZones.delete(uuid);
  return { zones: nextZones };
}
