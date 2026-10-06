import { record, validId, validateConditions, conditionContracts } from './conditions.js';

export function validateLearningPolicy(policy, refs = {}, path = 'learning policy') {
  if (policy === undefined) return;
  if (!record(policy) || Object.keys(policy).some(k => !['onEncounter','conditions'].includes(k)) ||
    !Object.keys(policy).length || policy.onEncounter !== undefined && typeof policy.onEncounter !== 'boolean' ||
    policy.onEncounter !== true && policy.conditions === undefined)
    throw new Error(`Invalid ${path}.`);
  if (policy.conditions !== undefined) {
    validateConditions(policy.conditions,{...refs,contract:conditionContracts.learning},`${path}.conditions`);
  }
}
export function validateKnowledgeEntry(entry, refs = {}, path = 'knowledge entry') {
  if (entry === undefined) return;
  if (!record(entry) || Object.keys(entry).some(k => !['summary','learnWhen','notes'].includes(k)) ||
    entry.summary !== undefined && (typeof entry.summary !== 'string' || !entry.summary.trim()) ||
    entry.notes !== undefined && !Array.isArray(entry.notes)) throw new Error(`Invalid ${path}.`);
  validateLearningPolicy(entry.learnWhen,refs,`${path}.learnWhen`);
  const ids = new Set();
  for (const note of entry.notes ?? []) {
    if (!record(note) || Object.keys(note).some(k => !['id','title','text','learnWhen'].includes(k)) || !validId(note.id) ||
      ids.has(note.id) || !['title','text'].every(k => typeof note[k] === 'string' && note[k].trim())) throw new Error(`Invalid ${path} note.`);
    ids.add(note.id); validateLearningPolicy(note.learnWhen,refs,`${path}.${note.id}.learnWhen`);
  }
}
