import { validateLocalState } from './locations.js';
import { validateNpcState } from './npcs.js';
import { seedEntities, initialLocationState, initialNpcState } from './entityCreation.js';
import { validateEntities, getEntity, isTerminal, record, validEntityId } from './entities.js';
import { resolveEntityDefinition, runtimeWorld } from './entityQueries.js';

// Runtime entity/state consistency only: authored identity, live/retained slices,
// and current-content instance repair. Not a general lifecycle coordinator.
const booleanMap = value => record(value) && Object.values(value).every(entry => typeof entry === 'boolean');

function reconcileInstances(state, content, world, people) {
  for (const spawn of world.initialSpawns) {
    const id = spawn.id;
    if (!getEntity(state, id)) {
      if (Object.hasOwn(state.locations, id)) throw new Error(`Orphan location state: ${id}.`);
      state.locations[id] = initialLocationState(spawn, world, content);
    }
  }
  for (const spawn of people.initialSpawns) {
    const id = spawn.id;
    if (!getEntity(state, id)) {
      if (Object.hasOwn(state.npcs, id)) throw new Error(`Orphan NPC state: ${id}.`);
      state.npcs[id] = initialNpcState(spawn, people);
    }
  }
  seedEntities(state, world, people, world.principals);
  for (const [id, local] of Object.entries(state.locations)) {
    if (isTerminal(getEntity(state, id))) continue;
    if (!record(local) || !record(local.resources) || !record(local.infrastructure)) throw new Error(`Invalid local assets at ${id}.`);
    for (const asset of Object.keys(content.resources)) if (!Object.hasOwn(local.resources, asset)) local.resources[asset] = 0;
    for (const group of Object.keys(content.infrastructure)) if (!Object.hasOwn(local.infrastructure, group)) local.infrastructure[group] = { quantity: 0, health: 1, enabled: true, upgrades: [] };
  }
}
function validateTerminalState(local, type, id) {
  if (!record(local) || !booleanMap(local.flags)) throw new Error(`Invalid retained state at ${id}.`);
  const quantities = type === 'npc' ? local.inventory : local.resources;
  if (!record(quantities) || Object.entries(quantities).some(([k, n]) => !validEntityId(k) || !Number.isFinite(n) || n < 0 || n > Number.MAX_SAFE_INTEGER)) throw new Error(`Invalid retained assets at ${id}.`);
  if (type !== 'npc') {
    if (Object.hasOwn(local, 'ownerId') || !record(local.infrastructure)) throw new Error(`Invalid retained equipment at ${id}.`);
    for (const e of Object.values(local.infrastructure)) if (!record(e) || !Number.isSafeInteger(e.quantity) || e.quantity < 0 || !Number.isFinite(e.health) || e.health < 0 || e.health > 1 || typeof e.enabled !== 'boolean' || !Array.isArray(e.upgrades) || !e.upgrades.every(validEntityId)) throw new Error(`Invalid retained equipment at ${id}.`);
  }
}
export function validateEntityInstances(state, content, world, people) {
  if (!record(state.locations) || !record(state.npcs)) throw new Error('Invalid domain state.');
  const liveWorld = runtimeWorld(state, world);
  for (const { id, definitionId } of world.initialSpawns) {
    const def = world.definitions[definitionId];
    const entity = getEntity(state, id);
    if (def && (!entity || entity.type !== (def.mobile ? 'ship' : def.kind) || entity.definition?.catalog !== 'locations' || entity.definition.id !== definitionId)) throw new Error(`Authored entity ID was removed or reused: ${id}.`);
  }
  for (const { id, definitionId } of people.initialSpawns) {
    const entity = getEntity(state, id);
    if (people.npcs[definitionId] && (!entity || entity.type !== 'npc' || entity.definition?.catalog !== 'npcs' || entity.definition.id !== definitionId)) throw new Error(`Authored NPC ID was removed or reused: ${id}.`);
  }
  for (const [id, local] of Object.entries(state.locations)) {
    if (!['area', 'site', 'ship'].includes(getEntity(state, id)?.type)) throw new Error(`Orphan location state: ${id}.`);
    if (!record(local) || Object.hasOwn(local, 'ownerId')) throw new Error(`Ownership belongs to entities.${id}, not local state.`);
  }
  for (const id of Object.keys(state.npcs)) if (getEntity(state, id)?.type !== 'npc') throw new Error(`Orphan NPC state: ${id}.`);
  for (const e of Object.values(state.entities)) {
    if (e.type === 'principal') continue;
    const local = e.type === 'npc' ? state.npcs[e.id] : state.locations[e.id];
    if (isTerminal(e)) {
      if (local) validateTerminalState(local, e.type, e.id);
      else if (!(e.origin === 'legacy' && e.definition === null)) throw new Error(`Missing retained state: ${e.id}.`);
      continue;
    }
    const def = resolveEntityDefinition(state, { world, people }, e.id);
    if (!def) throw new Error(`Invalid or removed definition for ${e.id}; explicit migration required. Save preserved.`);
    if (!local) throw new Error(`Missing entity state: ${e.id}.`);
    if (e.type === 'npc') validateNpcState(local, def, liveWorld, content);
    else {
      if (e.type !== (def.mobile ? 'ship' : def.kind)) throw new Error(`Entity/definition type mismatch: ${e.id}.`);
      validateLocalState(local, def, content, liveWorld);
    }
  }
}

export function reconcileEntityInstances(state, content, world, people) {
  validateEntities(state);
  if (!record(state.locations) || !record(state.npcs)) throw new Error('Invalid entity domain state.');
  reconcileInstances(state, content, world, people);
}
