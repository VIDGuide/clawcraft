import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createVitals, applyAttributes, applyEffect, applyDeath, applyRespawn,
  createBuffer, bufferChanges, setHurt, setDeathInfo, flushBuffer,
  getVitalsSummary, getVitalsSnapshot, getEffectName,
} from '../src/vitals.js';

describe('vitals – createVitals', () => {
  it('returns default state', () => {
    const v = createVitals();
    assert.equal(v.health, 20);
    assert.equal(v.maxHealth, 20);
    assert.equal(v.hunger, 20);
    assert.equal(v.alive, true);
    assert.deepEqual(v.effects, []);
  });
});

describe('vitals – applyAttributes', () => {
  it('detects health change', () => {
    const v = createVitals();
    const { vitals, changes } = applyAttributes(v, [
      { name: 'minecraft:health', current: 15, min: 0, max: 20, default: 20, default_min: 0, default_max: 20 },
    ]);
    assert.equal(vitals.health, 15);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].attr, 'health');
    assert.equal(changes[0].old, 20);
    assert.equal(changes[0].new, 15);
  });

  it('ignores unchanged attributes', () => {
    const v = createVitals();
    const { changes } = applyAttributes(v, [
      { name: 'minecraft:health', current: 20, min: 0, max: 20, default: 20, default_min: 0, default_max: 20 },
    ]);
    assert.equal(changes.length, 0);
  });

  it('tracks multiple attributes at once', () => {
    const v = createVitals();
    const { vitals, changes } = applyAttributes(v, [
      { name: 'minecraft:health', current: 10, min: 0, max: 20 },
      { name: 'minecraft:player.hunger', current: 15, min: 0, max: 20 },
    ]);
    assert.equal(vitals.health, 10);
    assert.equal(vitals.hunger, 15);
    assert.equal(changes.length, 2);
  });

  it('ignores unknown attributes', () => {
    const v = createVitals();
    const { changes } = applyAttributes(v, [
      { name: 'minecraft:attack_damage', current: 5, min: 0, max: 100 },
    ]);
    assert.equal(changes.length, 0);
  });

  it('updates maxHealth from attribute max', () => {
    const v = createVitals();
    const { vitals } = applyAttributes(v, [
      { name: 'minecraft:health', current: 30, min: 0, max: 40 },
    ]);
    assert.equal(vitals.maxHealth, 40);
  });
});

describe('vitals – applyEffect', () => {
  it('adds an effect', () => {
    const v = createVitals();
    const { vitals, event } = applyEffect(v, { eventId: 'add', effectId: 1, amplifier: 0, duration: 600, particles: true }, 1000);
    assert.equal(vitals.effects.length, 1);
    assert.equal(vitals.effects[0].name, 'speed');
    assert.equal(event.type, 'effect_added');
    assert.equal(event.effect, 'speed');
    assert.equal(event.amplifier, 0);
  });

  it('updates an effect', () => {
    let v = createVitals();
    ({ vitals: v } = applyEffect(v, { eventId: 'add', effectId: 19, amplifier: 0, duration: 200, particles: true }, 1000));
    const { vitals, event } = applyEffect(v, { eventId: 'update', effectId: 19, amplifier: 1, duration: 400, particles: true }, 2000);
    assert.equal(vitals.effects.length, 1);
    assert.equal(vitals.effects[0].amplifier, 1);
    assert.equal(event.type, 'effect_updated');
    assert.equal(event.effect, 'poison');
  });

  it('removes an effect', () => {
    let v = createVitals();
    ({ vitals: v } = applyEffect(v, { eventId: 'add', effectId: 10, amplifier: 0, duration: 100, particles: true }, 1000));
    const { vitals, event } = applyEffect(v, { eventId: 'remove', effectId: 10, amplifier: 0, duration: 0, particles: false }, 2000);
    assert.equal(vitals.effects.length, 0);
    assert.equal(event.type, 'effect_removed');
    assert.equal(event.effect, 'regeneration');
  });

  it('handles unknown effect IDs', () => {
    const v = createVitals();
    const { event } = applyEffect(v, { eventId: 'add', effectId: 999, amplifier: 0, duration: 100, particles: false }, 1000);
    assert.equal(event.effect, 'unknown_999');
  });

  it('replaces existing effect on add', () => {
    let v = createVitals();
    ({ vitals: v } = applyEffect(v, { eventId: 'add', effectId: 1, amplifier: 0, duration: 100, particles: true }, 1000));
    const { vitals } = applyEffect(v, { eventId: 'add', effectId: 1, amplifier: 2, duration: 300, particles: true }, 2000);
    assert.equal(vitals.effects.length, 1);
    assert.equal(vitals.effects[0].amplifier, 2);
  });
});

