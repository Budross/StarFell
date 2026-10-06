import { getLocationContext } from "../locations.js";
import { sampleQuantity } from "../quantities.js";
import { buildResearchContext } from "./researchContext.js";
import { buildResearchProfile } from "./researchProfile.js";
import { collectEvidence } from "./researchEngine.js";

const cache = new WeakMap();

// Visibility follows evidence, not affordability of operating costs. The preview
// still explains missing power, and inventory from other locations is never used.
export function usefulResearchSamples(state, system, methodId) {
  const local = getLocationContext(state, system.content, system.world);
  const method = system.catalog.methods[methodId];
  if (!method || method.retired || !["viewCargo", "useFacilities", "withdrawCargo"].every(p => local.permissions[p])) return new Set();
  const items = Object.keys(system.content.items).filter(id =>
    (local.store.resources[id] ?? 0) >= sampleQuantity(id, system.content));
  const context = buildResearchContext(state, system, methodId, []);
  const signature = JSON.stringify([methodId, method.minSamples, method.maxSamples, items,
    context.predicates, context.discoveries, state.research.credits]);
  const previous = cache.get(system);
  if (previous?.signature === signature) return new Set(previous.useful);
  const useful = new Set();
  if (context.predicates[method.predicate]) {
    const evidenceCache = new Map();
    function evidence(ids) {
      const key = ids.join("\u0000");
      if (!evidenceCache.has(key)) evidenceCache.set(key, collectEvidence(system.catalog, {
        ...context, profile: buildResearchProfile(ids.map(id => system.content.items[id]), system.catalog.affinities)
      }, state.research));
      return evidenceCache.get(key);
    }
    function visit(ids, start) {
      if (ids.length >= method.minSamples) {
        const matches = evidence(ids);
        if (matches.length) ids.forEach((id, index) => {
          if (useful.has(id)) return;
          const without = ids.filter((_, i) => i !== index);
          // Removing a sample must lose an evidence route (including a stronger
          // variant), or fail the method's minimum physical sample count.
          if (without.length < method.minSamples || matches.some(match =>
            !evidence(without).some(other => other.key === match.key))) useful.add(id);
        });
      }
      if (ids.length === method.maxSamples || useful.size === items.length) return;
      for (let i = start; i < items.length; i++) visit([...ids, items[i]], i + 1);
    }
    visit([], 0);
  }
  cache.set(system, { signature, useful });
  return new Set(useful);
}
