/**
 * Suite: server-cmd
 * Verifies the `cmd` action passes commands to the server via SEND_CMD.
 * Skipped if SEND_CMD is not configured.
 * Uses safe read-only commands (list, time query) to avoid side effects.
 */
import { test, skip, cmd, assert, assertNoError } from '../runner.js';

// Check if SEND_CMD is available
const probe = await cmd('cmd', { cmd: 'list' });
const sendCmdAvailable = !probe.error?.includes('No SEND_CMD');

if (!sendCmdAvailable) {
  skip('cmd sends server command (list)', 'SEND_CMD not configured');
  skip('cmd sends time query', 'SEND_CMD not configured');
  skip('cmd returns error for missing cmd field', 'SEND_CMD not configured');
} else {
  await test('cmd sends server command (list)', async () => {
    const resp = await cmd('cmd', { cmd: 'list' });
    assertNoError(resp, 'cmd list');
    assert(resp.cmd === 'list', `cmd field should echo back 'list', got: ${resp.cmd}`);
  });

  await test('cmd sends time query command', async () => {
    const resp = await cmd('cmd', { cmd: 'time query daytime' });
    assertNoError(resp, 'cmd time query');
    assert(typeof resp.cmd === 'string', 'cmd response has cmd field');
  });

  await test('cmd accepts command via command alias', async () => {
    // Also supports "command" field as alias for "cmd"
    const resp = await cmd('cmd', { command: 'list' });
    assertNoError(resp, 'cmd via command alias');
  });
}

await test('cmd returns error when cmd field is missing', async () => {
  const resp = await cmd('cmd', {});
  // Either "No SEND_CMD" or "Need cmd field"
  assert(typeof resp.error === 'string', 'should return an error for missing cmd field');
});
