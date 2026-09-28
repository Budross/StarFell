import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, shipSpec, npcSpec } from './entityFixtures.mjs';
import { buildGameSystems, createEffectServices } from '../js/bootstrap.js';
import { createGameRuntime } from '../js/runtime.js';
import { compileEffects, applyEffects } from '../js/effects.js';
import { definitions } from '../js/content.js';
import { buildCatalog } from '../js/itemCatalog.js';
import { locationDefinitions } from '../js/locationContent.js';
import { npcDefinitions } from '../js/npcContent.js';
import { researchDefinitions } from '../js/research/researchContent.js';
import { createEntity } from '../js/entityCreation.js';
import { activateEntity, deactivateEntity } from '../js/entityLifecycle.js';
import { relocateNpc } from '../js/npcs.js';
import { transferBetweenLocations, getLocationContext } from '../js/locations.js';
import { moveExact } from '../js/resources.js';
import { ledgerEntriesForEntity, recentLedgerEntries, WORLD_LEDGER_LIMIT } from '../js/worldLedger.js';
import { withLedgerSaveRequest } from '../js/worldLedgerSimulation.js';
import { advanceSimulation, composeSimulationSteps } from '../js/simulationRegistry.js';
import { legacyState } from './legacyState.mjs';

const researchFact = () => ({ type: 'RESEARCH_COMPLETED', actorId: 'player', locationId: 'habitat', areaId: 'vicinity',
  data: { methodId: 'bench', discoveryId: 'structuralFabrication', attemptId: 1 } });
const effectRefs = f => ({ content: f.content, world: f.world, npcs: f.people.npcs, complete: true });

test('semantic spawn/batch/activation/deactivation/relocation have exactly one recording owner', () => {
  const f = fixture(); assert.equal(f.state.worldLedger.entries.length, 0);
  const ship = f.spawn(shipSpec());
  assert.equal(ledgerEntriesForEntity(f.state, ship).filter(e => e.type === 'ENTITY_CREATED').length, 1);
  const ids = f.batch([npcSpec(), shipSpec({ dockedAtId: null })]);
  assert.equal(f.state.worldLedger.entries.length, 3);
  for (const id of ids) assert.equal(ledgerEntriesForEntity(f.state, id).filter(e => e.type === 'ENTITY_CREATED').length, 1);
  f.runtime.applyAction(s => f.worldOperations.deactivateEntity(s, ship));
  f.runtime.applyAction(s => f.worldOperations.activateEntity(s, ship));
  f.runtime.applyAction(s => f.worldOperations.relocateNpc(s, 'mira', 'derelict', { actorId: 'player' }));
  const counter = f.state.worldLedger.nextId;
  f.runtime.applyAction(s => f.worldOperations.relocateNpc(s, 'mira', 'derelict'));
  assert.equal(f.state.worldLedger.nextId, counter);
  assert.equal(f.state.worldLedger.entries.filter(e => e.type === 'ENTITY_ACTIVATED').length, 1);
  assert.equal(f.state.worldLedger.entries.filter(e => e.type === 'ENTITY_DEACTIVATED').length, 1);
  const moved = recentLedgerEntries(f.state, { type: 'NPC_RELOCATED' });
  assert.equal(moved.length, 1); assert.equal(moved[0].data.initiatorId, 'player');
  assert.deepEqual(f.reload(f.state), f.state);
});

test('Round 2 item services record spawn, location activation, relocation and deactivation once with actual provenance', () => {
  const source = structuredClone(definitions), locations = structuredClone(locationDefinitions);
  locations.locations.supplyPlatform.initialLifecycle = 'inactive';
  source.items.radioAntenna.operations = [{ id: 'scanSignal', name: 'Scan', effects: [
    { type: 'spawnEntity', spec: { type: 'principal', displayName: 'New organization' } },
    { type: 'activateLocation', targetId: 'supplyPlatform' },
    { type: 'relocate', npcId: 'oren', destinationId: 'derelict' },
    { type: 'deactivateEntity', targetId: 'oren' }
  ] }];
  const f = fixture({ content: buildCatalog(source), locationSource: locations });
  f.runtime.applyAction(s => { s.locations.habitat.infrastructure.installedAntenna.quantity = 1; });
  f.registry.executeAction('scanSignal');
  assert.deepEqual(f.state.worldLedger.entries.map(e => e.type), ['ENTITY_CREATED', 'ENTITY_ACTIVATED', 'NPC_RELOCATED', 'ENTITY_DEACTIVATED']);
  const [created, activated, moved, deactivated] = f.state.worldLedger.entries;
  assert.equal(created.actorId, 'player'); assert.equal(activated.actorId, 'player');
  assert.equal(moved.actorId, 'oren'); assert.equal(moved.data.initiatorId, 'player');
  assert.equal(deactivated.actorId, 'player');
  assert.deepEqual(f.reload(f.saved).worldLedger, f.state.worldLedger);
  assert.throws(() => createEffectServices({ content: f.content, world: f.world, people: f.people }), /semantic world operations/);
});

