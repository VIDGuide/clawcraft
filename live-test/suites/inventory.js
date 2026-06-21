import { test, cmd, assert, assertNoError } from '../runner.js';

await test('inventory command returns valid structure', async () => {
  const resp = await cmd('inventory');
  assertNoError(resp, 'inventory');
  assert(Array.isArray(resp.slots), 'slots should be an array');
  assert(resp.slots.length === 36, 'slots should have 36 entries');
  assert(Array.isArray(resp.armor), 'armor should be an array');
  assert(resp.armor.length === 4, 'armor should have 4 entries');
  assert('offhand' in resp, 'should have offhand field');
  assert(typeof resp.heldSlot === 'number', 'heldSlot should be a number');
  assert('summary' in resp, 'should have summary');
  assert(typeof resp.summary.occupied === 'number', 'summary.occupied should be number');
  assert(resp.summary.total === 36, 'summary.total should be 36');
});

await test('inventory summary view returns compact format', async () => {
  const resp = await cmd('inventory', { view: 'summary' });
  assertNoError(resp, 'inventory summary');
  assert('heldSlot' in resp, 'should have heldSlot');
  assert('summary' in resp, 'should have summary');
  assert(!('slots' in resp), 'summary view should not include slots array');
});

await test('equip with invalid slot returns error', async () => {
  const resp = await cmd('equip', { slot: 99 });
  assert(resp.error, 'should error for invalid slot');
});

await test('equip without item or slot returns error', async () => {
  const resp = await cmd('equip', {});
  assert(resp.error, 'should error without item or slot');
});

await test('unequip without target returns error', async () => {
  const resp = await cmd('unequip', {});
  assert(resp.error, 'should error without target');
});

await test('unequip with invalid target returns error', async () => {
  const resp = await cmd('unequip', { target: 'invalid' });
  assert(resp.error, 'should error for invalid target');
});

await test('equip by slot 0 succeeds', async () => {
  const resp = await cmd('equip', { slot: 0 });
  assertNoError(resp, 'equip slot 0');
  assert(resp.equipped === true, 'should report equipped');
  assert(resp.slot === 0, 'should be slot 0');
});
