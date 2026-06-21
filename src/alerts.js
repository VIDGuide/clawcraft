/**
 * ClawCraft — Danger alert system
 *
 * Proactive threat detection emitting danger events for:
 *   - Hostile mobs within configurable distance
 *   - Low health
 *   - Low hunger
 *
 * Pure logic — takes current state and returns events to emit.
 * No I/O, fully testable.
 */

import { isHostile, resolveEntityType } from './entity-names.js';

const DEFAULT_CONFIG = {
  mobDistance: 8,
  lowHealth: 6,
  lowHunger: 4,
  debounceMs: 5000,
};

/**
 * Check current state for danger conditions.
 *
 * @param {object} tracker - entity tracker
 * @param {object} state - bot state (pos required)
 * @param {object} vitals - bot vitals (health, hunger)
 * @param {Map} lastAlerts - Map of alertKey → timestamp (for debounce)
 * @param {object} config - optional thresholds
 * @returns {{ events: Array, lastAlerts: Map }}
 */
export function checkDangerAlerts(tracker, state, vitals, lastAlerts, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const now = Date.now();
  const events = [];
  const nextAlerts = new Map(lastAlerts);

  function shouldFire(key) {
    const last = nextAlerts.get(key);
    if (last && now - last < cfg.debounceMs) return false;
    nextAlerts.set(key, now);
    return true;
  }

  // ── Hostile mob proximity ──────────────────────────────
  if (state.pos) {
    for (const [, mob] of tracker.mobs) {
      if (!mob.position) continue;
      if (!isHostile(mob.entityType)) continue;
      const dist = Math.sqrt(
        (state.pos.x - mob.position.x) ** 2 +
        (state.pos.y - mob.position.y) ** 2 +
        (state.pos.z - mob.position.z) ** 2,
      );
      if (dist <= cfg.mobDistance) {
        const key = `mob_${mob.runtimeId}`;
        if (shouldFire(key)) {
          const resolved = resolveEntityType(mob.entityType);
          events.push({
            type: 'danger',
            threat: resolved?.name || String(mob.entityType),
            entityType: mob.entityType,
            runtimeId: mob.runtimeId,
            distance: Math.round(dist * 10) / 10,
            pos: mob.position,
          });
        }
      }
    }
  }

  // ── Low health ─────────────────────────────────────────
  if (vitals && vitals.health !== undefined && vitals.health <= cfg.lowHealth && vitals.health > 0) {
    if (shouldFire('low_health')) {
      events.push({ type: 'danger', threat: 'low_health', health: vitals.health });
    }
  }

  // ── Low hunger ─────────────────────────────────────────
  if (vitals && vitals.hunger !== undefined && vitals.hunger <= cfg.lowHunger) {
    if (shouldFire('low_hunger')) {
      events.push({ type: 'danger', threat: 'low_hunger', hunger: vitals.hunger });
    }
  }

  return { events, lastAlerts: nextAlerts };
}