test('captured effect provenance survives caller mutation and unknown initiator is not invented', () => {
  const f = fixture(), effects = compileEffects([{ type: 'relocate', npcId: 'mira', destinationId: 'derelict' },
    { type: 'deactivateEntity', targetId: 'oren' }], effectRefs(f));
  const trigger = { kind: 'item', locationId: 'habitat', actorId: 'player' };
  f.runtime.applyAction(s => applyEffects(s, effects, { ...f.effectServices,
    relocate(state, id, destination, captured) {
      trigger.actorId = 'oren'; f.effectServices.relocate(state, id, destination, captured);
    }
  }, trigger));
  assert.equal(f.state.worldLedger.entries[1].actorId, 'player');
  const unknown = compileEffects([{ type: 'activateEntity', targetId: 'oren' }], effectRefs(f));
  f.runtime.applyAction(s => applyEffects(s, unknown, f.effectServices));
  assert.equal(recentLedgerEntries(f.state)[0].actorId, null);
});

test('silent primitives, initial seeding, legacy migration and current content reconciliation append zero events', () => {
  const f = fixture();
  f.runtime.applyAction(s => {
    createEntity(s, f, shipSpec()); deactivateEntity(s, 'oren', f);
    activateEntity(s, 'oren', f); relocateNpc(s, 'mira', 'derelict', f.people);
  });
  assert.deepEqual(f.state.worldLedger, { nextId: 1, entries: [] });
  assert.deepEqual(f.reload(f.state).worldLedger, f.state.worldLedger);
  const base = buildGameSystems(), saved = base.stateServices.createInitialState();
  const changed = buildGameSystems({ npcSource: { ...structuredClone(npcDefinitions),
    newcomer: { name: 'Newcomer', description: 'New content.', initialLocationId: 'habitat' } } });
  const loaded = changed.stateServices.migrateState(saved);
  assert.ok(loaded.entities.newcomer); assert.deepEqual(loaded.worldLedger.entries, []);
  const old = legacyState(saved); assert.equal(Object.hasOwn(old, 'worldLedger'), false);
  assert.deepEqual(changed.stateServices.migrateState(old).worldLedger, { nextId: 1, entries: [] });
});

test('direct gameplay transfers record once, silent physical/composite movements do not produce duplicate facts', () => {
  const f = fixture(); f.runtime.applyAction(s => { s.locations.habitat.resources.scrap = 30000; });
  const payload = { sourceId: 'habitat', destinationId: 'supplyPlatform', assetId: 'scrap', amount: 10000 };
  f.registry.executeAction('transferLocations', payload);
  assert.deepEqual(f.state.worldLedger.entries[0].data, { sourceId: 'habitat', destinationId: 'supplyPlatform',
    resourceId: 'scrap', quantityKind: 'bulk', amount: 10000 });
  f.runtime.applyAction(s => transferBetweenLocations(s, payload, f.world, f.content));
  assert.equal(f.state.worldLedger.entries.length, 1);
  f.runtime.applyAction(s => {
    const a = getLocationContext(s, f.content, f.world, 'habitat').store;
    const b = getLocationContext(s, f.content, f.world, 'supplyPlatform').store;
    moveExact(a, b, 'scrap', 1000, f.content); moveExact(b, a, 'scrap', 1000, f.content);
    f.worldOperations.spawnEntity(s, { type: 'principal', displayName: 'Composite operation result' });
  });
  assert.deepEqual(f.state.worldLedger.entries.map(e => e.type), ['RESOURCE_TRANSFERRED', 'ENTITY_CREATED']);
});

test('repair and real experimental completion emit structured facts once without telemetry or generic discovery events', () => {
  const f = fixture();
  f.registry.executeAction('inspect:habitat:fitting'); f.registry.executeAction('salvage');
  f.registry.executeAction('research:experiment', { methodId: 'bench', items: ['scrap'] });
  assert.equal(f.state.worldLedger.entries.length, 1);
  assert.equal(f.state.worldLedger.entries[0].type, 'RESEARCH_COMPLETED');
  assert.equal(f.state.worldLedger.entries[0].data.attemptId, 1);
  f.runtime.applyAction(s => { s.locations.habitat.resources.iron = 2; });
  const previous = f.state.locations.habitat.infrastructure.solar.health;
  f.registry.executeAction('repairSolar');
  assert.equal(recentLedgerEntries(f.state)[0].type, 'EQUIPMENT_REPAIRED');
  assert.deepEqual(recentLedgerEntries(f.state)[0].data, { equipmentId: 'solar', previousHealth: previous, health: 1 });
  f.runtime.advance(0.2); assert.equal(f.state.worldLedger.entries.length, 2);
  f.runtime.applyAction(s => f.effectServices.discover(s, 'genericClue'));
  assert.equal(f.state.worldLedger.entries.length, 2);
});

