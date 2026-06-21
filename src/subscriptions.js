/**
 * ClawCraft — Event subscriptions
 *
 * Manages opt-in event types that the LLM can subscribe/unsubscribe to.
 * Existing always-on events are unaffected by this system.
 *
 * Pure module — no I/O, fully testable.
 */

/** Available subscribable event types with their defaults and descriptions. */
export const SUBSCRIBABLE_EVENTS = {
  block_changed: {
    description: 'Nearby block state changes (doors, levers, blocks placed/broken by others)',
    hasRadius: true,
    defaultRadius: 16,
  },
  weather: {
    description: 'Weather changes (rain/thunder start/stop)',
    hasRadius: false,
  },
  time: {
    description: 'Game time changes (throttled to major transitions: dawn, noon, dusk, midnight)',
    hasRadius: false,
  },
};

/**
 * Create initial subscription state (all opt-in events disabled).
 */
export function createSubscriptions() {
  return new Map();
}

/**
 * Subscribe to an event type. Returns new state + result.
 */
export function subscribe(state, eventType, opts = {}) {
  const def = SUBSCRIBABLE_EVENTS[eventType];
  if (!def) return { state, error: `Unknown event type: ${eventType}. Available: ${Object.keys(SUBSCRIBABLE_EVENTS).join(', ')}` };
  const entry = { enabled: true };
  if (def.hasRadius) entry.radius = opts.radius ?? def.defaultRadius;
  const next = new Map(state);
  next.set(eventType, entry);
  return { state: next, subscribed: eventType, ...entry };
}

/**
 * Unsubscribe from an event type. Returns new state + result.
 */
export function unsubscribe(state, eventType) {
  if (!SUBSCRIBABLE_EVENTS[eventType]) return { state, error: `Unknown event type: ${eventType}. Available: ${Object.keys(SUBSCRIBABLE_EVENTS).join(', ')}` };
  if (!state.has(eventType)) return { state, error: `Not subscribed to ${eventType}` };
  const next = new Map(state);
  next.delete(eventType);
  return { state: next, unsubscribed: eventType };
}

/**
 * Check if an event should be emitted based on current subscriptions.
 * @param {Map} state - subscription state
 * @param {string} eventType - the event type to check
 * @param {object} opts - optional context: { distance } for radius-based filtering
 */
export function shouldEmit(state, eventType, opts = {}) {
  const entry = state.get(eventType);
  if (!entry || !entry.enabled) return false;
  if (entry.radius !== undefined && opts.distance !== undefined) {
    return opts.distance <= entry.radius;
  }
  return true;
}

/**
 * List current subscriptions and available types.
 */
export function listSubscriptions(state) {
  const active = [];
  for (const [type, entry] of state) {
    active.push({ event: type, ...entry });
  }
  const available = Object.entries(SUBSCRIBABLE_EVENTS).map(([event, def]) => ({
    event,
    description: def.description,
    hasRadius: def.hasRadius,
    defaultRadius: def.defaultRadius ?? null,
    subscribed: state.has(event),
  }));
  return { active, available };
}
