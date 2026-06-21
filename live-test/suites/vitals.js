/**
 * Suite: vitals
 * Verifies the vitals command returns expected structure and status includes vitals summary.
 */
import { test, cmd, assert, assertNoError } from '../runner.js';

await test('vitals command returns health and hunger', async () => {
  const resp = await cmd('vitals');
  assertNoError(resp, 'vitals');
  assert(typeof resp.health === 'number', `health should be a number, got ${typeof resp.health}`);
  assert(typeof resp.maxHealth === 'number', `maxHealth should be a number`);
  assert(typeof resp.hunger === 'number', `hunger should be a number`);
  assert(typeof resp.alive === 'boolean', `alive should be a boolean`);
  assert(Array.isArray(resp.effects), `effects should be an array`);
});

await test('vitals health is within valid range', async () => {
  const resp = await cmd('vitals');
  assert(resp.health >= 0 && resp.health <= resp.maxHealth, `health ${resp.health} should be 0..${resp.maxHealth}`);
  assert(resp.hunger >= 0 && resp.hunger <= 20, `hunger ${resp.hunger} should be 0..20`);
});

await test('status includes vitals summary', async () => {
  const resp = await cmd('status');
  assertNoError(resp, 'status');
  assert(resp.vitals != null, 'status should include vitals');
  assert(typeof resp.vitals.health === 'number', 'vitals.health should be a number');
  assert(typeof resp.vitals.alive === 'boolean', 'vitals.alive should be a boolean');
  assert(typeof resp.vitals.effectCount === 'number', 'vitals.effectCount should be a number');
});
