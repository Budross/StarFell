import { allocateEntityId, makeEntity, hasEntity, validEntityId, getEntity, record, validateEntities } from "./entities.js";
import { createLocationState, validateLocalState } from "./locations.js";
import { createNpcState, validateNpcState } from "./npcs.js";
import { defaultAccess, validateAuthority } from "./authority.js";
import { runtimeWorld, locationDefinition } from "./entityQueries.js";
import { entryPlaceId, localSpaceFor } from './localSpace.js';
import { validateShipStates } from "./ships.js";
import { storageSummary } from "./storage.js";
import { normalizeCreationSpec } from "./entityCreationSpec.js";
import { initializeVessel, validateVessels } from './vessels.js';

export function validateSpawnIds(world, people, principals = {}) {
  if (!record(principals) || Object.values(principals).some(p => !record(p) || typeof p.name !== "string" || !p.name.trim() || Object.keys(p).some(k => k !== "name"))) throw new Error("Invalid principal definitions.");
  const ids = new Set(["player"]);
  for (const id of [...world.initialSpawns.map(s => s.id), ...people.initialSpawns.map(s => s.id), ...Object.keys(principals)]) {
    if (!validEntityId(id) || id.startsWith("gen_") || ids.has(id)) throw new Error(`Authored entity ID collision or reserved ID: ${id}.`);
    ids.add(id);
  }
}
export function initialLocationState(spawn, world, content) {
  const def = world.definitions[spawn.definitionId];
  if (!def) throw new Error(`Invalid initial location definition: ${spawn.definitionId}.`);
  const local = createLocationState(def, content);
  local.areaId = spawn.areaId; local.ownerId = spawn.ownerId;
  if (def.mobile) local.dockedAtId = spawn.dockedAtId;
  return local;
}
export function initialNpcState(spawn, people) {
  const def = people.npcs[spawn.definitionId];
  if (!def) throw new Error(`Invalid initial NPC definition: ${spawn.definitionId}.`);
  return { ...createNpcState(def), locationId: spawn.locationId };
}
export function seedEntities(state, world, people, principals = {}) {
  state.entities ??= {};
  state.entityIds ??= { next: 1 };
  if (!hasEntity(state, "player")) state.entities.player = makeEntity("player", "principal", null, 0, { role: "player", displayName: "Player" });
  for (const [id, def] of Object.entries(principals)) if (!hasEntity(state, id)) {
    state.entities[id] = makeEntity(id, "principal", null, state.simulationTime, { role: "organization", displayName: def.name });
  }
  for (const spawn of world.initialSpawns) {
    const { id, definitionId } = spawn, def = world.definitions[definitionId];
    if (hasEntity(state, id)) continue;
    const local = state.locations[id];
    if (!local) throw new Error(`Missing authored state: ${id}.`);
    state.entities[id] = makeEntity(id, def.mobile ? "ship" : def.kind, { catalog: "locations", id: definitionId }, state.simulationTime,
      { ownerId: local.ownerId ?? null, controllerId: spawn.controllerId, access: spawn.access, lifecycle: spawn.lifecycle });
    delete local.ownerId;
  }
  for (const { id, definitionId, lifecycle } of people.initialSpawns) if (!hasEntity(state, id)) {
    state.entities[id] = makeEntity(id, "npc", { catalog: "npcs", id: definitionId }, state.simulationTime, { lifecycle });
  }
}

// Trusted domain API: only call on a candidate. Browser actions never accept an
// actor or spawn specification from a player payload.
export function createEntity(state, systems, spec) {
  return createEntities(state, systems, [spec])[0];
}
export function createEntities(state, systems, specs) {
  if (!Array.isArray(specs) || !specs.length) throw new Error("Entity creation requires specifications.");
  const { content, world, people } = systems;
  const bindings = new Map();
  const entries = specs.map(value => {
    const spec = normalizeCreationSpec(value, { content, world, npcs: people.npcs, complete: true }, { bindings: true });
    const def = spec.type === "principal" ? null : spec.type === "npc" ? people.npcs[spec.definitionId] : world.definitions[spec.definitionId];
    const id = allocateEntityId(state, spec.type);
    if (spec.key !== undefined) {
      if (!validEntityId(spec.key) || bindings.has(spec.key)) throw new Error("Invalid or duplicate creation binding.");
      bindings.set(spec.key, id);
    }
    return { id, spec, def };
  });
  const bind = value => {
    if (record(value) && Object.keys(value).length === 1 && typeof value.ref === "string" && bindings.has(value.ref)) return bindings.get(value.ref);
    if (value === null || value === undefined || validEntityId(value)) return value ?? null;
    throw new Error("Invalid or missing entity binding.");
  };
  for (const { id, spec, def } of entries) {
    const ownerId = bind(spec.ownerId), controllerId = bind(spec.controllerId);
    if (["npc", "principal"].includes(spec.type) && (ownerId || controllerId)) throw new Error("Actors cannot be owned.");
    state.entities[id] = makeEntity(id, spec.type, def ? { catalog: spec.type === "npc" ? "npcs" : "locations", id: def.id } : null,
      state.simulationTime, { ...spec, ownerId, controllerId, origin: "generated", access: spec.access ?? (def?.kind ? defaultAccess(def) : undefined) });
    if (spec.type === "npc") {
      const local = createNpcState(def);
      local.locationId = bind(spec.locationId);
      if (spec.inventory !== undefined) local.inventory = structuredClone(spec.inventory);
      state.npcs[id] = local;
    } else if (def) {
      const local = createLocationState(def, content);
      delete local.ownerId;
      local.areaId = bind(spec.areaId);
      if (def.mobile) local.dockedAtId = bind(spec.dockedAtId);
      if (spec.resources !== undefined) { if (!record(spec.resources)) throw new Error("Invalid initial resources."); Object.assign(local.resources, structuredClone(spec.resources)); }
      if (spec.infrastructure !== undefined) {
        if (!record(spec.infrastructure)) throw new Error("Invalid initial equipment.");
        for (const [group, value] of Object.entries(spec.infrastructure)) {
          if (!Object.hasOwn(local.infrastructure, group) || !record(value)) throw new Error("Invalid initial equipment group.");
          Object.assign(local.infrastructure[group], structuredClone(value));
        }
      }
      state.locations[id] = local;
      if (spec.assembly) initializeVessel(local, spec.assembly, content);
    }
  }
  validateEntities(state); validateAuthority(state);
  const liveWorld = runtimeWorld(state, world);
  for (const { id, spec, def } of entries) {
    if (spec.type === "npc") {
      const npc=state.npcs[id],host=locationDefinition(state,world,npc.locationId);
      npc.localPlaceId=spec.localPlaceId??entryPlaceId(host);
      if(!Object.hasOwn(localSpaceFor(host).places,npc.localPlaceId))throw new Error('Invalid NPC local place.');
      validateNpcState(npc, def, liveWorld, content);
    }
    else if (def) {
      validateLocalState(state.locations[id], def, content, liveWorld);
      if (storageSummary({ ...state.locations[id], capacityVolumeUnits: def.capacityVolumeUnits }, content).overloadVolumeUnits > 0) throw new Error("Initial cargo exceeds entity capacity.");
    }
    for (const target of [state.locations[id]?.areaId, state.locations[id]?.dockedAtId, state.npcs[id]?.locationId].filter(Boolean)) {
      if (getEntity(state, target)?.lifecycle !== "active") throw new Error(`Creation target ${target} is unavailable.`);
    }
  }
  validateVessels(state, content, world);
  validateShipStates(state, world);
  return entries.map(e => e.id);
}
