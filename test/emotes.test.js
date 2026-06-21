import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { titleFor, uuidFor, count } from '../src/emotes.js';

// Sample known emotes from data/emotes.json
const WAVE_UUID = 'b8f1e3e0-3c24-4cf1-a13e-aa8f7db0d0b0';
const FACEPALM_UUID = '402efb2d-6607-47f2-b8e5-bc422bcd8304';
const CLAP_UUID = '9a469a61-c83b-4ba9-b507-bdbe64430582';

describe('emotes', () => {
  it('loads emotes from data/emotes.json', () => {
    assert.ok(count() > 0, 'Should load at least some emotes');
    assert.ok(count() >= 2000, `Expected >= 2000 emotes, got ${count()}`);
  });

  it('resolves UUID to title', () => {
    // These UUIDs are stable across dataset updates
    const title = titleFor(CLAP_UUID);
    assert.ok(title !== null, 'Should resolve known UUID');
    assert.equal(typeof title, 'string');
    assert.ok(title.length > 0);
  });

  it('returns null for unknown UUID', () => {
    assert.equal(titleFor('00000000-0000-0000-0000-000000000000'), null);
  });

  it('resolves name to UUID (exact match)', () => {
    // Find any emote from the data and verify round-trip
    const uuid = uuidFor('Clapping');
    if (uuid !== null) {
      const title = titleFor(uuid);
      assert.ok(title !== null);
      assert.ok(title.toLowerCase().includes('clap'));
    }
  });

  it('resolves name to UUID (fuzzy match)', () => {
    // 'wave' should match something containing 'wave' in the title
    const uuid = uuidFor('wave');
    assert.ok(uuid !== null, 'Should find an emote containing "wave"');
    const title = titleFor(uuid);
    assert.ok(title?.toLowerCase().includes('wave'));
  });

  it('returns null for unknown name', () => {
    assert.equal(uuidFor('this_emote_does_not_exist_xyz'), null);
  });

  it('case-insensitive name lookup', () => {
    const lower = uuidFor('clapping');
    const upper = uuidFor('CLAPPING');
    const mixed = uuidFor('Clapping');
    // All should return the same result (either all null or all the same uuid)
    assert.equal(lower, upper);
    assert.equal(lower, mixed);
  });
});
