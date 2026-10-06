import { getEntity, isTerminal, listEntities } from "./entities.js";
import { vesselDefinition } from './vessels.js';

export function resolveEntityDefinition(state, catalogs, id) {
  const ref = getEntity(state, id)?.definition;
  if(ref?.catalog==='locations' && catalogs.world?.resolveLocationDefinition) return catalogs.world.resolveLocationDefinition(state,id);
  const definitions = ref?.catalog === "locations" ? catalogs.world?.definitions : ref?.catalog === "npcs" ? catalogs.people?.npcs : null;
  return definitions && Object.hasOwn(definitions, ref.id) ? definitions[ref.id] : undefined;
}
export function getEntityLabel(state, catalogs, id) {
  const e = getEntity(state, id);
  return (isTerminal(e) ? e.retained?.name : e?.displayName) ?? resolveEntityDefinition(state, catalogs, id)?.name ?? e?.retained?.name ?? id;
}
export function getEntityState(state, id) {
  const e = getEntity(state, id);
  return e?.type === "npc" ? state.npcs[id] : ["site", "ship", "area"].includes(e?.type) ? state.locations[id] : undefined;
}
export function getEntityLocation(state, id, seen = new Set()) {
  const e = getEntity(state, id);
  if (!e || isTerminal(e)) return { locationId: null, areaId: null };
  if (seen.has(id)) throw new Error(`Containment cycle at ${id}.`);
  seen.add(id);
  if (e.type === "area") return { locationId: null, areaId: id };
  if (e.type === "npc" || id === "player") {
    const locationId = id === "player" ? state.locationId : state.npcs[id]?.locationId;
    const parent = getEntity(state, locationId);
    if (!["site", "ship"].includes(parent?.type)) throw new Error(`Invalid placement of ${id}.`);
    return { ...getEntityLocation(state, locationId, seen), locationId };
  }
  if (e.type === "principal") return { locationId: null, areaId: null };
  const local = state.locations[id];
  if (getEntity(state, local?.areaId)?.type !== "area") throw new Error(`Invalid area of ${id}.`);
  return { locationId: local.areaId, areaId: local.areaId, dockedAtId: local.dockedAtId ?? null,
    journey: local.journey ? { ...local.journey } : null };
}

// Pre-registry fallbacks exist only for frozen legacy migration/content validation.
export function locationDefinition(state, world, id) {
  if (!state.entities) return world.definitions[id];
  const e = getEntity(state, id);
  if (!e || !["area", "site", "ship"].includes(e.type)) return undefined;
  const def = resolveEntityDefinition(state, { world }, id);
  return def ? { ...vesselDefinition(state.locations[id], def, world), definitionId: def.id, id, name: (isTerminal(e)?e.retained?.name:e.displayName) ?? def.name ?? e.retained?.name ?? id } : undefined;
}
export function locationInstances(state, world, lifecycle = ["active"]) {
  return state.entities ? listEntities(state, { types: ["area", "site", "ship"], lifecycle }).map(e => locationDefinition(state, world, e.id)).filter(Boolean)
    : Object.values(world.definitions).filter(d => d.spawn !== false);
}
export function npcDefinition(state, system, id) {
  if (!state.entities) return system.npcs[id];
  const e = getEntity(state, id);
  if (e?.type !== "npc") return undefined;
  const def = resolveEntityDefinition(state, { people: system }, id);
  return def ? { ...def, definitionId: def.id, id, name: getEntityLabel(state, { people: system }, id) } : undefined;
}
export function npcInstances(state, system) {
  return state.entities ? listEntities(state, { types: ["npc"], lifecycle: ["active"] }).map(e => npcDefinition(state, system, e.id)).filter(Boolean)
    : Object.values(system.npcs).filter(d => d.spawn !== false);
}
export function runtimeWorld(state, world) {
  return { ...world, definitions: Object.fromEntries(locationInstances(state, world, ["active", "inactive"]).map(d => [d.id, d])) };
}
