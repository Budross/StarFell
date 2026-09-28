import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, shipSpec, npcSpec } from './entityFixtures.mjs';
import { previewEntityTransition, retireEntity, destroyEntity, deactivateEntity, activateEntity, deletionAssessment } from '../js/entityLifecycle.js';
import { hasEntity, isEntityActive } from '../js/entities.js';
import { getEntityLabel, getEntityLocation } from '../js/entityQueries.js';
import { relocateNpc } from '../js/npcs.js';
import { navigate, cancelJourney, shipGraphView } from '../js/ships.js';
import { createEntity } from '../js/entityCreation.js';
import { migrateState, validateState } from '../js/stateCore.js';
import { executeExperiment } from '../js/research/researchActions.js';
import { setEntityController } from '../js/authority.js';
import { referenceReason, entityReference, referencesTo } from '../js/entityReferences.js';
import { createGameRuntime } from '../js/runtime.js';
import { createStateLifecycle } from '../js/stateComposition.js';

test('retirement closes contact, retains history/identity, freezes domain state, and cannot reactivate', () => {
  const f = fixture(), npc = f.spawn(npcSpec({ displayName: 'Edda' }));
  f.registry.executeAction('dialogue:start', { npcId: npc });
  const local = structuredClone(f.state.npcs[npc]);
  const preview = previewEntityTransition(f.state, npc, 'retired', f);
  assert.equal(preview.allowed, true); assert.ok(preview.references.some(r => r.policy === 'closeContact'));
  f.runtime.applyAction(s => retireEntity(s, npc, f, { reason: 'Departed permanently' }));
  assert.equal(f.state.dialogue.active, null); assert.equal(f.state.dialogue.met[npc], true);
  assert.equal(hasEntity(f.state, npc), true); assert.equal(isEntityActive(f.state, npc), false);
  assert.equal(getEntityLabel(f.state, f, npc), 'Edda'); assert.equal(getEntityLocation(f.state, npc).locationId, null);
  assert.deepEqual(f.state.npcs[npc], local); assert.deepEqual(f.reload(f.saved), f.state);
  assert.throws(() => f.registry.executeAction('dialogue:start', { npcId: npc }), /available/);
  assert.throws(() => f.runtime.applyAction(s => activateEntity(s, npc, f)), /transition/);
  assert.equal(deletionAssessment(f.state, npc, f).allowed, false);
  assert.equal(referenceReason(f.state, npc, 'historyNpc'), '');
  assert.match(referenceReason(f.state, npc, 'contactNpc'), /Unavailable/);
});

test('occupied, docked-at, and journey-target locations return specific blockers', () => {
  const f = fixture(), ship = f.spawn(shipSpec()), npc = f.spawn(npcSpec({ locationId: ship }));
  let preview = previewEntityTransition(f.state, 'habitat', 'destroyed', f);
  assert.equal(preview.allowed, false);
  assert.ok(preview.blockers.some(s => s.includes('locationId')));
  assert.ok(preview.blockers.some(s => s.includes('dockedAtId')));
  assert.equal(previewEntityTransition(f.state, ship, 'inactive', f).allowed, false);
  f.runtime.applyAction(s => { relocateNpc(s, npc, 'habitat', f.people); navigate(s, 'undock', null, f.world, f.content, ship); navigate(s, 'dock', 'supplyPlatform', f.world, f.content, ship); });
  assert.ok(previewEntityTransition(f.state, 'supplyPlatform', 'retired', f).blockers.some(s => s.includes('journey.targetId')));
  assert.ok(previewEntityTransition(f.state, ship, 'retired', f).blockers.some(s => s.includes('journey')));
  f.runtime.applyAction(s => { cancelJourney(s, ship); retireEntity(s, 'supplyPlatform', f); });
  assert.equal(f.state.entities.supplyPlatform.lifecycle, 'retired');
  assert.equal(f.reload(f.saved).entities.supplyPlatform.lifecycle, 'retired');
});

test('explicit resolutions and lifecycle/contact changes roll back together on save failure', () => {
  const f = fixture(), ship = f.spawn(shipSpec()), npc = f.spawn(npcSpec({ locationId: ship }));
  const before = structuredClone(f.state);
  f.failSave(true);
  assert.throws(() => f.runtime.applyAction(s => { relocateNpc(s, npc, 'habitat', f.people); destroyEntity(s, ship, f); }), /Save failed/);
  assert.deepEqual(f.state, before);
  f.failSave(false);
  f.runtime.applyAction(s => { relocateNpc(s, npc, 'habitat', f.people); destroyEntity(s, ship, f); });
  assert.equal(f.state.entities[ship].lifecycle, 'destroyed');
  const stock = structuredClone(f.state.locations[ship]); f.runtime.advance(500);
  assert.deepEqual(f.state.locations[ship], stock);
  assert.equal(shipGraphView(f.state, f.world, f.content, 'vicinity').nodes.some(n => n.id === ship), false);
});

