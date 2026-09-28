import { getEntity, lifecycles } from "./entities.js";

export const roles = {
  occupant: { types: ["site", "ship"], lifecycle: ["active"], policy: "block" },
  area: { types: ["area"], lifecycle: ["active"], policy: "block" },
  dock: { types: ["site"], lifecycle: ["active"], policy: "block" },
  destination: { types: ["area", "site"], lifecycle: ["active"], policy: "block" },
  contactNpc: { types: ["npc"], lifecycle: ["active"], policy: "closeContact" },
  contactLocation: { types: ["site", "ship"], lifecycle: ["active"], policy: "closeContact" },
  principal: { types: ["npc", "principal"], lifecycle: lifecycles, policy: "retain" },
  historyNpc: { types: ["npc"], lifecycle: lifecycles, policy: "retain" },
  historyLocation: { types: ["site", "ship"], lifecycle: lifecycles, policy: "retain" },
  historyArea: { types: ["area"], lifecycle: lifecycles, policy: "retain" },
  historyContainer: { types: ["area", "site", "ship"], lifecycle: lifecycles, policy: "retain" },
  historyEntity: { types: ["area", "site", "ship", "npc", "principal"], lifecycle: lifecycles, policy: "retain" },
  content: { types: ["area", "site", "ship", "npc", "principal"], lifecycle: lifecycles, policy: "retain" }
};
export function referenceReason(state, targetId, role) {
  const rule = roles[role], target = getEntity(state, targetId);
  if (!rule) return `Unknown reference role ${role}.`;
  if (!target) return `Missing entity ${targetId}.`;
  if (!rule.types.includes(target.type)) return `Wrong entity type for ${role}: ${targetId}.`;
  if (!rule.lifecycle.includes(target.lifecycle)) return `Unavailable ${role} target ${targetId}.`;
  return "";
}
export function entityReference(source, targetId, role, sourceId = null) { return { source, targetId, role, sourceId, ...roles[role] }; }
export function collectEntityReferences(state, collectors) { return collectors.flatMap(collect => collect(state)); }
export function validateEntityReferences(state, collectors) {
  for (const ref of collectEntityReferences(state, collectors)) {
    const reason = referenceReason(state, ref.targetId, ref.role);
    if (reason) throw new Error(`Invalid reference at ${ref.source}: ${reason}`);
  }
}
export function referencesTo(state, id, collectors) { return collectEntityReferences(state, collectors).filter(ref => ref.targetId === id); }
export function collectAuthorityReferences(state) {
  return Object.values(state.entities).flatMap(e => [
    ...["ownerId", "controllerId"].filter(k => e[k] !== null).map(k => entityReference(`entities.${e.id}.${k}`, e[k], "principal", e.id)),
    ...Object.keys(e.access.grants).map(id => entityReference(`entities.${e.id}.access.grants.${id}`, id, "principal", e.id))
  ]);
}

export function collectRetainedReferences(state) {
  return Object.values(state.entities).flatMap(e => e.retained ? [
    ...["areaId", "locationId", "dockedAtId"].filter(k => e.retained.location[k] != null).map(k =>
      entityReference(`entities.${e.id}.retained.location.${k}`, e.retained.location[k], k === "areaId" ? "historyArea" : k === "dockedAtId" ? "historyLocation" : "historyContainer", e.id))
  ] : []);
}
