import { npcDefinition, locationDefinition } from "./entityQueries.js";
import { isEntityActive } from "./entities.js";
import { isTerminal } from "./entities.js";
import { entityReference } from "./entityReferences.js";
import { record, validId, safeKey, requireValid, validateConditions, conditionContracts, needsBlockedReason } from "./conditions.js";
import { conditionReason } from "./conditionContext.js";
import { compileAmounts } from "./quantities.js";
import { validateNarrativeMetadata } from './narrative/narrativeMetadata.js';

const check = (ok, message) => requireValid(ok, `Invalid NPCs: ${message}.`);
export function buildNpcCatalog(source, world, content) {
  check(record(source), "expected definitions");
  const definitions = structuredClone(source);
  for (const [id, def] of Object.entries(definitions)) {
    check(validId(id) && record(def), `identity ${id}`);
    def.id = id;
    validateNarrativeMetadata(def.narrative,'npc');
    check(def.spawn === undefined || typeof def.spawn === "boolean", `spawn ${id}`);
    if (def.initialLifecycle === undefined) def.initialLifecycle = "active";
    check(["active", "inactive"].includes(def.initialLifecycle), `initial lifecycle ${id}`);
    check(typeof def.name === "string" && def.name.trim() && typeof def.description === "string", `text ${id}`);
    check(def.spawn === false || world.definitions[def.initialLocationId]?.kind === "site", `starting location ${id}`);
    def.initialInventory ??= {}; def.inventoryCapacities ??= {}; def.initialFlags ??= {};
    def.interactions ??= ["inspect", "talk"]; def.dialogueGroups ??= []; def.excludeConversations ??= []; def.order ??= 0;
    check(Number.isFinite(def.order), `order ${id}`);
    check(def.subtitle === undefined || typeof def.subtitle === "string", `subtitle ${id}`);
    check(Array.isArray(def.interactions) && def.interactions.every(action => ["inspect", "talk"].includes(action)), `interactions ${id}`);
    if(def.remoteContact!==undefined)check(record(def.remoteContact)&&Object.keys(def.remoteContact).length===1&&typeof def.remoteContact.enabled==='boolean',`remoteContact ${id}`);
    for (const key of ["dialogueGroups", "excludeConversations"]) check(Array.isArray(def[key]) && def[key].every(validId), `${key} ${id}`);
    check(record(def.inventoryCapacities), `capacities ${id}`);
    def.inventoryCapacities = compileAmounts(def.inventoryCapacities, content);
    def.initialInventory = compileAmounts(def.initialInventory, content);
    for (const [item, amount] of Object.entries(def.inventoryCapacities)) check(Object.hasOwn(content.items, item) && Number.isSafeInteger(amount) && amount >= 0, `capacity ${id}/${item}`);
    for (const key of ["presenceConditions", "visibilityConditions", "interactionConditions"]) validateConditions(def[key], { world, content, npcs: definitions,contract:conditionContracts.people }, `npcs.${id}.${key}`);
    check(!needsBlockedReason(def.interactionConditions) || typeof def.blockedReason === "string" && !!def.blockedReason.trim(), `blockedReason ${id}`);
    validateNpcState(createNpcState(def), def, world, content, def.spawn === false);
  }
  return definitions;
}

export function createNpcState(def) {
  return { locationId: def.initialLocationId, inventory: structuredClone(def.initialInventory), flags: structuredClone(def.initialFlags) };
}
export function validateNpcState(npc, def, world, content, unplaced = false) {
  check(record(npc) && (unplaced || world.definitions[npc.locationId]?.kind === "site"), `saved location ${def.id}`);
  check(unplaced || world.definitions[npc.locationId]?.boardable !== false, `autonomous vessel cannot carry ${def.id}`);
  check(record(npc.inventory) && record(npc.flags), `saved assets ${def.id}`);
  check(Object.entries(npc.flags).every(([key, value]) => safeKey(key) && typeof value === "boolean"), `flags ${def.id}`);
  for (const [item, amount] of Object.entries(npc.inventory)) check(Object.hasOwn(content.items, item) && Number.isSafeInteger(amount) && amount >= 0 && amount <= (def.inventoryCapacities[item] ?? 0), `inventory ${def.id}/${item}`);
}
export function npcVisible(state, id, system) {
  const def = npcDefinition(state, system, id), npc = state.npcs?.[id];
  if (!def || !npc || state.entities && !isEntityActive(state, id) || npc.locationId !== state.locationId) return false;
  const context = system.context(state, id);
  return !conditionReason(context.local, def.presenceConditions, system.content, context) && !conditionReason(context.local, def.visibilityConditions, system.content, context);
}
export function contactReason(state, id, system) {
  if (!npcVisible(state, id, system)) return "This person is no longer available here.";
  const def = npcDefinition(state, system, id);
  if (!def.interactions.includes("talk")) return "This person is not available for conversation.";
  const context = system.context(state, id);
  const reason = conditionReason(context.local, def.interactionConditions, system.content, context);
  return reason ? def.blockedReason || reason : "";
}
export function relocateNpc(state, id, destinationId, system) {
  check(!!npcDefinition(state, system, id) && (!state.entities || isEntityActive(state, id) && isEntityActive(state, destinationId)) && locationDefinition(state, system.world, destinationId)?.kind === "site", "relocation target");
  check(locationDefinition(state, system.world, destinationId)?.boardable !== false, 'autonomous vessels cannot carry occupants');
  state.npcs[id].locationId = destinationId;
}

export function collectNpcReferences(state) {
  return Object.entries(state.npcs).filter(([id]) => !isTerminal(state.entities[id]))
    .map(([id, npc]) => entityReference(`npcs.${id}.locationId`, npc.locationId, "occupant", id));
}
