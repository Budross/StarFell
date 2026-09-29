import { migrateState as migrateV7 } from './stateV7.js';
import { createDialogueState, collectDialogueReferences } from './dialogue.js';
import { createResearchState } from './research/researchState.js';
import { seedEntities, validateSpawnIds, initialLocationState, initialNpcState } from './entityCreation.js';
import { makeEntity, getEntity, isPrincipal, record, validEntityId, entitySequence } from './entities.js';
import { createStateLifecycle } from './stateComposition.js';
import { migrateConsolidatedAreas } from './locationAreaMigration.js';

export const SAVE_VERSION = 9;

export function createInitialState(content, world, people, research, seed = 0x07B3A91D, lifecycle) {
  validateSpawnIds(world, people, world.principals ?? {});
  const state = { saveVersion: SAVE_VERSION, simulationTime: 0, locationId: world.startId,
    locations: Object.fromEntries(world.initialSpawns.map(spawn => [spawn.id, initialLocationState(spawn, world, content)])),
    npcs: Object.fromEntries(people.initialSpawns.map(spawn => [spawn.id, initialNpcState(spawn, people)])),
    dialogue: createDialogueState(), crafting: { recipeId: null, ingredients: {} }, knowledge: { discoveries: {} }, flags: {}, research: createResearchState(seed) };
  seedEntities(state, world, people, world.principals);
  state.saveVersion = SAVE_VERSION;
  const currentLifecycle = lifecycle ?? createStateLifecycle({ content, world, people, research });
  currentLifecycle.initialize(state);
  validateState(state, content, world, people, research, undefined, currentLifecycle);
  return state;
}
function migrateIdentities(state, world, people, notices, saved) {
  delete state.entities; delete state.entityIds;
  seedEntities(state, world, people, world.principals);
  // Pre-identity saves already contain active instances. New content defaults apply
  // only to instances added during migration, never to these existing assets.
  for (const id of [...Object.keys(saved.locations ?? {}), ...Object.keys(saved.npcs ?? {}), state.locationId]) {
    if (getEntity(state, id)) state.entities[id].lifecycle = "active";
  }
  for (const e of Object.values(state.entities)) {
    e.createdAt = 0; e.lifecycleChangedAt = 0;
    e.controllerId = null;
    for (const id of [e.ownerId, e.controllerId].filter(Boolean)) {
      if (!validEntityId(id)) throw new Error(`Invalid legacy owner: ${id}.`);
      if (!getEntity(state, id)) {
        state.entities[id] = makeEntity(id, 'principal', null, 0, { origin: 'legacy', role: 'legacy', displayName: id });
        notices.push(`Preserved legacy owner ${id} as an inert authority identity.`);
      } else if (!isPrincipal(getEntity(state, id))) throw new Error(`Legacy owner collides with a non-principal entity: ${id}.`);
    }
  }
  for (const ref of collectDialogueReferences(state).filter(r => r.policy === 'retain')) {
    if (getEntity(state, ref.targetId)) continue;
    const e = makeEntity(ref.targetId, ref.role === 'historyNpc' ? 'npc' : 'site', null, 0, { origin: 'legacy', lifecycle: 'retired', displayName: ref.targetId });
    e.retained = { name: ref.targetId, location: { locationId: null, areaId: null } };
    state.entities[e.id] = e;
  }
  for (const id of Object.keys(state.entities)) {
    const sequence = entitySequence(id);
    if (sequence === undefined) continue;
    const next = Number(sequence) + 1;
    if (!Number.isSafeInteger(next) || next < 2) throw new Error(`Invalid legacy entity sequence: ${id}.`);
    state.entityIds.next = Math.max(state.entityIds.next, next);
  }
  state.saveVersion = 8;
  notices.push('Persistent entity identities and shared ownership permissions are now available. Existing assets and history were preserved.');
}
export function migrateState(saved, content, world, people, notices = [], research, legacyStorage, lifecycle) {
  if (!record(saved) || !Number.isInteger(saved.saveVersion) || saved.saveVersion < 1 || saved.saveVersion > SAVE_VERSION) throw new Error('Unsupported or missing save data.');
  validateSpawnIds(world, people, world.principals ?? {});
  const relocated = structuredClone(saved);
  migrateConsolidatedAreas(relocated, world, notices);
  let state;
  if (saved.saveVersion < 8) {
    const legacy = relocated; delete legacy.entities; delete legacy.entityIds;
    state = migrateV7(legacy, content, world, people, notices, research, legacyStorage);
    migrateIdentities(state, world, people, notices, relocated);
  } else {
    state = relocated;
  }
  if (saved.saveVersion < 9) { state.processing = { nextRunId: 1, runs: {} }; state.saveVersion = 9; }
  const currentLifecycle = lifecycle ?? createStateLifecycle({ content, world, people, research });
  currentLifecycle.reconcile(state, { notices, reconcileCurrentInstances: saved.saveVersion >= 8 });
  validateState(state, content, world, people, research, undefined, currentLifecycle);
  return state;
}
export function validateState(state, content, world, people, research, collectors, lifecycle) {
  if (!record(state) || state.saveVersion !== SAVE_VERSION) throw new Error('Unsupported or missing save data.');
  if (!Number.isFinite(state.simulationTime) || state.simulationTime < 0) throw new Error('Invalid simulation time.');
  (lifecycle ?? createStateLifecycle({ content, world, people, research, referenceCollectors: collectors })).validate(state);
}
