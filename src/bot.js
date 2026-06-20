#!/usr/bin/env node
/**
 * ClawMine — Bedrock Minecraft bot
 *
 * Connects to a Bedrock server, stays alive with tick sync,
 * and accepts JSON commands via stdin.
 *
 * Environment:
 *   HOST      Server address (default: 192.168.1.10)
 *   PORT      Bedrock port (default: 19132)
 *   USERNAME  Bot name (default: ClawBot)
 *   OFFLINE   Offline mode (default: true)
 */
import bedrock from 'bedrock-protocol';
import readline from 'readline';

const HOST = process.env.HOST || '192.168.1.10';
const PORT = parseInt(process.env.PORT || '19132');
const USERNAME = process.env.USERNAME || 'ClawBot';
const OFFLINE = process.env.OFFLINE !== 'false';

const log = (msg) => process.stderr.write(`[${new Date().toISOString()}] ${msg}\n`);

log(`Connecting to ${HOST}:${PORT} as ${USERNAME} (offline: ${OFFLINE})`);

const client = bedrock.createClient({
  host: HOST,
  port: PORT,
  username: USERNAME,
  offline: OFFLINE,
  timeout: 30000,
});

// ── Connection lifecycle ──────────────────────────────────

client.on('join', () => {
  output({ type: 'ready' });
  log('Joined server');
});

client.on('spawn', () => {
  output({ type: 'spawn' });
  log('Spawned in world');
});

client.on('error', (err) => log(`Error: ${err.message}`));
client.on('end', (reason) => log(`Disconnected: ${reason}`));

// ── Incoming messages ─────────────────────────────────────

client.on('text', (pkt) => {
  if (pkt.type === 'chat' || pkt.type === 'system') {
    output({
      type: 'msg',
      from: pkt.source_name || '',
      msg: pkt.message,
    });
  }
});

// ── JSON command interface ────────────────────────────────

function output(data) {
  console.log(JSON.stringify(data));
}

let cid = 0;

function handle(cmd) {
  const id = cmd.id ?? cid++;
  const ok = (d) => output({ type: 'response', id, ...d });

  try {
    switch (cmd.action) {
      case 'chat':
        client.queue('text', {
          type: 'raw',
          needs_translation: false,
          message: cmd.message,
          xuid: '',
          platform_chat_id: '',
        });
        return ok({ sent: true });

      case 'say':
        client.queue('text', {
          type: 'chat',
          needs_translation: false,
          source_name: '',
          message: cmd.message,
          xuid: '',
          platform_chat_id: '',
        });
        return ok({ sent: true });

      case 'pos':
        return ok({ pos: client.entity?.position });

      default:
        return ok({ error: `Unknown action: ${cmd.action}` });
    }
  } catch (e) {
    ok({ error: e.message });
  }
}

// ── Line-by-line stdin reader ─────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  terminal: false,
});

rl.on('line', (line) => {
  const t = line.trim();
  if (t) {
    try {
      handle(JSON.parse(t));
    } catch {
      // ignore non-JSON lines
    }
  }
});

output({ type: 'startup', version: '0.1.0' });
