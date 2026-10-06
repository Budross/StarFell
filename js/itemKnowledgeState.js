import { record, validId, safeKey } from './conditions.js';
import { entityReference } from './entityReferences.js';

export function initializeItemKnowledge(state) { state.knowledge.itemEntries = {}; }
export function validateItemKnowledge(state) {
  const entries = state.knowledge.itemEntries;
  if (!record(entries)) throw new Error('Invalid item journal.');
  for (const [id, entry] of Object.entries(entries)) {
    if (!validId(id) || !record(entry) || Object.keys(entry).some(k => !['known','facts'].includes(k)) ||
      entry.known !== true || !record(entry.facts) || Object.entries(entry.facts).some(([key,value]) =>
        !safeKey(key) || !/^[A-Za-z0-9_:-]+$/.test(key) || value !== true)) throw new Error(`Invalid item entry ${id}.`);
    for (const key of Object.keys(entry.facts)) if (key.startsWith('node:') || key.startsWith('source:') || key.startsWith('evidence:')) {
      const parts = key.split(':');
      if (parts.length !== 3 || !validId(parts[1]) || !validId(parts[2])) throw new Error('Invalid item source record.');
    }
  }
}
export function encounterItem(state, id) {
  if (!state.knowledge?.itemEntries) return false; // Frozen pre-journal migrations.
  if (!validId(id)) throw new Error('Invalid encountered item.');
  if (Object.hasOwn(state.knowledge.itemEntries,id)) return false;
  state.knowledge.itemEntries[id] = { known: true, facts: {} };
  return true;
}
export function learnItemFact(state, id, key) {
  let changed = encounterItem(state,id);
  const entry = state.knowledge.itemEntries[id];
  if (!entry.facts[key]) { entry.facts[key] = true; changed = true; }
  return changed;
}
export function collectItemKnowledgeReferences(state) {
  return Object.entries(state.knowledge?.itemEntries ?? {}).flatMap(([id,entry]) => Object.keys(entry.facts).filter(k =>
    k.startsWith('node:') || k.startsWith('source:') || k.startsWith('evidence:')).map(key => entityReference(`knowledge.itemEntries.${id}.${key}`,key.split(':')[1],'historyLocation')));
}
