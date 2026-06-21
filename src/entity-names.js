/**
 * ClawMine — Entity type name resolver
 *
 * Maps numeric entity type IDs (from add_entity packets) to human-readable names.
 * Uses minecraft-data bedrock entity data, keyed by internalId.
 * Pure logic, no I/O.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const entityMap = new Map(); // internalId → { name, displayName, category }

try {
  const entities = require('minecraft-data/minecraft-data/data/bedrock/1.21.80/entities.json');
  for (const e of entities) {
    if (!entityMap.has(e.internalId)) {
      entityMap.set(e.internalId, {
        name: e.name,
        displayName: e.displayName || e.name,
        category: e.type || 'unknown',
      });
    }
  }
} catch { /* graceful fallback */ }

/**
 * Resolve a numeric entity type to name info.
 * @param {number} numericId - entity_type from add_entity packet
 * @returns {{ name: string, displayName: string, category: string } | null}
 */
export function resolveEntityType(numericId) {
  return entityMap.get(numericId) ?? null;
}

/**
 * Get the broad category of an entity type.
 * @returns {'hostile'|'neutral'|'passive'|'animal'|'ambient'|'unknown'}
 */
export function getEntityCategory(numericId) {
  return entityMap.get(numericId)?.category ?? 'unknown';
}

/** True if the entity type is hostile (attacks unprovoked). */
export function isHostile(numericId) {
  return entityMap.get(numericId)?.category === 'hostile';
}
