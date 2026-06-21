#!/usr/bin/env node
/**
 * ClawCraft — Live test runner
 *
 * Runs integration tests against a live bot connected to a real Minecraft server.
 * The bot must already be running (see TESTING.md).
 *
 * Usage:
 *   npm run live-test                     # all suites
 *   npm run live-test -- --suite vision   # one suite
 *   npm run live-test -- --list           # list available suites
 *
 * Environment:
 *   CLAWCRAFT_PORT     TCP port (default: 4099)
 *   CLAWCRAFT_EVENTS   Event log file (default: ./events.jsonl)
 */
import net from 'net';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────

function detectPort() {
  if (process.env.CLAWCRAFT_PORT) return parseInt(process.env.CLAWCRAFT_PORT);
  // Try to read port from start-test.sh (the isolated test instance)
  const startSh = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'start-test.sh');
  try {
    const content = fs.readFileSync(startSh, 'utf8');
    const match = content.match(/CLAWCRAFT_PORT=(\d+)/);
    if (match) return parseInt(match[1]);
  } catch {}
  return 4100;
}

export const PORT = detectPort();
export const EVENTS_FILE = process.env.CLAWCRAFT_EVENTS || './events-test.jsonl';
export const CMD_TIMEOUT = parseInt(process.env.LIVE_TEST_TIMEOUT || '10000');

// ── cmd() — send one action, return response ──────────────

