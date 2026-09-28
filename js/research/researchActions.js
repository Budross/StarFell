import { record } from "../conditions.js";
import { conditionReason } from "../conditionContext.js";
import { getLocationContext } from "../locations.js";
import { canPay, pay } from "../resources.js";
import { sampleQuantity, checkedAdd } from "../quantities.js";
import { grantDiscovery } from "../knowledge.js";
import { buildResearchContext } from "./researchContext.js";
import { collectEvidence, resolveExperiment } from "./researchEngine.js";
import { applyResearchResult } from "./researchState.js";
import { applyEffects } from "../effects.js";

// Preview matches evidence but never resolves an experiment or draws randomness.
export function previewExperiment(state, system, payload) {
  const { content, world, catalog } = system;
  const local = getLocationContext(state, content, world);
  const fail = reason => ({ reason, cost: {}, context: null });
  if (!["viewCargo", "useFacilities", "withdrawCargo"].every(p => local.permissions[p])) return fail("Requires research and cargo permissions (ownership or grants). Local inventory and equipment are private.");
  if (!record(payload) || Object.keys(payload).some(key => !["methodId", "items"].includes(key))) return fail("Choose a method and one to three distinct samples in Research.");
  const method = Object.hasOwn(catalog.methods, payload.methodId) ? catalog.methods[payload.methodId] : null;
  if (!method || method.retired) return fail("Choose an available experiment method.");
  if (conditionReason(local.actionState, method.conditions, content, { root: state })) return fail(method.blockedReason);
  const items = payload.items;
  if (!Array.isArray(items) || items.length < method.minSamples || items.length > method.maxSamples ||
    items.some(id => typeof id !== "string" || !Object.hasOwn(content.items, id)) || new Set(items).size !== items.length) return fail(`Choose ${method.minSamples}–${method.maxSamples} distinct inventory samples. Power and installed equipment are not samples.`);
  const cost = { ...method.cost };
  for (const id of items) cost[id] = checkedAdd(cost[id] ?? 0, sampleQuantity(id, content));
  if (!canPay(local.store, cost, content)) return { reason: "The selected experiment requires more local samples or power. Nothing was spent.", cost, context: null };
  const context = buildResearchContext(state, system, method.id, items);
  const informative = collectEvidence(catalog, context, state.research).length > 0;
  return { cost, context, reason: informative ? "" : "This setup offers no new evidence. Related setups share their evidence limit. Change materials or use a relevant new clue or capability. Nothing was spent." };
}

export function executeExperiment(state, system, payload, effectServices, ledgerServices) {
  const preview = previewExperiment(state, system, payload);
  if (preview.reason) throw new Error(preview.reason);
  const result = resolveExperiment(system.catalog, preview.context, state.research);
  const trigger = { kind: "research", locationId: preview.context.locationId, actorId: 'player' };
  const learned = result.discoveries.filter(id => state.knowledge.discoveries[id] !== true).sort();
  if (state.research.attemptCount >= Number.MAX_SAFE_INTEGER) throw new Error("Research attempt counter is full.");
  pay(getLocationContext(state, system.content, system.world).store, preview.cost, system.content);
  applyResearchResult(state, preview.context, result);
  // Grant the entire experiment result before rewards; generic discover never invokes rewards.
  learned.forEach(id => grantDiscovery(state, id));
  for (const discoveryId of learned) ledgerServices?.append(state, {
    type: 'RESEARCH_COMPLETED', actorId: 'player', locationId: trigger.locationId,
    areaId: state.locations[trigger.locationId].areaId,
    data: { discoveryId, methodId: preview.context.methodId, attemptId: state.research.attemptCount }
  });
  try { learned.forEach(id => applyEffects(state, system.catalog.discoveries[id].effects, effectServices, trigger)); }
  catch (error) { throw new Error(`Experiment could not be completed: ${error.message} Nothing was spent.`, { cause: error }); }
  return [...result.observations.slice(0, 3), ...(learned.length ? [`Discovered: ${learned.map(id => system.catalog.discoveries[id].name).join(", ")}.`] : ["Observations recorded. Your research has advanced."])].join(" ");
}

export function createResearchActions(system, effectServices, ledgerServices) {
  return [{ id: "research:experiment", name: "Run bench experiment", group: "research", access: "managed",
    scope: "global", permissions: ["useFacilities", "withdrawCargo", "viewCargo"],
    visible: (_state, context) => context.definition.kind === "site",
    requirement: (state, _context, payload) => previewExperiment(state, system, payload).reason,
    execute: (state, _context, payload) => executeExperiment(state, system, payload, effectServices, ledgerServices) }];
}
