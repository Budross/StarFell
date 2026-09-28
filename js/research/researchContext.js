import { conditionReason } from "../conditionContext.js";
import { getLocationContext } from "../locations.js";
import { buildResearchProfile } from "./researchProfile.js";

export function buildResearchContext(state, system, methodId, itemIds) {
  const { content, world, catalog } = system;
  const local = getLocationContext(state, content, world);
  return {
    locationId: state.locationId, locationName: local.definition.name, methodId, simulationTime: state.simulationTime,
    discoveries: { ...state.knowledge.discoveries },
    predicates: Object.fromEntries(Object.entries(catalog.predicates).map(([id, condition]) =>
      [id, !conditionReason(local.actionState, condition, content, { root: state })])),
    profile: buildResearchProfile(itemIds.map(id => content.items[id]), catalog.affinities)
  };
}

export function researchHint(state, system) {
  const local = getLocationContext(state, system.content, system.world);
  return system.catalog.hints.find(hint => !conditionReason(local.actionState, hint.conditions, system.content, { root: state }))?.text ??
    "You have explored the current bench discoveries. New materials, clues, and equipment can open further research as they become available.";
}
