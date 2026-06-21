#!/usr/bin/env node
/**
 * ClawMine — Read events from the bot's event log.
 * Usage:
 *   node scripts/events.js --since <timestamp_ms>   # events after this time
 *   node scripts/events.js --last <N>               # last N events
 *   node scripts/events.js --follow                 # tail mode: print new events as they arrive
 *   node scripts/events.js                          # all events
 *
 * Environment:
 *   CLAWMINE_EVENTS  Path to the bot's JSONL event file (default: ./events.jsonl)
 *
 * Output: JSON array of matching events on stdout (or one JSON object per line in --follow)
 */
import fs from 'fs';

const EVENTS_FILE = process.env.CLAWMINE_EVENTS || './events.jsonl';
const args = process.argv.slice(2);

let since = null;
let last = null;
let follow = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--since' && args[i + 1]) since = parseInt(args[++i]);
  if (args[i] === '--last' && args[i + 1]) last = parseInt(args[++i]);
  if (args[i] === '--follow') follow = true;
}

if (!fs.existsSync(EVENTS_FILE)) {
  if (!follow) {
    console.log(JSON.stringify([]));
    process.exit(0);
  }
}

function readLines(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

const lines = readLines(EVENTS_FILE);

let events = lines
  .map(line => { try { return JSON.parse(line); } catch { return null; } })
  .filter(Boolean);

if (since !== null) events = events.filter(e => (e.timestamp ?? 0) > since);
if (last !== null) events = events.slice(-last);

if (!follow) {
  console.log(JSON.stringify(events));
  process.exit(0);
}

// ── Follow mode: print existing events then tail for new ones ──

for (const e of events) {
  process.stdout.write(JSON.stringify(e) + '\n');
}

let filePos = fs.existsSync(EVENTS_FILE) ? fs.statSync(EVENTS_FILE).size : 0;
let partial = '';

setInterval(() => {
  if (!fs.existsSync(EVENTS_FILE)) {
    filePos = 0;
    partial = '';
    return;
  }

  const stat = fs.statSync(EVENTS_FILE);

  // File was rotated/truncated — reset position
  if (stat.size < filePos) {
    filePos = 0;
    partial = '';
  }

  if (stat.size <= filePos) return;

  // Read new bytes
  const buf = Buffer.alloc(stat.size - filePos);
  const fd = fs.openSync(EVENTS_FILE, 'r');
  fs.readSync(fd, buf, 0, buf.length, filePos);
  fs.closeSync(fd);
  filePos = stat.size;

  const chunk = partial + buf.toString('utf8');
  const nlIdx = chunk.lastIndexOf('\n');
  if (nlIdx === -1) {
    partial = chunk;
    return;
  }

  partial = chunk.slice(nlIdx + 1);
  const newLines = chunk.slice(0, nlIdx).split('\n').filter(Boolean);

  for (const line of newLines) {
    try {
      const ev = JSON.parse(line);
      if (since !== null && (ev.timestamp ?? 0) <= since) continue;
      process.stdout.write(JSON.stringify(ev) + '\n');
    } catch { /* skip malformed */ }
  }
}, 100);