describe('vitals – death & respawn', () => {
  it('applyDeath sets alive=false and health=0', () => {
    const v = createVitals();
    const { vitals, event } = applyDeath(v, 'lava', ['Player burned']);
    assert.equal(vitals.alive, false);
    assert.equal(vitals.health, 0);
    assert.equal(event.type, 'death');
    assert.equal(event.cause, 'lava');
    assert.deepEqual(event.messages, ['Player burned']);
  });

  it('applyRespawn resets state', () => {
    let v = createVitals();
    ({ vitals: v } = applyDeath(v, 'fall', []));
    ({ vitals: v } = applyEffect(v, { eventId: 'add', effectId: 19, amplifier: 0, duration: 100, particles: true }));
    const { vitals, event } = applyRespawn(v);
    assert.equal(vitals.alive, true);
    assert.equal(vitals.health, 20);
    assert.equal(vitals.hunger, 20);
    assert.equal(vitals.effects.length, 0);
    assert.equal(event.type, 'respawn');
  });
});

describe('vitals – causal grouping buffer', () => {
  it('flushBuffer returns null for empty buffer', () => {
    const buf = createBuffer();
    assert.equal(flushBuffer(buf), null);
  });

  it('groups health decrease into damage_taken', () => {
    let buf = createBuffer();
    buf = bufferChanges(buf, [{ attr: 'health', old: 20, new: 15, max: 20 }]);
    buf = setHurt(buf, 'attack');
    const event = flushBuffer(buf);
    assert.equal(event.type, 'damage_taken');
    assert.equal(event.cause, 'attack');
    assert.equal(event.health.old, 20);
    assert.equal(event.health.new, 15);
  });

  it('groups health increase into health_restored', () => {
    let buf = createBuffer();
    buf = bufferChanges(buf, [{ attr: 'health', old: 10, new: 15, max: 20 }]);
    const event = flushBuffer(buf);
    assert.equal(event.type, 'health_restored');
    assert.equal(event.cause, 'regeneration');
  });

  it('includes absorption in damage event', () => {
    let buf = createBuffer();
    buf = bufferChanges(buf, [
      { attr: 'health', old: 20, new: 18, max: 20 },
      { attr: 'absorption', old: 4, new: 0, max: 16 },
    ]);
    buf = setHurt(buf, 'attack');
    const event = flushBuffer(buf);
    assert.equal(event.type, 'damage_taken');
    assert.deepEqual(event.absorption, { old: 4, new: 0 });
  });

  it('emits hunger_changed when only hunger decreases', () => {
    let buf = createBuffer();
    buf = bufferChanges(buf, [{ attr: 'hunger', old: 20, new: 18, max: 20 }]);
    const event = flushBuffer(buf);
    assert.equal(event.type, 'hunger_changed');
  });

  it('emits vitals_changed for non-health changes', () => {
    let buf = createBuffer();
    buf = bufferChanges(buf, [{ attr: 'movementSpeed', old: 0.1, new: 0.13, max: 1 }]);
    const event = flushBuffer(buf);
    assert.equal(event.type, 'vitals_changed');
  });

  it('infers starvation cause', () => {
    let buf = createBuffer();
    buf = bufferChanges(buf, [
      { attr: 'health', old: 5, new: 4, max: 20 },
      { attr: 'hunger', old: 0, new: 0, max: 20 },
    ]);
    const event = flushBuffer(buf);
    assert.equal(event.cause, 'starvation');
  });

  it('infers natural_regeneration from saturation decrease', () => {
    let buf = createBuffer();
    buf = bufferChanges(buf, [
      { attr: 'health', old: 15, new: 16, max: 20 },
      { attr: 'saturation', old: 5, new: 4.4, max: 20 },
    ]);
    const event = flushBuffer(buf);
    assert.equal(event.cause, 'natural_regeneration');
  });
});

describe('vitals – query helpers', () => {
  it('getVitalsSummary returns compact info', () => {
    const v = { ...createVitals(), health: 15 };
    const s = getVitalsSummary(v);
    assert.equal(s.health, 15);
    assert.equal(s.maxHealth, 20);
    assert.equal(s.alive, true);
    assert.equal(s.effectCount, 0);
  });

  it('getVitalsSnapshot includes effect remaining ticks', () => {
    let v = createVitals();
    ({ vitals: v } = applyEffect(v, { eventId: 'add', effectId: 1, amplifier: 0, duration: 600, particles: true }, 1000));
    const snap = getVitalsSnapshot(v, 6000); // 5 seconds later = 100 ticks later
    assert.equal(snap.effects[0].name, 'speed');
    assert.equal(snap.effects[0].remaining, 500);
  });

  it('getEffectName returns name for known ids', () => {
    assert.equal(getEffectName(19), 'poison');
    assert.equal(getEffectName(1), 'speed');
  });

  it('getEffectName returns unknown_N for unknown ids', () => {
    assert.equal(getEffectName(999), 'unknown_999');
  });
});
