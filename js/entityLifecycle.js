import { getEntity, isTerminal, lifecycles } from "./entities.js";
import { getEntityLabel, getEntityLocation } from "./entityQueries.js";
import { referencesTo } from "./entityReferences.js";
import { stateReferenceCollectors } from "./entityComposition.js";
import { permissionReason } from "./authority.js";

export function previewEntityTransition(state, id, lifecycle, systems, { actorId } = {}) {
  const entity = getEntity(state, id), blockers = [];
  if (!entity) blockers.push(`Unknown entity ${id}.`);
  else if (id === "player") blockers.push("Player lifecycle changes are not supported.");
  else if (!lifecycles.includes(lifecycle) || isTerminal(entity) || lifecycle === entity.lifecycle) blockers.push("Unsupported lifecycle transition.");
  if (actorId !== undefined) {
    const reason = permissionReason(state, actorId, id, "manageLifecycle");
    if (reason) blockers.push(reason);
  }
  const references = referencesTo(state, id, systems?.referenceCollectors ?? stateReferenceCollectors);
  if (lifecycle !== "active") {
    for (const ref of references.filter(r => r.policy === "block")) blockers.push(`${ref.source} must be resolved before ${id} becomes ${lifecycle}.`);
    if (state.locations[id]?.journey) blockers.push(`The journey of ${id} must be cancelled or completed first.`);
  }
  if (lifecycle === "active" && entity?.lifecycle === "inactive") {
    for (const target of [state.locations[id]?.areaId, state.locations[id]?.dockedAtId, state.npcs[id]?.locationId].filter(Boolean)) {
      if (getEntity(state, target)?.lifecycle !== "active") blockers.push(`Placement target ${target} is unavailable.`);
    }
  }
  return { allowed: blockers.length === 0, blockers, references, lifecycle, id };
}
// Trusted orchestration API. Domain resolutions run explicitly on the same
// candidate before this call (relocate NPC, cancel journey, undock, etc.).
export function transitionEntity(state, id, lifecycle, systems, options = {}) {
  const preview = previewEntityTransition(state, id, lifecycle, systems, options);
  if (!preview.allowed) throw new Error(preview.blockers.join(" "));
  const e = getEntity(state, id);
  if (["destroyed", "retired"].includes(lifecycle)) e.retained = { name: getEntityLabel(state, systems, id), location: getEntityLocation(state, id) };
  e.lifecycle = lifecycle; e.lifecycleChangedAt = state.simulationTime;
  e.lifecycleReason = options.reason ?? "";
  if (typeof e.lifecycleReason !== "string") throw new Error("Invalid lifecycle reason.");
  const active = state.dialogue.active;
  if (lifecycle !== "active" && active && [active.npcId, active.locationId].includes(id)) state.dialogue.active = null;
  return preview;
}
export const activateEntity = (state, id, systems, options) => transitionEntity(state, id, "active", systems, options);
export const deactivateEntity = (state, id, systems, options) => transitionEntity(state, id, "inactive", systems, options);
export const destroyEntity = (state, id, systems, options) => transitionEntity(state, id, "destroyed", systems, options);
export const retireEntity = (state, id, systems, options) => transitionEntity(state, id, "retired", systems, options);
export function deletionAssessment(state, id, systems) {
  return { allowed: false, references: referencesTo(state, id, systems?.referenceCollectors ?? stateReferenceCollectors),
    reason: "Hard deletion is unsupported. Retain the identity and retire the entity; assets and historical references must survive." };
}
