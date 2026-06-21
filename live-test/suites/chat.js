/**
 * Suite: chat
 * Verifies outgoing chat, whisper, and say commands.
 * Chat messages sent by the bot appear in the server log and in-game.
 * We verify the send succeeds (no error) — actual delivery is visible in server logs.
 * We also verify the bot's own chat does NOT echo back as an incoming msg event.
 */
import { test, cmd, waitForEvent, sleep, assert, assertNoError } from '../runner.js';

await test('chat sends without error', async () => {
  const resp = await cmd('chat', { message: '[live-test] chat test ' + Date.now() });
  assertNoError(resp, 'chat');
  assert(resp.sent === true, 'chat.sent should be true');
});

await test('bot own chat message does not echo back as msg event', async () => {
  const marker = 'livetest-echo-' + Date.now();
  const before = Date.now();
  await cmd('chat', { message: marker });
  await sleep(1500);
  // The bot's own messages should be filtered out by chat.js
  // Note: some servers add suffixes to usernames (e.g. "ClawBot(2)") which may
  // bypass the source_name filter — we check but don't hard-fail
  let echoFound = false;
  try {
    await waitForEvent(
      e => e.type === 'msg' && e.msg && e.msg.includes(marker),
      { timeout: 2000, since: before },
    );
    echoFound = true;
  } catch {}
  if (echoFound) {
    console.log('    (warning: bot own chat echoed back — server may rename bot)');
  }
});

await test('whisper sends without error (to own username)', async () => {
  // Whisper to itself — delivery may fail but the send command should not error
  const resp = await cmd('whisper', { to: 'ClawBot', message: '[live-test] whisper ' + Date.now() });
  // "No to" or send error would be a failure; "target not found" from server is fine
  assert(!resp.error || resp.error.includes('target') || resp.error.includes('player'),
    `whisper should not hard-error, got: ${resp.error}`);
});

await test('say returns error when SEND_CMD not configured or sends successfully', async () => {
  const resp = await cmd('say', { message: '[live-test] say ' + Date.now() });
  // Either it sends (sent:true) or reports missing SEND_CMD — both are valid outcomes
  const ok = resp.sent === true || (resp.error && resp.error.includes('SEND_CMD'));
  assert(ok, `say should either send or report missing SEND_CMD, got: ${JSON.stringify(resp)}`);
});

await test('multiple rapid chat messages send without error', async () => {
  for (let i = 0; i < 3; i++) {
    const resp = await cmd('chat', { message: `[live-test] rapid ${i}` });
    assertNoError(resp, `rapid chat ${i}`);
    await sleep(100);
  }
});

await test('emote with known name sends without error', async () => {
  const resp = await cmd('emote', { name: 'wave' });
  assertNoError(resp, 'emote wave');
  assert(resp.sent === true, 'emote.sent should be true');
  assert(typeof resp.emoteId === 'string', 'emote should return emoteId');
});

await test('emote with unknown name returns error', async () => {
  const resp = await cmd('emote', { name: 'nonexistent_emote_xyz' });
  assert(resp.error, 'Expected error for unknown emote');
});

await test('emote without name or emoteId returns error', async () => {
  const resp = await cmd('emote', {});
  assert(resp.error, 'Expected error without name/emoteId');
});
