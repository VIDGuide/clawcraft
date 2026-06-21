import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkDangerAlerts } from '../src/alerts.js';
import { createEntityTracker, handleAddEntity } from '../src/entities.js';
import { createVitals } from '../src/vitals.js';

function makeTracker(mobs = []) {
  let t = createEntityTracker();
  for (const m of mobs) t = handleAddEntity(t, m);
  return t;
}

const CENTER = { x: 0, y: 64, z: 0 };
const STATE = { pos: CENTER };
const GOOD_VITALS = { health: 20, hunger: 20 };

describe('alerts', () => {
  it('no alerts when all clear', () => {
    const tracker = makeTracker();
    const { events } = checkDangerAlerts(tracker, STATE, GOOD_VITALS, new Map());
    assert.equal(events.length, 0);
  });

  it('fires danger for hostile mob within distance', () => {
    const tracker = makeTracker([{
      runtime_id: 1,
      entity_type: 32, // zombie (hostile)
      position: { x: 5, y: 64, z: 0 }, // 5 blocks away
    }]);
    const { events } = checkDangerAlerts(tracker, STATE, GOOD_VITALS, new Map(), { mobDistance: 8 });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'danger');
    assert.equal(events[0].threat, 'zombie');
    assert.ok(events[0].distance <= 8);
  });

  it('does NOT fire for passive mob nearby', () => {
    const tracker = makeTracker([{
      runtime_id: 2,
      entity_type: 10, // chicken (passive, internalId=10)
      position: { x: 2, y: 64, z: 0 },
    }]);
    const { events } = checkDangerAlerts(tracker, STATE, GOOD_VITALS, new Map(), { mobDistance: 8 });
    assert.equal(events.length, 0);
  });

  it('does NOT fire for hostile mob beyond distance', () => {
    const tracker = makeTracker([{
      runtime_id: 3,
      entity_type: 32, // zombie
      position: { x: 20, y: 64, z: 0 }, // 20 blocks away
    }]);
    const { events } = checkDangerAlerts(tracker, STATE, GOOD_VITALS, new Map(), { mobDistance: 8 });
    assert.equal(events.length, 0);
  });

  it('debounce prevents repeated alerts within 5s', () => {
    const tracker = makeTracker([{
      runtime_id: 4,
      entity_type: 32,
      position: { x: 3, y: 64, z: 0 },
    }]);
    const { events: e1, lastAlerts } = checkDangerAlerts(tracker, STATE, GOOD_VITALS, new Map(), { mobDistance: 8, debounceMs: 5000 });
    assert.equal(e1.length, 1);
    // Second call immediately — should be debounced
    const { events: e2 } = checkDangerAlerts(tracker, STATE, GOOD_VITALS, lastAlerts, { mobDistance: 8, debounceMs: 5000 });
    assert.equal(e2.length, 0);
  });

  it('fires low_health alert when health below threshold', () => {
    const tracker = makeTracker();
    const { events } = checkDangerAlerts(tracker, STATE, { health: 4, hunger: 20 }, new Map(), { lowHealth: 6 });
    assert.equal(events.length, 1);
    assert.equal(events[0].threat, 'low_health');
    assert.equal(events[0].health, 4);
  });

  it('does NOT fire low_health when health above threshold', () => {
    const tracker = makeTracker();
    const { events } = checkDangerAlerts(tracker, STATE, { health: 10, hunger: 20 }, new Map(), { lowHealth: 6 });
    assert.equal(events.length, 0);
  });

  it('fires low_hunger alert when hunger below threshold', () => {
    const tracker = makeTracker();
    const { events } = checkDangerAlerts(tracker, STATE, { health: 20, hunger: 3 }, new Map(), { lowHunger: 4 });
    assert.equal(events.length, 1);
    assert.equal(events[0].threat, 'low_hunger');
  });

  it('no alert when pos is null', () => {
    const tracker = makeTracker([{
      runtime_id: 5,
      entity_type: 32,
      position: { x: 2, y: 64, z: 0 },
    }]);
    const { events } = checkDangerAlerts(tracker, { pos: null }, GOOD_VITALS, new Map());
    assert.equal(events.length, 0);
  });
});
