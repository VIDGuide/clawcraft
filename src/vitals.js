/**
 * ClawCraft — Vitals & Status Effects
 *
 * Pure state management for health, hunger, breath, absorption, and active effects.
 * Includes causal grouping to coalesce simultaneous changes into single events.
 * No I/O — fully testable.
 */

// ── Attribute name mapping ────────────────────────────────

const ATTR_MAP = {
  'minecraft:health': 'health',
  'minecraft:player.hunger': 'hunger',
  'minecraft:player.saturation': 'saturation',
  'minecraft:player.exhaustion': 'exhaustion',
  'minecraft:player.level': 'level',
  'minecraft:player.experience': 'experience',
  'minecraft:absorption': 'absorption',
  'minecraft:movement': 'movementSpeed',
  'minecraft:underwater_movement': 'breath',
  'minecraft:luck': 'luck',
};

// ── Effect ID → name lookup ───────────────────────────────

const EFFECT_NAMES = {
  1: 'speed', 2: 'slowness', 3: 'haste', 4: 'mining_fatigue',
  5: 'strength', 6: 'instant_health', 7: 'instant_damage', 8: 'jump_boost',
  9: 'nausea', 10: 'regeneration', 11: 'resistance', 12: 'fire_resistance',
  13: 'water_breathing', 14: 'invisibility', 15: 'blindness', 16: 'night_vision',
  17: 'hunger', 18: 'weakness', 19: 'poison', 20: 'wither',
  21: 'health_boost', 22: 'absorption', 23: 'saturation', 24: 'levitation',
  25: 'fatal_poison', 26: 'conduit_power', 27: 'slow_falling', 28: 'bad_omen',
  29: 'village_hero', 30: 'darkness', 31: 'trial_omen', 32: 'wind_charged',
  33: 'weaving', 34: 'oozing', 35: 'infested',
};

export function getEffectName(id) {
  return EFFECT_NAMES[id] || `unknown_${id}`;
}

// ── State creation ────────────────────────────────────────

export function createVitals() {
  return {
    health: 20, maxHealth: 20,
    hunger: 20, maxHunger: 20,
    saturation: 5, maxSaturation: 20,
    absorption: 0, maxAbsorption: 16,
    breath: 0, // underwater_movement attribute
    level: 0, experience: 0,
    movementSpeed: 0.1,
    alive: true,
    effects: [], // [{id, name, amplifier, duration, particles, startedAt}]
  };
}

// ── Attribute updates ─────────────────────────────────────

export function applyAttributes(vitals, attributes) {
  if (!attributes || !attributes.length) return { vitals, changes: [] };
  const changes = [];
  let next = { ...vitals };

  for (const attr of attributes) {
    const field = ATTR_MAP[attr.name];
    if (!field) continue;
    const old = next[field];
    const val = attr.current;
    if (val === old) continue;

    changes.push({ attr: field, old, new: val, min: attr.min, max: attr.max });
    next = { ...next, [field]: val };

    // Track max values
    if (field === 'health') next.maxHealth = attr.max;
    else if (field === 'hunger') next.maxHunger = attr.max;
    else if (field === 'saturation') next.maxSaturation = attr.max;
    else if (field === 'absorption') next.maxAbsorption = attr.max;
  }

  return { vitals: next, changes };
}

// ── Status effects ────────────────────────────────────────

export function applyEffect(vitals, pkt, now = Date.now()) {
  const { eventId, effectId, amplifier, duration, particles } = pkt;
  const name = getEffectName(effectId);

  if (eventId === 'add' || eventId === 1) {
    const effects = vitals.effects.filter(e => e.id !== effectId);
    effects.push({ id: effectId, name, amplifier, duration, particles, startedAt: now });
    return {
      vitals: { ...vitals, effects },
      event: { type: 'effect_added', effect: name, effectId, amplifier, duration },
    };
  }

  if (eventId === 'update' || eventId === 2) {
    const effects = vitals.effects.map(e =>
      e.id === effectId ? { ...e, amplifier, duration, particles } : e
    );
    return {
      vitals: { ...vitals, effects },
      event: { type: 'effect_updated', effect: name, effectId, amplifier, duration },
    };
  }

  if (eventId === 'remove' || eventId === 3) {
    const effects = vitals.effects.filter(e => e.id !== effectId);
    return {
      vitals: { ...vitals, effects },
      event: { type: 'effect_removed', effect: name, effectId },
    };
  }

  return { vitals, event: null };
}

