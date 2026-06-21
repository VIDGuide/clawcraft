#!/usr/bin/env node
/**
 * ClawMine — Send a command to the running bot via TCP.
 * Usage: node scripts/cmd.js '{"action":"status"}'
 *        node scripts/cmd.js '{"action":"scan","radius":4}'
 *
 * Environment:
 *   CLAWMINE_PORT    TCP port the bot is listening on (default: 3001)
 *   CLAWMINE_TIMEOUT Response timeout in ms (default: 10000)
 *
 * Exit codes: 0 = success, 1 = error
 * Output: JSON response on stdout; errors on stderr as JSON
 */
import net from 'net';

const PORT = parseInt(process.env.CLAWMINE_PORT || '3001');
const TIMEOUT = parseInt(process.env.CLAWMINE_TIMEOUT || '10000');
const raw = process.argv[2];

if (!raw) {
  console.error('Usage: node scripts/cmd.js \'{"action":"...",...}\'');
  process.exit(1);
}

let cmd;
try { cmd = JSON.parse(raw); } catch {
  console.error(JSON.stringify({ ok: false, error: 'INVALID_JSON', error_message: 'Argument is not valid JSON' }));
  process.exit(1);
}

const socket = net.connect(PORT, '127.0.0.1');
let buf = '';
let timedOut = false;

const timer = setTimeout(() => {
  timedOut = true;
  socket.destroy();
  console.error(JSON.stringify({ ok: false, error: 'TIMEOUT', error_message: `No response within ${TIMEOUT}ms` }));
  process.exit(1);
}, TIMEOUT);

socket.on('connect', () => {
  socket.write(JSON.stringify(cmd) + '\n');
});

socket.on('data', (chunk) => {
  buf += chunk.toString();
  const nl = buf.indexOf('\n');
  if (nl !== -1) {
    clearTimeout(timer);
    const line = buf.slice(0, nl).trim();
    try {
      const resp = JSON.parse(line);
      console.log(JSON.stringify(resp));
      process.exit(0);
    } catch {
      console.error(JSON.stringify({ ok: false, error: 'INVALID_RESPONSE', error_message: line }));
      process.exit(1);
    }
  }
});

socket.on('error', (err) => {
  if (timedOut) return;
  clearTimeout(timer);
  const code = err.code === 'ECONNREFUSED' ? 'BOT_NOT_RUNNING' : 'CONNECTION_ERROR';
  console.error(JSON.stringify({ ok: false, error: code, error_message: err.message }));
  process.exit(1);
});
