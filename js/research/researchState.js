import { record, safeKey } from "../conditions.js";
import { isAdditiveContract } from "./researchCatalog.js";
import { entityReference, referenceReason } from "../entityReferences.js";

export const JOURNAL_LIMIT = 100;
export const EXPOSURE_LIMIT = 100;
const check = (ok, detail) => { if (!ok) throw new Error(`Invalid research state: ${detail}. Save preserved.`); };
const count = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;

export function createResearchState(seed = 0x07B3A91D) {
  return { rng: seed, insight: {}, credits: {}, contracts: {}, exposure: {}, attempts: [], attemptCount: 0, legacyKnowledge: false };
}

export function validateResearchState(research, system, state) {
  const { catalog, content, world } = system;
  check(record(research), "missing record");
  for (const key of ["insight", "credits", "contracts", "exposure"]) check(record(research[key]), key);
  check(count(research.rng, 0xFFFFFFFF) && count(research.attemptCount) && typeof research.legacyKnowledge === "boolean", "counters/random state");
  for (const [id, value] of Object.entries(research.insight)) {
    check(safeKey(id) && Object.hasOwn(catalog.discoveries, id) && count(value, catalog.discoveries[id].thresholdUnits), `insight ${id}`);
    check(value < catalog.discoveries[id].thresholdUnits || state.knowledge.discoveries[id] === true, `ungranted discovery ${id}`);
    check(research.contracts[id] === catalog.contracts[id], `rules changed for ${id}; an explicit balance migration is required`);
  }
  for (const [key, uses] of Object.entries(research.credits)) {
    const credit = catalog.credits[key];
    check(safeKey(key) && !!credit && count(uses, credit.limit) && uses > 0 && uses <= research.attemptCount, `evidence ${key}`);
    check(research.insight[credit.discoveryId] > 0 && research.contracts[credit.discoveryId] === catalog.contracts[credit.discoveryId], `evidence contract ${key}`);
  }
  for (const [id, contract] of Object.entries(research.contracts)) check(Object.hasOwn(research.insight, id) && contract === catalog.contracts[id], `removed or changed discovery ${id}; explicit migration required`);
  for (const [id, exposure] of Object.entries(research.exposure)) check(Object.hasOwn(catalog.families, id) && count(exposure, EXPOSURE_LIMIT), `family ${id}`);
  check(Array.isArray(research.attempts) && research.attempts.length === Math.min(research.attemptCount, JOURNAL_LIMIT), "journal length");
  let lastTime = 0;
  for (const [index, attempt] of research.attempts.entries()) {
    check(record(attempt) && attempt.id === research.attemptCount - research.attempts.length + index + 1, "journal sequence");
    check(Object.hasOwn(catalog.methods, attempt.methodId) && (state.entities ? !referenceReason(state, attempt.locationId, "historyLocation") : world.definitions[attempt.locationId]?.kind === "site"), "journal method/location");
    check(attempt.locationName === undefined || typeof attempt.locationName === "string" && attempt.locationName.trim(), "journal location label");
    check(Number.isFinite(attempt.time) && attempt.time >= lastTime && attempt.time <= state.simulationTime, "journal time"); lastTime = attempt.time;
    check(Array.isArray(attempt.inputs) && attempt.inputs.length >= 1 && attempt.inputs.length <= 3 && new Set(attempt.inputs).size === attempt.inputs.length && attempt.inputs.every(id => Object.hasOwn(content.items, id)), "journal inputs");
    check(Array.isArray(attempt.observations) && attempt.observations.length > 0 && attempt.observations.length <= 32 && attempt.observations.every(text => typeof text === "string" && text.length > 0 && text.length <= 2000), "journal observations");
    check(Array.isArray(attempt.discoveries) && new Set(attempt.discoveries).size === attempt.discoveries.length && attempt.discoveries.every(id => Object.hasOwn(catalog.discoveries, id) && state.knowledge.discoveries[id] === true), "journal discoveries");
  }
}

export function applyResearchResult(state, context, result) {
  const research = state.research;
  if (research.attemptCount >= Number.MAX_SAFE_INTEGER) throw new Error("Research attempt counter is full.");
  Object.assign(research.insight, result.insight);
  Object.assign(research.credits, result.credits);
  Object.assign(research.contracts, result.contracts);
  research.rng = result.rng;
  for (const [id, weight] of Object.entries(result.families)) research.exposure[id] = Math.min(EXPOSURE_LIMIT, (research.exposure[id] ?? 0) + weight);
  research.attemptCount += 1;
  research.attempts.push({ id: research.attemptCount, time: context.simulationTime, locationId: context.locationId, ...(context.locationName ? { locationName: context.locationName } : {}),
    methodId: context.methodId, inputs: context.profile.samples.map(item => item.id), observations: result.observations.slice(0, 32), discoveries: [...result.discoveries] });
  research.attempts = research.attempts.slice(-JOURNAL_LIMIT);
}

// Removed IDs must remain as retired definitions or be explicitly migrated.
export function reconcileResearchContent(state, system) {
  if (record(state.research?.contracts)) for (const [id, previous] of Object.entries(state.research.contracts)) {
    const current = system.catalog.contracts[id];
    if (current && isAdditiveContract(previous, current)) state.research.contracts[id] = current;
  }
  validateResearchState(state.research, system, state);
}

export function collectResearchReferences(state) {
  return state.research.attempts.map(a => entityReference(`research.attempts.${a.id}.locationId`, a.locationId, "historyLocation"));
}
