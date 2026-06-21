/**
 * ClawMine — Emote lookup
 *
 * Maps Bedrock emote UUIDs to human-readable titles using the community
 * dataset from TwistedAsylumMC/Bedrock-Emotes (auto-updated every 6h).
 *
 * Update: curl -sL https://raw.githubusercontent.com/TwistedAsylumMC/Bedrock-Emotes/main/emotes.json \
 *           -o data/emotes.json
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EMOTES_PATH = join(__dirname, '..', 'data', 'emotes.json');

let uuidToTitle = new Map();   // uuid → title
let titleToUuid = new Map();   // lowercase title → uuid (first match)

function load() {
  if (!existsSync(EMOTES_PATH)) return;
  try {
    const entries = JSON.parse(readFileSync(EMOTES_PATH, 'utf8'));
    uuidToTitle = new Map();
    titleToUuid = new Map();
    for (const e of entries) {
      uuidToTitle.set(e.uuid, e.title);
      const key = e.title.toLowerCase();
      if (!titleToUuid.has(key)) titleToUuid.set(key, e.uuid);
    }
  } catch {}
}

load();

/**
 * Get a human-readable emote title for a UUID.
 * Returns the title (e.g. "Facepalm") or null if unknown.
 */
export function titleFor(uuid) {
  return uuidToTitle.get(uuid) ?? null;
}

/**
 * Get a UUID for an emote name (case-insensitive fuzzy match).
 * Returns the UUID or null if not found.
 */
export function uuidFor(name) {
  const key = name.toLowerCase();
  // Exact match first
  if (titleToUuid.has(key)) return titleToUuid.get(key);
  // Fuzzy: find first title that includes the search term
  for (const [title, uuid] of titleToUuid) {
    if (title.includes(key)) return uuid;
  }
  return null;
}

/** Number of emotes loaded. */
export function count() {
  return uuidToTitle.size;
}
