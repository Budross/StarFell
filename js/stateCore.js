import { migrateState as migrateV7 } from './stateV7.js';
import { createDialogueState, collectDialogueReferences, validateDialogueState } from './dialogue.js';
import { createResearchState } from './research/researchState.js';
import { seedEntities, validateSpawnIds, initialLocationState, initialNpcState } from './entityCreation.js';
import { makeEntity, getEntity, isPrincipal, record, validEntityId, entitySequence } from './entities.js';
import { createStateLifecycle } from './stateComposition.js';
import { migrateConsolidatedAreas } from './locationAreaMigration.js';
import {installFreshWorld} from './proceduralWorld.js';
import {freezeAuthoredGeography,reconcileAuthoredMapKnowledge} from './locations.js';
import {emptyMapKnowledge,admitKnownArea} from './mapKnowledge.js';

export const SAVE_VERSION = 13;

export function createInitialState(content, world, people, research, seed = 0x07B3A91D, lifecycle) {
  validateSpawnIds(world, people, world.principals ?? {});
  const state = { saveVersion: SAVE_VERSION, simulationTime: 0, locationId: world.startId,
    locations: Object.fromEntries(world.initialSpawns.map(spawn => [spawn.id, initialLocationState(spawn, world, content)])),
    npcs: Object.fromEntries(people.initialSpawns.map(spawn => [spawn.id, initialNpcState(spawn, people)])),
    dialogue: createDialogueState(), crafting: { recipeId: null, ingredients: {} }, knowledge: { discoveries: {} }, flags: {}, research: createResearchState(seed) };
  seedEntities(state, world, people, world.principals);
  installFreshWorld(state,content,world,seed);
  reconcileAuthoredMapKnowledge(state,world,content,true);
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
  if(saved.saveVersion<13)migrateConsolidatedAreas(relocated, world, notices);
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
  if (saved.saveVersion < 10) {
    if (Object.hasOwn(state.knowledge,'itemEntries')) throw new Error('Unexpected item journal in a pre-version-10 save.');
    state.saveVersion = 10;
    notices.push('Item entries now retain learned information. Existing discoveries and observable items were preserved; earlier unrecorded encounters cannot be reconstructed.');
  }
  if(saved.saveVersion<11)state.saveVersion=11;
  if(saved.saveVersion<12){
    // Validate the genuine physical-only schema before assigning contact meaning.
    validateDialogueState(state,people,true);
    if(state.dialogue.active)Object.assign(state.dialogue.active,{mode:'physical',receiverLocationId:state.dialogue.active.locationId});
    state.saveVersion=12;
    notices.push('Radio conversations now retain their contact mode and endpoint. Physical introductions and dialogue progress were preserved.');
  }
  if(saved.saveVersion<13) {
    if(Object.hasOwn(state,'worldGeography')||Object.hasOwn(state,'mapKnowledge'))throw new Error('Unexpected spatial state in a legacy save.');
    state.worldGeography=freezeAuthoredGeography(state,world);
    state.mapKnowledge=emptyMapKnowledge();
    reconcileAuthoredMapKnowledge(state,world,content,true);
    for(const host of Object.values(state.locations))if(host.journey?.targetId && state.entities[host.journey.targetId]?.type==='area')admitKnownArea(state,host.journey.targetId);
    state.saveVersion=13;
    notices.push('Existing authored geography and navigation knowledge were preserved. Procedural bodies are created only for new games.');
  }
  currentLifecycle.reconcile(state, { notices, reconcileCurrentInstances: saved.saveVersion >= 8, migrateItemKnowledge:saved.saveVersion < 10, migrateMissionResults:saved.saveVersion<11 });
  validateState(state, content, world, people, research, undefined, currentLifecycle);
  return state;
}
export function validateState(state, content, world, people, research, collectors, lifecycle) {
  if (!record(state) || state.saveVersion !== SAVE_VERSION) throw new Error('Unsupported or missing save data.');
  if(!lifecycle && (Object.keys(state.missions?.instances ?? {}).length || Object.keys(state.vesselReports?.byVessel ?? {}).length)) throw new Error('Mission saves require the composed state lifecycle.');
  if (!Number.isFinite(state.simulationTime) || state.simulationTime < 0) throw new Error('Invalid simulation time.');
  (lifecycle ?? createStateLifecycle({ content, world, people, research, referenceCollectors: collectors })).validate(state);
}