test('research learning precedes reward-created entities and rolls back together if a later reward fails', () => {
  function source(blocked) {
    const source = structuredClone(researchDefinitions);
    const discovery = source.discoveries.structuralFabrication;
    discovery.threshold = 1;
    discovery.evidence = [{ id: 'metal', samples: { items: ['scrap'] }, insight: 1, once: true, observation: 'Test observation.' }];
    discovery.effects = [{ type: 'spawnEntity', spec: { type: 'principal', displayName: 'Reward organization' } },
      ...(blocked ? [{ type: 'deactivateEntity', targetId: 'habitat' }] : [])];
    return source;
  }
  for (const blocked of [false, true]) {
    const f = fixture({ researchSource: source(blocked) }); f.registry.executeAction('salvage');
    const before = structuredClone(f.state);
    const run = () => f.registry.executeAction('research:experiment', { methodId: 'bench', items: ['scrap'] });
    if (blocked) { assert.throws(run, /Nothing was spent/); assert.deepEqual(f.state, before); }
    else {
      run(); assert.deepEqual(f.state.worldLedger.entries.map(e => e.type), ['RESEARCH_COMPLETED', 'ENTITY_CREATED']);
      assert.equal(f.state.worldLedger.entries[1].actorId, 'player');
      assert.deepEqual(f.reload(f.saved).worldLedger, f.state.worldLedger);
    }
  }
});

test('ship facts distinguish area travel from docking, retain historical context, and omit progress updates', () => {
  const f = fixture(), ship = f.spawn(shipSpec());
  f.registry.executeAction(`board:${ship}`); f.registry.executeAction('undock');
  assert.equal(f.state.worldLedger.entries.length, 1);
  f.registry.executeAction('dock:supplyPlatform');
  const before = f.state.worldLedger.nextId;
  f.runtime.advance(0.1); assert.equal(f.state.worldLedger.nextId, before);
  f.runtime.advance(f.state.locations[ship].journey.remaining);
  const facts = ledgerEntriesForEntity(f.state, ship);
  assert.equal(facts[0].type, 'SHIP_ARRIVED'); assert.equal(facts[0].locationId, 'supplyPlatform');
  assert.equal(facts[0].data.kind, 'dock'); assert.equal(Object.hasOwn(facts[0].data, 'initiatorId'), false);
  assert.equal(facts[1].type, 'SHIP_DEPARTED'); assert.equal(facts[1].data.initiatorId, 'player');
  assert.equal(Object.hasOwn(facts[0].data, 'message'), false);
  f.registry.executeAction('undock'); f.registry.executeAction('travel:outerReach');
  f.runtime.advance(f.state.locations[ship].journey.remaining);
  assert.equal(recentLedgerEntries(f.state)[0].areaId, 'outerReach');
  assert.equal(recentLedgerEntries(f.state)[0].data.originAreaId, 'vicinity');
  assert.equal(facts[0].areaId, 'vicinity');
  assert.deepEqual(f.reload(f.saved).worldLedger, f.state.worldLedger);
});

test('later execution, validation and save failures roll back records, counters, FIFO eviction and entity creation', () => {
  for (const failure of ['execute', 'validate', 'save']) {
    const f = fixture({ composeStateDomains: domains => [...domains, { id: 'test-rejection',
      validate(s) { if (s.flags.rejectLedger) throw new Error('ledger transaction rejected'); } }] });
    f.runtime.applyAction(s => { for (let i = 0; i < WORLD_LEDGER_LIMIT; i++) f.ledgerServices.append(s, researchFact()); });
    const before = structuredClone(f.state), saved = structuredClone(f.saved);
    if (failure === 'save') f.failSave(true);
    assert.throws(() => f.runtime.applyAction(s => {
      f.worldOperations.spawnEntity(s, shipSpec()); s.flags.partial = true;
      if (failure === 'execute') throw new Error('later operation failed');
      if (failure === 'validate') s.flags.rejectLedger = true;
    }));
    assert.deepEqual(f.state, before); assert.deepEqual(f.saved, saved);
    f.failSave(false); const ship = f.spawn(shipSpec());
    assert.equal(f.state.worldLedger.entries.length, WORLD_LEDGER_LIMIT);
    assert.equal(recentLedgerEntries(f.state)[0].id, before.worldLedger.nextId);
    assert.equal(recentLedgerEntries(f.state)[0].targetId, ship);
  }
});

