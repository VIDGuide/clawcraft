import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import net from 'net';
import fs from 'fs';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const botPath = join(__dirname, '..', 'src', 'bot.js');
const cmdScript = join(__dirname, '..', 'scripts', 'cmd.js');
const eventsScript = join(__dirname, '..', 'scripts', 'events.js');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function spawnBot(tcpPort, eventsFile) {
  return spawn('node', [botPath], {
    env: {
      ...process.env,
      HOST: '127.0.0.1', PORT: '1', OFFLINE: 'true',
      CLAWCRAFT_PORT: String(tcpPort),
      CLAWCRAFT_EVENTS: eventsFile,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function waitForStartup(eventsFile, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const check = () => {
      if (!fs.existsSync(eventsFile)) {
        if (Date.now() > deadline) return reject(new Error('Timed out waiting for events file'));
        return setTimeout(check, 100);
      }
      const content = fs.readFileSync(eventsFile, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      const startup = lines.find(l => { try { return JSON.parse(l).type === 'startup'; } catch { return false; } });
      if (startup) return resolve(JSON.parse(startup));
      if (Date.now() > deadline) return reject(new Error('Timed out waiting for startup event'));
      setTimeout(check, 100);
    };
    check();
  });
}

function runScript(scriptPath, args, env = {}) {
  return new Promise((resolve) => {
    const proc = spawn('node', [scriptPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);
    proc.on('close', (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

describe('skill integration', () => {
  it('TCP server responds to status command', async () => {
    const port = await getFreePort();
    const eventsFile = join(os.tmpdir(), `clawcraft-test-${port}.jsonl`);
    const proc = spawnBot(port, eventsFile);
    try {
      await waitForStartup(eventsFile);
      const result = await runScript(cmdScript, [JSON.stringify({ action: 'status' })], {
        CLAWCRAFT_PORT: String(port),
      });
      assert.equal(result.code, 0, 'cmd.js should exit 0');
      const resp = JSON.parse(result.stdout);
      assert.equal(resp.type, 'response');
      assert.ok('uptime' in resp);
      assert.ok('chunks' in resp);
    } finally {
      proc.kill();
      try { fs.unlinkSync(eventsFile); } catch {}
    }
  });

  it('TCP: unknown action returns error response', async () => {
    const port = await getFreePort();
    const eventsFile = join(os.tmpdir(), `clawcraft-test-${port}.jsonl`);
    const proc = spawnBot(port, eventsFile);
    try {
      await waitForStartup(eventsFile);
      const result = await runScript(cmdScript, [JSON.stringify({ action: 'explode' })], {
        CLAWCRAFT_PORT: String(port),
      });
      assert.equal(result.code, 0);
      const resp = JSON.parse(result.stdout);
      assert.ok(resp.error.includes('Unknown action'));
    } finally {
      proc.kill();
      try { fs.unlinkSync(eventsFile); } catch {}
    }
  });

  it('cmd.js exits 1 with BOT_NOT_RUNNING when no bot', async () => {
    const port = await getFreePort();
    const result = await runScript(cmdScript, [JSON.stringify({ action: 'status' })], {
      CLAWCRAFT_PORT: String(port),
    });
    assert.equal(result.code, 1);
    const err = JSON.parse(result.stderr);
    assert.equal(err.error, 'BOT_NOT_RUNNING');
  });

  it('startup event is written to events file', async () => {
    const port = await getFreePort();
    const eventsFile = join(os.tmpdir(), `clawcraft-test-${port}.jsonl`);
    const proc = spawnBot(port, eventsFile);
    try {
      const startup = await waitForStartup(eventsFile);
      assert.equal(startup.type, 'startup');
      assert.equal(startup.version, '0.5.0');
      assert.ok(typeof startup.timestamp === 'number');
    } finally {
      proc.kill();
      try { fs.unlinkSync(eventsFile); } catch {}
    }
  });

  it('command responses are NOT written to events file', async () => {
    const port = await getFreePort();
    const eventsFile = join(os.tmpdir(), `clawcraft-test-${port}.jsonl`);
    const proc = spawnBot(port, eventsFile);
    try {
      await waitForStartup(eventsFile);
      await runScript(cmdScript, [JSON.stringify({ action: 'status' })], {
        CLAWCRAFT_PORT: String(port),
      });
      const lines = fs.readFileSync(eventsFile, 'utf8').split('\n').filter(Boolean);
      const events = lines.map(l => JSON.parse(l));
      const responses = events.filter(e => e.type === 'response');
      assert.equal(responses.length, 0, 'No response-type entries should be in the event file');
    } finally {
      proc.kill();
      try { fs.unlinkSync(eventsFile); } catch {}
    }
  });

  it('events.js returns empty array for missing file', async () => {
    const result = await runScript(eventsScript, [], {
      CLAWCRAFT_EVENTS: '/tmp/clawcraft-nonexistent-file.jsonl',
    });
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse(result.stdout), []);
  });

  it('events.js filters by --since', async () => {
    const eventsFile = join(os.tmpdir(), `clawcraft-events-test-${Date.now()}.jsonl`);
    try {
      const now = Date.now();
      fs.writeFileSync(eventsFile, [
        JSON.stringify({ type: 'msg', timestamp: now - 2000 }),
        JSON.stringify({ type: 'msg', timestamp: now - 500 }),
        JSON.stringify({ type: 'msg', timestamp: now + 500 }),
      ].join('\n') + '\n');

      const result = await runScript(eventsScript, ['--since', String(now - 1000)], {
        CLAWCRAFT_EVENTS: eventsFile,
      });
      assert.equal(result.code, 0);
      const events = JSON.parse(result.stdout);
      assert.equal(events.length, 2);
      assert.ok(events.every(e => e.timestamp > now - 1000));
    } finally {
      try { fs.unlinkSync(eventsFile); } catch {}
    }
  });

  it('events.js filters by --last', async () => {
    const eventsFile = join(os.tmpdir(), `clawcraft-events-test-${Date.now()}.jsonl`);
    try {
      const lines = Array.from({ length: 10 }, (_, i) =>
        JSON.stringify({ type: 'msg', i, timestamp: Date.now() + i }),
      ).join('\n') + '\n';
      fs.writeFileSync(eventsFile, lines);

      const result = await runScript(eventsScript, ['--last', '3'], {
        CLAWCRAFT_EVENTS: eventsFile,
      });
      assert.equal(result.code, 0);
      const events = JSON.parse(result.stdout);
      assert.equal(events.length, 3);
      assert.equal(events[0].i, 7);
      assert.equal(events[2].i, 9);
    } finally {
      try { fs.unlinkSync(eventsFile); } catch {}
    }
  });
});
