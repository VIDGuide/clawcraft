import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getBreakTime, findBestTool, isInteractable, isFood, isThrowable } from '../src/actions.js';

describe('actions.js — getBreakTime', () => {
  it('stone with diamond pickaxe is fast', () => {
    const ticks = getBreakTime('stone', { displayName: 'diamond_pickaxe' });
    assert(ticks < 10, `Expected < 10 ticks, got ${ticks}`);
  });

  it('stone with bare hand is slow', () => {
    const ticks = getBreakTime('stone', null);
    assert(ticks > 50, `Expected > 50 ticks with bare hand, got ${ticks}`);
  });

  it('stone with wrong tool (shovel) is slow', () => {
    const ticks = getBreakTime('stone', { displayName: 'diamond_shovel' });
    assert(ticks > 10, `Expected > 10 ticks with wrong tool, got ${ticks}`);
  });

  it('dirt with shovel is fast', () => {
    const ticks = getBreakTime('dirt', { displayName: 'iron_shovel' });
    assert(ticks <= 5, `Expected <= 5 ticks, got ${ticks}`);
  });

  it('bedrock returns Infinity', () => {
    assert.strictEqual(getBreakTime('bedrock', null), Infinity);
  });

  it('handles minecraft: prefix', () => {
    const ticks = getBreakTime('minecraft:stone', { displayName: 'diamond_pickaxe' });
    assert(ticks < 10, `Expected < 10 ticks, got ${ticks}`);
  });

  it('unknown block returns default', () => {
    assert.strictEqual(getBreakTime('unknown_block_xyz', null), 20);
  });

  it('instant-break blocks return 1 tick', () => {
    // short_grass has hardness 0
    const ticks = getBreakTime('short_grass', null);
    assert(ticks <= 1, `Expected 1 tick for instant-break, got ${ticks}`);
  });
});

describe('actions.js — findBestTool', () => {
  const slots = [
    { name: 'minecraft:wooden_pickaxe', displayName: 'wooden_pickaxe' },
    null,
    { name: 'minecraft:diamond_pickaxe', displayName: 'diamond_pickaxe' },
    { name: 'minecraft:iron_axe', displayName: 'iron_axe' },
    { name: 'minecraft:diamond_shovel', displayName: 'diamond_shovel' },
  ];

  it('finds diamond pickaxe for stone (best pickaxe)', () => {
    assert.strictEqual(findBestTool(slots, 'stone'), 2);
  });

  it('finds iron axe for oak_log', () => {
    assert.strictEqual(findBestTool(slots, 'oak_log'), 3);
  });

  it('finds diamond shovel for dirt', () => {
    assert.strictEqual(findBestTool(slots, 'dirt'), 4);
  });

  it('returns null when no matching tool', () => {
    assert.strictEqual(findBestTool([null, null], 'stone'), null);
  });

  it('returns null for block with no material', () => {
    assert.strictEqual(findBestTool(slots, 'bedrock'), null);
  });
});

describe('actions.js — isInteractable', () => {
  it('doors are interactable', () => {
    assert(isInteractable('minecraft:oak_door'));
    assert(isInteractable('iron_door'));
    assert(isInteractable('spruce_trapdoor'));
  });

  it('levers and buttons are interactable', () => {
    assert(isInteractable('lever'));
    assert(isInteractable('stone_button'));
    assert(isInteractable('oak_button'));
  });

  it('fence gates are interactable', () => {
    assert(isInteractable('oak_fence_gate'));
  });

  it('stone is not interactable', () => {
    assert(!isInteractable('stone'));
    assert(!isInteractable('dirt'));
  });
});

describe('actions.js — isFood', () => {
  it('recognizes common foods', () => {
    assert(isFood('cooked_beef'));
    assert(isFood('bread'));
    assert(isFood('golden_apple'));
    assert(isFood('baked_potato'));
    assert(isFood('cooked_chicken'));
  });

  it('rejects non-food items', () => {
    assert(!isFood('diamond_pickaxe'));
    assert(!isFood('stone'));
    assert(!isFood('stick'));
  });
});

describe('actions.js — isThrowable', () => {
  it('recognizes throwable items', () => {
    assert(isThrowable('egg'));
    assert(isThrowable('snowball'));
    assert(isThrowable('ender_pearl'));
    assert(isThrowable('trident'));
    assert(isThrowable('splash_potion'));
  });

  it('rejects non-throwable items', () => {
    assert(!isThrowable('diamond_pickaxe'));
    assert(!isThrowable('apple'));
    assert(!isThrowable('stone'));
  });
});
