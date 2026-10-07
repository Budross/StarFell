import { record, validId } from "./conditions.js";
import { compileAmounts, validateQuantity } from "./quantities.js";
import { validateAccess } from "./authority.js";
import { validateEquipment } from "./equipment.js";
import { deriveVessel, validateAssemblySyntax } from './vessels.js';

// Pure specification boundary shared by authored effects and trusted runtime creation.
export function normalizeCreationSpec(value, refs = {}, { authored = false, bindings = false } = {}) {
  const allowed = ["type", "definitionId", "displayName", "areaId", "locationId", "localPlaceId", "dockedAtId", "ownerId", "controllerId", "access", "resources", "infrastructure", "inventory", "lifecycle", "assembly", ...(bindings ? ["key"] : [])];
  if (!record(value) || Object.keys(value).some(k => !allowed.includes(k)) || !["site", "ship", "npc", "principal"].includes(value.type) ||
      ![undefined, "active", "inactive"].includes(value.lifecycle)) throw new Error("Invalid entity creation specification.");
  const spec = structuredClone(value);
  if (Object.hasOwn(spec, 'assembly')) {
    if (spec.type !== 'ship') throw new Error('Only ships can have vessel assembly.');
    if (refs.content) deriveVessel(spec.assembly, refs.content); else validateAssemblySyntax(spec.assembly);
  }
  if (spec.displayName !== undefined && (typeof spec.displayName !== "string" || !spec.displayName.trim())) throw new Error("Invalid entity name.");
  const domainKeys = spec.type === "npc" ? ["locationId", "localPlaceId", "inventory"] : spec.type === "principal" ? [] : ["areaId", "resources", "infrastructure", ...(spec.type === "ship" ? ["dockedAtId"] : [])];
  if (["areaId", "locationId", "localPlaceId", "dockedAtId", "resources", "infrastructure", "inventory"].some(k => Object.hasOwn(spec, k) && !domainKeys.includes(k))) throw new Error("Creation fields do not match the entity type.");
  if (spec.localPlaceId !== undefined && !validId(spec.localPlaceId)) throw new Error("Invalid NPC local place.");
  if (spec.type === "principal" ? spec.definitionId !== undefined || !spec.displayName : !validId(spec.definitionId)) throw new Error("Invalid entity definition or organization name.");
  if (["npc", "principal"].includes(spec.type) && (spec.ownerId != null || spec.controllerId != null)) throw new Error("Actors cannot be owned.");
  for (const key of ["areaId", "locationId", "dockedAtId", "ownerId", "controllerId"]) {
    const target = spec[key];
    if (target != null && !validId(target) && !(bindings && record(target) && Object.keys(target).length === 1 && validId(target.ref))) throw new Error("Invalid or missing entity binding.");
  }
  if (authored && (spec.type === "npc" ? !spec.locationId : ["site", "ship"].includes(spec.type) && !spec.areaId)) throw new Error("Authored creation requires a placement target.");
  if (authored && !refs.content && ["resources", "inventory", "infrastructure"].some(key => spec[key] !== undefined)) throw new Error("Creation asset overrides require a content catalog.");
  if (spec.access !== undefined) validateAccess(spec.access);
  for (const key of ["resources", "inventory"]) if (spec[key] !== undefined) {
    if (!record(spec[key])) throw new Error("Invalid initial resources or inventory.");
    if (refs.content) {
      if (key === "inventory" && Object.keys(spec[key]).some(id => !Object.hasOwn(refs.content.items, id))) throw new Error("NPC inventory requires items.");
      spec[key] = authored ? compileAmounts(spec[key], refs.content) : Object.fromEntries(Object.entries(spec[key]).map(([id, amount]) => [id, validateQuantity(amount, id, refs.content)]));
    }
  }
  if (spec.infrastructure !== undefined && (!record(spec.infrastructure) || Object.entries(spec.infrastructure).some(([id, entry]) => !record(entry) || refs.content && !Object.hasOwn(refs.content.infrastructure, id)))) throw new Error("Invalid initial equipment.");
  if (spec.infrastructure && refs.content) {
    for (const entry of Object.values(spec.infrastructure)) if (Object.keys(entry).some(k => !["quantity", "health", "enabled", "upgrades"].includes(k))) throw new Error("Invalid initial equipment field.");
    const defaults = refs.world?.definitions?.[spec.definitionId]?.initialInfrastructure ?? {};
    const equipment = Object.fromEntries(Object.keys(refs.content.infrastructure).map(id => [id, {
      quantity: 0, health: 1, enabled: true, upgrades: [], ...defaults[id], ...spec.infrastructure[id]
    }]));
    validateEquipment(equipment, refs.content, message => { throw new Error(`Invalid initial equipment: ${message}.`); });
  }
  validateCreationDefinition(spec, refs);
  return spec;
}

export function validateCreationDefinition(spec, refs = {}) {
  if (spec.type === "principal") return;
  const catalog = spec.type === "npc" ? refs.npcs : refs.world?.definitions;
  if (!catalog && !refs.complete) return;
  const def = catalog && Object.hasOwn(catalog, spec.definitionId) ? catalog[spec.definitionId] : null;
  if (!def || (spec.type === "npc" ? def.spawn !== false : def.kind !== "site" || !!def.mobile !== (spec.type === "ship"))) throw new Error("Unknown or incompatible entity definition (generated NPCs require an explicit reusable template).");
  if (!!def.modularVessel !== Object.hasOwn(spec, 'assembly')) throw new Error('Modular vessel creation requires a complete assembly on a modular template.');
  if (spec.type === "npc" && spec.inventory && Object.entries(spec.inventory).some(([id, amount]) => amount > (def.inventoryCapacities[id] ?? 0))) throw new Error("Initial NPC inventory exceeds capacity.");
}