// ── Death & Respawn ───────────────────────────────────────

export function applyDeath(vitals, cause, messages) {
  return {
    vitals: { ...vitals, alive: false, health: 0 },
    event: { type: 'death', cause: cause || 'unknown', messages: messages || [] },
  };
}

export function applyRespawn(vitals) {
  return {
    vitals: {
      ...vitals,
      alive: true,
      health: vitals.maxHealth,
      hunger: vitals.maxHunger,
      saturation: 5,
      absorption: 0,
      effects: [],
    },
    event: { type: 'respawn' },
  };
}

// ── Causal Grouping Buffer ────────────────────────────────

export function createBuffer() {
  return { changes: [], hurt: false, cause: null, deathInfo: null, startTime: 0 };
}

export function bufferChanges(buffer, changes, now = Date.now()) {
  const next = { ...buffer, changes: [...buffer.changes, ...changes] };
  if (!next.startTime) next.startTime = now;
  return next;
}

export function setHurt(buffer, cause) {
  return { ...buffer, hurt: true, cause: cause || 'attack' };
}

export function setDeathInfo(buffer, cause, messages) {
  return { ...buffer, deathInfo: { cause, messages } };
}

/**
 * Flush the buffer into a single coalesced event (or null if no meaningful change).
 * Returns the event to emit.
 */
export function flushBuffer(buffer) {
  if (!buffer.changes.length) return null;

  const healthChange = buffer.changes.find(c => c.attr === 'health');
  const hungerChange = buffer.changes.find(c => c.attr === 'hunger');
  const absorptionChange = buffer.changes.find(c => c.attr === 'absorption');

  // Health decreased → damage_taken
  if (healthChange && healthChange.new < healthChange.old) {
    const cause = inferCause(buffer);
    const event = {
      type: 'damage_taken',
      cause,
      health: { old: healthChange.old, new: healthChange.new, max: healthChange.max },
    };
    if (absorptionChange) event.absorption = { old: absorptionChange.old, new: absorptionChange.new };
    if (hungerChange) event.hunger = { old: hungerChange.old, new: hungerChange.new };
    return event;
  }

  // Health increased → health_restored
  if (healthChange && healthChange.new > healthChange.old) {
    const cause = inferRestoreCause(buffer);
    return {
      type: 'health_restored',
      cause,
      health: { old: healthChange.old, new: healthChange.new, max: healthChange.max },
    };
  }

  // Hunger decreased (no health change) → hunger_depleted
  if (hungerChange && hungerChange.new < hungerChange.old && !healthChange) {
    return {
      type: 'hunger_changed',
      hunger: { old: hungerChange.old, new: hungerChange.new, max: hungerChange.max },
    };
  }

  // Other attribute changes (movement speed, level, etc.) — emit generic
  return {
    type: 'vitals_changed',
    changes: buffer.changes.map(c => ({ attr: c.attr, old: c.old, new: c.new })),
  };
}

function inferCause(buffer) {
  if (buffer.cause) return buffer.cause;
  if (buffer.hurt) return 'attack';
  // Check if only hunger-related (exhaustion damage)
  const hungerChange = buffer.changes.find(c => c.attr === 'hunger');
  if (hungerChange && hungerChange.new <= 0) return 'starvation';
  return 'unknown';
}

function inferRestoreCause(buffer) {
  if (buffer.cause) return buffer.cause;
  const satChange = buffer.changes.find(c => c.attr === 'saturation');
  if (satChange && satChange.new < satChange.old) return 'natural_regeneration';
  return 'regeneration';
}

// ── Query helpers ─────────────────────────────────────────

export function getVitalsSummary(vitals) {
  return {
    health: vitals.health,
    maxHealth: vitals.maxHealth,
    hunger: vitals.hunger,
    alive: vitals.alive,
    effectCount: vitals.effects.length,
  };
}

export function getVitalsSnapshot(vitals, now = Date.now()) {
  return {
    health: vitals.health,
    maxHealth: vitals.maxHealth,
    hunger: vitals.hunger,
    saturation: vitals.saturation,
    absorption: vitals.absorption,
    breath: vitals.breath,
    level: vitals.level,
    alive: vitals.alive,
    effects: vitals.effects.map(e => ({
      id: e.id, name: e.name, amplifier: e.amplifier,
      duration: e.duration, remaining: Math.max(0, e.duration - Math.floor((now - e.startedAt) / 50)),
    })),
  };
}
