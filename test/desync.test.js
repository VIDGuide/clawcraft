/**
 * Position desync detection tests.
 * Tests the desync detection logic directly (extracted from bot.js).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Mirror of the desync detection logic in bot.js move_player handler
function checkDesync(prevPos, newPos, mode) {
  if (!prevPos || !newPos) return null;
  const isServerCorrection = mode === 'teleport' || mode === 'reset';
  const drift = Math.sqrt(
    (newPos.x - prevPos.x) ** 2 +
    (newPos.y - prevPos.y) ** 2 +
    (newPos.z - prevPos.z) ** 2,
  );
  if (isServerCorrection || drift > 3) {
    return { type: 'position_desync', drift: Math.round(drift * 10) / 10, mode };
  }
  return null;
}

describe('position desync detection', () => {
  it('no desync for normal small movement', () => {
    assert.equal(checkDesync({ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }, 'normal'), null);
  });

  it('detects desync on teleport mode from server', () => {
    const result = checkDesync({ x: 0, y: 64, z: 0 }, { x: 0, y: 64, z: 0 }, 'teleport');
    assert.ok(result);
    assert.equal(result.type, 'position_desync');
    assert.equal(result.mode, 'teleport');
  });

  it('detects desync on reset mode from server', () => {
    const result = checkDesync({ x: 0, y: 64, z: 0 }, { x: 5, y: 64, z: 5 }, 'reset');
    assert.ok(result);
    assert.equal(result.mode, 'reset');
  });

  it('detects desync on large position jump (>3 blocks)', () => {
    const result = checkDesync({ x: 0, y: 64, z: 0 }, { x: 10, y: 64, z: 0 }, 'normal');
    assert.ok(result);
    assert.ok(result.drift > 3);
  });

  it('no desync for 2-block jump in normal mode', () => {
    assert.equal(checkDesync({ x: 0, y: 64, z: 0 }, { x: 2, y: 64, z: 0 }, 'normal'), null);
  });
});