export function cmd(action, params = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ action, ...params }) + '\n';
    const socket = net.connect(PORT, '127.0.0.1');
    let buf = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Timeout waiting for response to "${action}"`));
    }, CMD_TIMEOUT);

    socket.on('connect', () => socket.write(payload));
    socket.on('data', (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl !== -1) {
        clearTimeout(timer);
        try { resolve(JSON.parse(buf.slice(0, nl))); }
        catch (e) { reject(new Error(`Bad JSON response: ${buf.slice(0, nl)}`)); }
      }
    });
    socket.on('error', (err) => { clearTimeout(timer); reject(err); });
  });
}

// ── waitForEvent() — poll event file for a matching event ─

export function waitForEvent(predicate, { timeout = 8000, since } = {}) {
  const start = since ?? Date.now();
  const deadline = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const check = () => {
      if (!fs.existsSync(EVENTS_FILE)) {
        if (Date.now() > deadline) return reject(new Error('Timed out waiting for event (no file)'));
        return setTimeout(check, 200);
      }
      const lines = fs.readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const ev = JSON.parse(line);
          if ((ev.timestamp ?? 0) > start && predicate(ev)) return resolve(ev);
        } catch {}
      }
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for event'));
      setTimeout(check, 200);
    };
    check();
  });
}

// ── sleep ─────────────────────────────────────────────────

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── assert helpers ────────────────────────────────────────

export function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

export function assertNoError(resp, context = '') {
  if (resp.error) throw new Error(`${context} got error: ${resp.error}`);
}

// ── Test runner ───────────────────────────────────────────

let _pass = 0, _fail = 0, _skip = 0;
const _results = [];

export async function test(name, fn) {
  process.stdout.write(`  ${name} ... `);
  try {
    await fn();
    _pass++;
    _results.push({ name, status: 'pass' });
    console.log('✓');
  } catch (e) {
    _fail++;
    _results.push({ name, status: 'fail', error: e.message });
    console.log(`✗  ${e.message}`);
  }
}

export function skip(name, reason) {
  _skip++;
  _results.push({ name, status: 'skip', reason });
  console.log(`  ${name} ... SKIP  ${reason}`);
}

function report() {
  console.log('');
  console.log(`Results: ${_pass} passed, ${_fail} failed, ${_skip} skipped`);
  if (_fail > 0) {
    console.log('\nFailed tests:');
    for (const r of _results.filter(r => r.status === 'fail')) {
      console.log(`  ✗ ${r.name}: ${r.error}`);
    }
    process.exit(1);
  }
}

// ── Main: discover and run suites ────────────────────────

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const run = async () => {

const SUITES_DIR = path.join(__dirname, 'suites');

const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const suiteFilter = (() => {
  const idx = args.indexOf('--suite');
  return idx !== -1 ? args[idx + 1] : null;
})();

// Verify bot is reachable before running any tests
let _botProc = null;

async function tryConnect() {
  try {
    const resp = await cmd('status');
    if (resp.error) throw new Error(resp.error);
    return resp;
  } catch (e) {
    return null;
  }
}

async function startBot() {
  const projectDir = path.join(__dirname, '..');
  const startScript = path.join(projectDir, 'start-test.sh');

  if (!fs.existsSync(startScript)) {
    console.error('\nERROR: No start-test.sh found. Cannot auto-start the test bot.');
    console.error('Create start-test.sh (isolated test instance) or start it manually, then re-run.\n');
    process.exit(1);
  }

  console.log('Test bot not running. Starting via start-test.sh...');
  _botProc = spawn('bash', [startScript], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });
  _botProc.stdout.on('data', () => {});
  _botProc.stderr.on('data', (d) => {
    const line = d.toString().trim();
    if (line) process.stderr.write(`  [bot] ${line}\n`);
  });
  _botProc.on('error', (err) => {
    console.error('Failed to start bot:', err.message);
    process.exit(1);
  });

  // Wait for bot to become reachable (up to 30s)
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await sleep(1000);
    const resp = await tryConnect();
    if (resp) {
      console.log('Bot started successfully.');
      return resp;
    }
  }
  console.error('\nERROR: Bot started but never became reachable on port ' + PORT);
  _botProc.kill();
  process.exit(1);
}

async function killExistingTestBot() {
  // The test instance owns PORT exclusively. Kill any leftover test bot so the
  // suite always runs against the CURRENT code (avoids stale-process pitfalls).
  // Scoped to the test port only — never touches the LLM's instance on another port.
  const resp = await tryConnect();
  if (!resp) return; // nothing running
  console.log(`Found an existing test bot on port ${PORT}, restarting it for fresh code...`);
  try {
    const { execSync } = await import('child_process');
    execSync(`fuser -k ${PORT}/tcp`, { stdio: 'ignore' });
  } catch {
    // fuser may be unavailable; fall back to reusing the running bot
    console.log('  (could not auto-kill; reusing the running test bot)');
    return resp;
  }
  // Wait for the port to free up
  for (let i = 0; i < 10; i++) {
    await sleep(500);
    if (!(await tryConnect())) break;
  }
  return null;
}

async function checkBotRunning() {
  const existing = await killExistingTestBot();
  if (existing) return existing; // reuse only if we couldn't kill it
  return startBot();
}

const suiteFiles = fs.readdirSync(SUITES_DIR)
  .filter(f => f.endsWith('.js'))
  .sort();

if (listOnly) {
  console.log('Available suites:');
  for (const f of suiteFiles) console.log('  ' + path.basename(f, '.js'));
  process.exit(0);
}

const toRun = suiteFilter
  ? suiteFiles.filter(f => path.basename(f, '.js') === suiteFilter)
  : suiteFiles;

if (toRun.length === 0) {
  console.error(`No suite found: "${suiteFilter}"`);
  process.exit(1);
}

console.log('ClawCraft Live Tests');
console.log('Bot port: ' + PORT + '  Events: ' + EVENTS_FILE);
console.log('');

const status = await checkBotRunning();
console.log(`Bot connected. Position: ${JSON.stringify(status.pos)}  Uptime: ${status.uptime}s`);

// Wait for bot to have a valid position (set on spawn / add_player / move_player)
if (!status.pos) {
  process.stderr.write('Waiting for position...');
  const posDeadline = Date.now() + 30000;
  let got = false;
  while (Date.now() < posDeadline) {
    await sleep(1000);
    const s = await cmd('pos');
    if (s.pos) { process.stderr.write(` got it.\n`); got = true; break; }
    process.stderr.write('.');
  }
  if (!got) process.stderr.write(' TIMEOUT (tests needing position will fail)\n');
}

// Wait for sub-chunk block data to load (server sends after initialization)
await sleep(8000);

console.log('');

for (const file of toRun) {
  const suiteName = path.basename(file, '.js');
  console.log(`── ${suiteName} ──`);
  await import(path.join(SUITES_DIR, file));
  console.log('');
}

if (_botProc) {
  console.log('Stopping bot...');
  _botProc.kill('SIGTERM');
  await sleep(1000);
}

report();

  }; // end run
  run();
} // end isMain
