import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const botPath = join(__dirname, '..', 'src', 'bot.js');

function spawnBot() {
  const proc = spawn('node', [botPath], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: '1', OFFLINE: 'true' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return proc;
}

function readLines(proc, count, timeout = 1000) {
  return new Promise((resolve, reject) => {
    const lines = [];
    let buf = '';
    const timer = setTimeout(() => resolve(lines), timeout);
    proc.stdout.on('data', (d) => {
      buf += d.toString();
      while (buf.includes('\n')) {
        const [line, ...rest] = buf.split('\n');
        buf = rest.join('\n');
        if (line.trim()) lines.push(JSON.parse(line));
        if (lines.length >= count) {
          clearTimeout(timer);
          resolve(lines);
        }
      }
    });
    proc.on('error', reject);
  });
}

describe('handle() integration', () => {
  it('emits startup event on launch', async () => {
    const proc = spawnBot();
    try {
      const lines = await readLines(proc, 1);
      assert.equal(lines[0].type, 'startup');
      assert.equal(lines[0].version, '0.4.0');
    } finally {
      proc.kill();
    }
  });

  it('responds to pos command', async () => {
    const proc = spawnBot();
    try {
      // Wait for startup
      await readLines(proc, 1);
      proc.stdin.write('{"action":"pos"}\n');
      const lines = await readLines(proc, 2);
      const resp = lines.find(l => l.type === 'response');
      assert.ok(resp, 'Should get a response');
      assert.ok('pos' in resp);
    } finally {
      proc.kill();
    }
  });

  it('rejects invalid commands', async () => {
    const proc = spawnBot();
    try {
      await readLines(proc, 1);
      proc.stdin.write('{"foo":"bar"}\n');
      const lines = await readLines(proc, 2);
      const resp = lines.find(l => l.error);
      assert.ok(resp);
      assert.ok(resp.error.includes('action'));
    } finally {
      proc.kill();
    }
  });

  it('rejects non-numeric coordinates', async () => {
    const proc = spawnBot();
    try {
      await readLines(proc, 1);
      proc.stdin.write('{"action":"block","x":"abc","y":0,"z":0}\n');
      const lines = await readLines(proc, 2);
      const resp = lines.find(l => l.error);
      assert.ok(resp);
      assert.ok(resp.error.includes('number'));
    } finally {
      proc.kill();
    }
  });

  it('handles unknown actions gracefully', async () => {
    const proc = spawnBot();
    try {
      await readLines(proc, 1);
      proc.stdin.write('{"action":"explode"}\n');
      const lines = await readLines(proc, 2);
      const resp = lines.find(l => l.type === 'response');
      assert.ok(resp.error.includes('Unknown action'));
    } finally {
      proc.kill();
    }
  });

  it('ignores malformed JSON', async () => {
    const proc = spawnBot();
    try {
      await readLines(proc, 1);
      proc.stdin.write('not json at all\n');
      proc.stdin.write('{"action":"pos"}\n');
      const lines = await readLines(proc, 2);
      // Should still get the pos response (malformed line ignored)
      const resp = lines.find(l => l.type === 'response');
      assert.ok(resp);
    } finally {
      proc.kill();
    }
  });
});
