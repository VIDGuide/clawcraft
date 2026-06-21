#!/usr/bin/env node
/**
 * ClawMine — Read events from the bot's event log.
 * Usage:
 *   node scripts/events.js --since <timestamp_ms>   # events after this time
 *   node scripts/events.js --last <N>               # last N events
 *   node scripts/events.js                          # all events
 *
 * Environment:
 *   CLAWMINE_EVENTS  Path to the bot's JSONL event file (default: ./events.jsonl)
 *
 * Output: JSON array of matching events on stdout
 *
 * TODO: Add --follow flag for real-time tail mode (future enhancement)
 */
import fs from 'fs';

const EVENTS_FILE = process.env.CLAWMINE_EVENTS || './events.jsonl';
const args = process.argv.slice(2);

let since = null;
let last = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--since' && args[i + 1]) since = parseInt(args[++i]);
  if (args[i] === '--last' && args[i + 1]) last = parseInt(args[++i]);
}

if (!fs.existsSync(EVENTS_FILE)) {
  console.log(JSON.stringify([]));
  process.exit(0);
}

const lines = fs.readFileSync(EVENTS_FILE, 'utf8').split('\n').filter(Boolean);

let events = lines
  .map(line => { try { return JSON.parse(line); } catch { return null; } })
  .filter(Boolean);

if (since !== null) events = events.filter(e => (e.timestamp ?? 0) > since);
if (last !== null) events = events.slice(-last);

console.log(JSON.stringify(events));
process.exit(0);