test('inactive instances suspend production, remain persistent, and reactivate explicitly', () => {
  const f = fixture(), ship = f.spawn(shipSpec({ resources: { power: 0 } }));
  f.runtime.applyAction(s => deactivateEntity(s, ship, f, { actorId: 'player' }));
  f.runtime.advance(100); assert.equal(f.state.locations[ship].resources.power, 0);
  assert.equal(f.reload(f.saved).entities[ship].lifecycle, 'inactive');
  f.runtime.applyAction(s => activateEntity(s, ship, f, { actorId: 'player' }));
  f.runtime.advance(100); assert.ok(f.state.locations[ship].resources.power > 0);
  assert.throws(() => f.runtime.applyAction(s => retireEntity(s, 'player', f)), /Player lifecycle/);
});

test('history at a retired generated site resolves after its definition is removed', () => {
  const f = fixture(), depot = f.spawn({ type: 'site', definitionId: 'depot', areaId: 'vicinity', ownerId: 'player', displayName: 'Remote bench', resources: { scrap: 40000 } });
  // Fixture placement only; experiments use the normal saved command boundary.
  f.runtime.applyAction(s => { s.locationId = depot; });
  f.registry.executeAction('research:experiment', { methodId: 'bench', items: ['scrap'] });
  assert.equal(f.state.research.attempts[0].locationId, depot);
  assert.equal(f.state.research.attempts[0].locationName, 'Remote bench');
  f.runtime.applyAction(s => { s.locationId = 'habitat'; retireEntity(s, depot, f); });
  const world = structuredClone(f.world); delete world.definitions.depot;
  const research = { ...f.research, world }, people = { ...f.people, world };
  const loaded = migrateState(f.saved, f.content, world, people, [], research);
  assert.equal(getEntityLabel(loaded, { world }, depot), 'Remote bench');
  assert.deepEqual(loaded.research.attempts, f.state.research.attempts);
  validateState(loaded, f.content, world, people, research);
});

test('a stale transition preview cannot authorize a now-occupied entity', () => {
  const f = fixture(), ship = f.spawn(shipSpec());
  assert.equal(previewEntityTransition(f.state, ship, 'retired', f).allowed, true);
  f.spawn(npcSpec({ locationId: ship }));
  assert.throws(() => f.runtime.applyAction(s => retireEntity(s, ship, f)), /must be resolved/);
  assert.equal(f.state.entities[ship].lifecycle, 'active');
});

test('the complete generated actor lifecycle uses the production bootstrap, runtime, and commands', () => {
  const f = fixture();
  const [ship, npc] = f.batch([shipSpec({ key: 'ship', displayName: 'Helix' }), npcSpec({ key: 'captain', displayName: 'Mara' })]);
  f.runtime.applyAction(s => setEntityController(s, ship, npc));
  f.registry.executeAction('dialogue:start', { npcId: npc });
  f.runtime.applyAction(s => { navigate(s, 'undock', null, f.world, f.content, ship, npc); navigate(s, 'travel', 'outerReach', f.world, f.content, ship, npc); });
  assert.deepEqual(f.reload(f.saved), f.state);
  f.runtime.advance(1000);
  f.runtime.applyAction(s => { retireEntity(s, npc, f); destroyEntity(s, ship, f); });
  assert.equal(f.state.dialogue.active, null); assert.equal(f.state.dialogue.met[npc], true);
  assert.equal(f.state.entities[ship].ownerId, 'player'); assert.equal(f.state.entities[ship].controllerId, npc);
  const frozen = structuredClone(f.state.locations[ship]); f.runtime.advance(200);
  assert.deepEqual(f.state.locations[ship], frozen); assert.deepEqual(f.reload(f.saved), f.state);
});

test('an explicitly composed domain collector participates in validation and lifecycle without registry schema changes', () => {
  const f = fixture(), ship = f.spawn(shipSpec());
  const collectors = [...f.referenceCollectors, s => s.testTargetId ? [entityReference('testTargetId', s.testTargetId, 'occupant')] : []];
  const systems = { ...f, referenceCollectors: collectors };
  const lifecycle = createStateLifecycle(systems);
  const runtime = createGameRuntime({ ...systems,
    validate: s => validateState(s, f.content, f.world, f.people, f.research, undefined, lifecycle),
    initialState: structuredClone(f.state), save() {} });
  runtime.applyAction(s => { s.testTargetId = ship; });
  assert.equal(previewEntityTransition(runtime.getState(), ship, 'retired', systems).allowed, false);
  const before = structuredClone(runtime.getState());
  assert.throws(() => runtime.applyAction(s => { s.testTargetId = 'missing'; }), /testTargetId/);
  assert.deepEqual(runtime.getState(), before);
  runtime.applyAction(s => { delete s.testTargetId; retireEntity(s, ship, systems); });
  assert.ok(referencesTo(runtime.getState(), 'habitat', collectors).some(r => r.source.includes('retained')));
});
