import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadPalette, nameFor, isLoaded } from '../src/palette.js';

describe('palette', () => {
  it('loads a palette file and looks up names', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clawcraft-palette-'));
    const path = join(dir, 'palette.json');
    writeFileSync(path, JSON.stringify([
      { runtimeId: 2150698529, name: 'minecraft:stone' },
      { runtimeId: 3690217760, name: 'minecraft:air' },
      { runtimeId: 2186211206, name: 'minecraft:dirt' },
    ]));

    const count = loadPalette(path);
    assert.equal(count, 3);
    assert.equal(isLoaded(), true);
    assert.equal(nameFor(2150698529), 'minecraft:stone');
    assert.equal(nameFor(3690217760), 'minecraft:air');
    assert.equal(nameFor(2186211206), 'minecraft:dirt');

    unlinkSync(path);
  });

  it('returns null for unknown runtime IDs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clawcraft-palette-'));
    const path = join(dir, 'palette.json');
    writeFileSync(path, JSON.stringify([{ runtimeId: 1, name: 'minecraft:stone' }]));
    loadPalette(path);
    assert.equal(nameFor(999999), null);
    unlinkSync(path);
  });

  it('returns 0 entries for a missing file', () => {
    const count = loadPalette('/nonexistent/path/palette.json');
    assert.equal(count, 0);
    assert.equal(isLoaded(), false);
  });

  it('handles the first occurrence of duplicate runtime IDs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clawcraft-palette-'));
    const path = join(dir, 'palette.json');
    writeFileSync(path, JSON.stringify([
      { runtimeId: 5, name: 'minecraft:stone' },
      { runtimeId: 5, name: 'minecraft:granite' },
    ]));
    loadPalette(path);
    assert.equal(nameFor(5), 'minecraft:stone');
    unlinkSync(path);
  });
});
