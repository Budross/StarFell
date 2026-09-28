import { getEntity, isEntityActive, isPrincipal, record, validEntityId } from "./entities.js";

export const permissions = ["enter", "dock", "pilot", "passengerNavigation", "viewCargo", "depositCargo", "withdrawCargo", "useFacilities", "manageEquipment", "discardCargo", "transferOwnership", "setController", "manageAccess", "manageLifecycle"];
const operational = ["enter", "dock", "pilot", "viewCargo", "depositCargo", "withdrawCargo", "useFacilities", "manageEquipment"];
const administrative = ["transferOwnership", "setController", "manageAccess", "manageLifecycle", "discardCargo"];
export const ownerOf = (state, id) => getEntity(state, id)?.ownerId ?? null;
export const controllerOf = (state, id) => getEntity(state, id)?.controllerId ?? ownerOf(state, id);
export const canAct = (state, id) => isPrincipal(getEntity(state, id)) && isEntityActive(state, id) && getEntity(state, id).role !== "legacy";
export function defaultAccess(def) {
  return structuredClone(def.initialAccess ?? { public: ["enter", "dock", ...(def.mobile ? ["passengerNavigation"] : [])], grants: {} });
}
export function validateAccess(access) {
  const validList = v => Array.isArray(v) && v.every(p => permissions.includes(p)) && new Set(v).size === v.length;
  if (!record(access) || Object.keys(access).some(k => !["public", "grants"].includes(k)) || !validList(access.public) || !record(access.grants) ||
    !Object.entries(access.grants).every(([id, p]) => validEntityId(id) && validList(p))) throw new Error("Invalid entity access policy.");
}
export function validateAuthority(state) {
  for (const e of Object.values(state.entities)) {
    validateAccess(e.access);
    for (const id of [e.ownerId, e.controllerId, ...Object.keys(e.access.grants)].filter(Boolean)) {
      if (!isPrincipal(getEntity(state, id))) throw new Error(`Invalid authority principal ${id} on ${e.id}.`);
    }
  }
}
export function permissionReason(state, actorId, targetId, permission) {
  if (!permissions.includes(permission)) return "Unknown permission.";
  // Used only while migrating historical saves, before identity exists.
  if (!state.entities) return state.locations?.[targetId]?.ownerId === actorId || ["enter", "dock", "passengerNavigation"].includes(permission) ? "" : "Requires player ownership.";
  const target = getEntity(state, targetId);
  if (!canAct(state, actorId)) return "This actor is unavailable.";
  if (!target || (target.lifecycle !== "active" && !(target.lifecycle === "inactive" && permission === "manageLifecycle"))) return "This entity is unavailable.";
  if (administrative.includes(permission) && target.ownerId === actorId || operational.includes(permission) && controllerOf(state, targetId) === actorId ||
    target.access.public.includes(permission) || target.access.grants[actorId]?.includes(permission)) return "";
  return `Requires ${permission} permission (ownership or an explicit grant).`;
}
export const canUse = (state, actorId, targetId, permission) => !permissionReason(state, actorId, targetId, permission);
export function requirePermission(state, actorId, targetId, permission) {
  const reason = permissionReason(state, actorId, targetId, permission);
  if (reason) throw new Error(reason);
}
function principal(state, id) {
  if (id !== null && !canAct(state, id)) throw new Error(`Unavailable authority principal: ${id}.`);
}
export function setEntityOwner(state, id, ownerId, actorId = "player", { retainDelegation = false } = {}) {
  requirePermission(state, actorId, id, "transferOwnership"); principal(state, ownerId);
  const e = getEntity(state, id);
  if (!["area", "site", "ship"].includes(e.type)) throw new Error("This entity is not ownable.");
  e.ownerId = ownerId;
  if (!retainDelegation) { e.controllerId = null; e.access.grants = {}; }
}
export function setEntityController(state, id, controllerId, actorId = "player") {
  requirePermission(state, actorId, id, "setController"); principal(state, controllerId);
  if (!["area", "site", "ship"].includes(getEntity(state, id).type)) throw new Error("This entity is not controllable.");
  getEntity(state, id).controllerId = controllerId;
}
export function setEntityAccess(state, id, access, actorId = "player") {
  requirePermission(state, actorId, id, "manageAccess"); validateAccess(access);
  Object.keys(access.grants).forEach(id => principal(state, id));
  getEntity(state, id).access = structuredClone(access);
}
