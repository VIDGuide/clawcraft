/**
 * Suite: teleport
 * Verifies the tp command using SEND_CMD, position state sync, and chunk loading after teleport.
 * Skipped if SEND_CMD is not configured.
 */
import { test, skip, cmd, sleep, assert, assertNoError } from '../runner.js';

// Check if SEND_CMD is available
const statusResp = await cmd('status');
const hasSendCmd = !((await cmd('tp', { x: 0, y: 64, z: 0 })).error?.includes('No SEND_CMD'));
// If tp worked or errored for a different reason, SEND_CMD is configured
// We'll check by attempting and see if we get SEND_CMD error

// Actually check properly: tp with obviously wrong coords — if SEND_CMD missing, error is predictable
const testTp = await cmd('tp', { x: 999999, y: 64, z: 999999 });
const sendCmdAvailable = !testTp.error?.includes('No SEND_CMD');

if (!sendCmdAvailable) {
  skip('tp sends bot to coordinates', 'SEND_CMD not configured');
  skip('position syncs to tp target', 'SEND_CMD not configured');
  skip('chunks load at new position after tp', 'SEND_CMD not configured');
} else {
  // Get starting position before any tp
  const startResp = await cmd('pos');
  const start = startResp.pos ?? { x: 0, y: 64, z: 0 };
  const safeReturn = { x: Math.round(start.x), y: Math.round(start.y), z: Math.round(start.z) };

  await test('tp sends bot to coordinates', async () => {
    const target = { x: Math.round(start.x) + 10, y: Math.round(start.y), z: Math.round(start.z) };
    const resp = await cmd('tp', target);
    assertNoError(resp, 'tp');
    assert(resp.teleported === true, 'tp.teleported should be true');
    assert(resp.pos != null, 'tp.pos should exist');
  });

  await test('position syncs to tp target', async () => {
    const target = { x: Math.round(start.x) + 15, y: Math.round(start.y), z: Math.round(start.z) };
    await cmd('tp', target);
    await sleep(500); // allow move_player echo to arrive
    const posResp = await cmd('pos');
    assertNoError(posResp, 'pos after tp');
    // Server may place us slightly differently — within 2 blocks is acceptable
    const dx = Math.abs((posResp.pos?.x ?? 0) - target.x);
    assert(dx < 3, `x should be near ${target.x}, got ${posResp.pos?.x} (diff=${dx.toFixed(1)})`);
  });

  await test('chunks load at new position after tp', async () => {
    const target = { x: Math.round(start.x) + 20, y: Math.round(start.y), z: Math.round(start.z) };
    await cmd('tp', target);
    // Retry scan up to 5s for chunks to load
    let resp;
    for (let i = 0; i < 5; i++) {
      await sleep(1000);
      resp = await cmd('scan', { radius: 2, radiusY: 1 });
      if (resp.loaded) break;
    }
    assertNoError(resp, 'scan after tp');
    assert(resp.loaded === true, `chunks should load after tp; unloaded=${resp.unloaded}/${resp.total}`);
  });

  // Always restore position
  await cmd('tp', safeReturn);
}
