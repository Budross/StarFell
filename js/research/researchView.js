import { getLocationContext } from "../locations.js";
import { conditionReason } from "../conditionContext.js";
import { previewExperiment } from "./researchActions.js";
import { researchHint } from "./researchContext.js";
import { sampleQuantity } from "../quantities.js";
import { usefulResearchSamples } from "./researchAvailability.js";

// Read-only presentation inputs. Eligibility changes belong here, not in a DOM
// cache signature that must know every field a future condition may inspect.
export function researchInputView(state, system, payload) {
  const local = getLocationContext(state, system.content, system.world);
  const definition = system.catalog.methods[payload.methodId];
  const useful = usefulResearchSamples(state, system, payload.methodId);
  const selected = new Set(payload.items.filter(id => useful.has(id)));
  const canExperiment = ["viewCargo", "useFacilities", "withdrawCargo"].every(p => local.permissions[p]);
  const facility = !canExperiment ? "Local inventory and equipment are private. Your journal remains available."
    : !definition || conditionReason(local.actionState, definition.conditions, system.content, { root: state })
      ? definition?.blockedReason ?? "No experiment method is available."
      : `${definition.name} available · ${Object.keys(definition.cost).length ? "Operating costs are included in the preview." : "No power needed."}`;
  const samples = Object.keys(system.content.items).map(id => {
    const amount = local.permissions.viewCargo ? local.store.resources[id] ?? 0 : 0;
    const required = sampleQuantity(id, system.content);
    return { id, amount, required, selected: selected.has(id), hidden: !useful.has(id),
      disabled: !useful.has(id) || (!selected.has(id) && selected.size >= (definition?.maxSamples ?? 3)) };
  });
  const preview = previewExperiment(state, system, { ...payload, items: [...selected] });
  return { locationName: local.definition.name, owned: local.owned, canExperiment, facility, samples,
    cost: preview.cost, reason: preview.reason, families: preview.context?.profile.families ?? {},
    hint: researchHint(state, system) };
}