test('custom final-manifest steps automatically save their history even with undefined/false reports', () => {
  for (const report of [undefined, { saveRequested: false, output: { customValue: 7 } }]) {
    let writes = 0, validations = 0, constructions = 0;
    const systems = buildGameSystems({ composeSimulationSteps(steps, dependencies) {
      constructions++;
      return [...steps, { id: 'custom-history', advance(s) {
        dependencies.worldOperations.relocateNpc(s, 'mira', 'derelict'); return report;
      } }];
    } });
    const initial = systems.stateServices.createInitialState();
    let runtime;
    runtime = createGameRuntime({ ...systems, initialState: initial,
      validate(s) { validations++; systems.validate(s); }, save(s) { writes++; assert.equal(runtime.getState(), initial); assert.notEqual(s, initial); } });
    const result = runtime.advance(0.1);
    assert.equal(result.state.worldLedger.entries.length, 1); assert.equal(writes, 1); assert.equal(validations, 1);
    assert.equal(result.customValue, report?.output.customValue); assert.equal(constructions, 1);
    runtime.advance(0.1); assert.equal(writes, 1); assert.equal(validations, 1); // no-op relocation
  }
});

test('timed wrapping never sanitizes malformed or asynchronous reports after an append', () => {
  for (const report of [null, 1, [], Promise.resolve(), { saveRequested: 1 }, { surprise: true },
    { output: [] }, { output: { previous: true } }]) {
    const systems = buildGameSystems({ composeSimulationSteps: (steps, d) => [...steps,
      { id: 'invalid-history', advance(s) { d.ledgerServices.append(s, researchFact()); return report; } }] });
    const initial = systems.stateServices.createInitialState(); let saves = 0;
    const runtime = createGameRuntime({ ...systems, initialState: initial, save() { saves++; } });
    assert.throws(() => runtime.advance(0.1), e => e.participantId === 'invalid-history');
    assert.equal(runtime.getState(), initial); assert.equal(saves, 0); assert.equal(runtime.isPaused(), true);
  }
});

test('timed history is discarded if a later step, validation or save fails, including a full retained window', () => {
  for (const failure of ['step', 'validate', 'save']) {
    let laterRan = false;
    const systems = buildGameSystems({ composeSimulationSteps: (steps, d) => [...steps,
      { id: 'record', advance(s) { d.ledgerServices.append(s, researchFact()); s.flags.partial = true; } },
      { id: 'later', advance() { laterRan = true; if (failure === 'step') throw new Error('later step failed'); } }],
      composeStateDomains: domains => [...domains, { id: 'reject-frame', validate(s) {
        if (failure === 'validate' && s.flags.partial) throw new Error('frame rejected');
      } }] });
    const initial = systems.stateServices.createInitialState();
    for (let i = 0; i < WORLD_LEDGER_LIMIT; i++) systems.ledgerServices.append(initial, researchFact());
    const before = structuredClone(initial); let saves = 0;
    const runtime = createGameRuntime({ ...systems, initialState: initial, save() { saves++; if (failure === 'save') throw new Error('save failed'); } });
    assert.throws(() => runtime.advance(0.1)); assert.equal(laterRan, true);
    assert.equal(runtime.getState(), initial); assert.deepEqual(initial, before);
    assert.equal(runtime.isPaused(), true); assert.equal(saves, failure === 'save' ? 1 : 0);
  }
});

test('shared adapter preserves candidate, elapsed, context, order and domain output for isolated runtimes', () => {
  const f = fixture(), state = structuredClone(f.state), context = { tag: 1 }, calls = [];
  const steps = composeSimulationSteps([
    withLedgerSaveRequest({ id: 'a', advance(s, elapsed, ctx) {
      assert.equal(s, state); assert.equal(elapsed, 0.2); assert.equal(ctx, context); calls.push('a');
      f.ledgerServices.append(s, researchFact()); return { saveRequested: false, output: { domain: 'kept' } };
    } }),
    withLedgerSaveRequest({ id: 'b', advance() { calls.push('b'); } })
  ]);
  assert.deepEqual(advanceSimulation(state, 0.2, steps, context), { saveRequested: true, output: { domain: 'kept' } });
  assert.deepEqual(calls, ['a', 'b']);
});

test('separate game compositions have independent ledger services and no shared mutable history', () => {
  const a = fixture(), b = fixture();
  a.spawn(shipSpec()); assert.equal(b.state.worldLedger.nextId, 1);
  assert.notEqual(a.ledgerServices, b.ledgerServices);
  assert.notEqual(a.worldOperations, b.worldOperations);
  assert.deepEqual(b.reload(b.state).worldLedger, { nextId: 1, entries: [] });
});
