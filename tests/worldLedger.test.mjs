import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGameSystems } from '../js/bootstrap.js';
import { createStateLifecycleRegistry } from '../js/stateLifecycleRegistry.js';
import { createWorldLedgerServices, validateWorldLedger, collectWorldLedgerReferences,
  WORLD_LEDGER_LIMIT, LEDGER_ENTRY_SIZE_LIMIT, recentLedgerEntries, ledgerEntriesForEntity, ledgerEntriesAtLocation } from '../js/worldLedger.js';
import { createInitialState as coreInitial } from '../js/stateCore.js';
import { createInitialState as compatibilityInitial } from '../js/state.js';
import { fixture, shipSpec } from './entityFixtures.mjs';
import { createGameRuntime } from '../js/runtime.js';

const transfer = overrides => ({ type: 'RESOURCE_TRANSFERRED', actorId: 'player', targetId: 'supplyPlatform',
  locationId: 'habitat', areaId: 'vicinity', data: { sourceId: 'habitat', destinationId: 'supplyPlatform',
    resourceId: 'scrap', quantityKind: 'bulk', amount: 10000 }, ...overrides });
function setup() {
  const systems = buildGameSystems();
  return { ...systems, state: systems.stateServices.createInitialState(123) };
}

test('fresh ledger is composed for production, direct core and compatibility; v8 missing defaults only on load', () => {
  const f = setup(), { content, world, people, research } = f;
  for (const state of [f.state, coreInitial(content, world, people, research, 123),
    compatibilityInitial(content, world, people, research, 123)]) {
    assert.deepEqual(state.worldLedger, { nextId: 1, entries: [] }); assert.equal(state.saveVersion, 9);
  }
  const old = structuredClone(f.state); delete old.worldLedger;
  const source = structuredClone(old), notices = [];
  assert.throws(() => f.stateServices.validateState(old), /world-ledger/);
  const loaded = f.stateServices.migrateState(old, notices);
  assert.deepEqual(old, source); assert.deepEqual(loaded.worldLedger, f.state.worldLedger);
  assert.deepEqual(notices, []); assert.deepEqual(f.stateServices.migrateState(loaded), loaded);
  for (const malformed of [null, undefined, {}, { nextId: 0, entries: [] }, { nextId: 1, entries: [], extra: true }]) {
    const bad = { ...f.state, worldLedger: malformed }, before = structuredClone(bad);
    assert.throws(() => f.stateServices.migrateState(bad), /world-ledger/); assert.deepEqual(bad, before);
  }
});

test('fresh lifecycle initialization is ordered, synchronous and isolated from reconciliation', () => {
  const calls = [], state = {};
  const source = [{ id: 'slice', initialize(s) { calls.push('initialize'); s.example = []; },
    validate(s) { calls.push('validate'); assert.deepEqual(s.example, []); }, reconcile() { calls.push('reconcile'); } }];
  const registry = createStateLifecycleRegistry(source); source[0].initialize = () => assert.fail();
  registry.initialize(state); registry.validate(state); assert.deepEqual(calls, ['initialize', 'validate']);
  for (const initialize of [1, null]) assert.throws(() => createStateLifecycleRegistry([{ id: 'bad', initialize }]));
  const async = createStateLifecycleRegistry([{ id: 'async', initialize: () => Promise.resolve() }]);
  assert.throws(() => async.initialize({}), e => e.phase === 'initialize' && e.participantId === 'async' && /synchronous/.test(e.message));
  const f = setup(); assert.throws(() => f.stateLifecycle.initialize(f.state), /already initialized/);
});

test('append stamps deterministic IDs/time/defaults and isolates payload and query results', () => {
  const f = setup(), input = transfer(); f.state.simulationTime = 1.25;
  const entityCounter = f.state.entityIds.next;
  assert.equal(f.ledgerServices.append(f.state, input), 1); input.data.amount = 999;
  assert.equal(f.ledgerServices.append(f.state, transfer({ importance: 0.7 })), 2);
  const entries = recentLedgerEntries(f.state);
  assert.deepEqual(entries.map(e => [e.id, e.time, e.importance, e.data.amount]), [[2, 1.25, 0.7, 10000], [1, 1.25, 0.2, 10000]]);
  entries[0].data.amount = 1; assert.equal(f.state.worldLedger.entries[1].data.amount, 10000);
  assert.equal(f.state.entityIds.next, entityCounter); f.stateServices.validateState(f.state);
  assert.deepEqual(JSON.parse(JSON.stringify(f.state.worldLedger)), f.state.worldLedger);
});

test('append rejects invalid facts without modifying the ledger', () => {
  const f = setup(), before = structuredClone(f.state.worldLedger);
  const inputs = [transfer({ type: 'UNKNOWN' }), transfer({ id: 1 }), transfer({ time: 0 }), transfer({ extra: true }),
    transfer({ actorId: 'missing' }), transfer({ actorId: 'habitat' }), transfer({ targetId: 'vicinity' }),
    transfer({ importance: -0.1 }), transfer({ importance: NaN }), transfer({ importance: 1.1 }), transfer({ data: null }),
    transfer({ data: { ...transfer().data, resourceId: 'removed' } }),
    transfer({ data: { ...transfer().data, amount: 0 } }), transfer({ data: { ...transfer().data, amount: 0.5 } }),
    transfer({ data: { ...transfer().data, amount: Number.MAX_SAFE_INTEGER + 1 } }),
    transfer({ data: { ...transfer().data, amount: Infinity } }), transfer({ data: { ...transfer().data, amount: 1n } }),
    transfer({ data: { ...transfer().data, quantityKind: 'utility' } }), transfer({ data: { ...transfer().data, quantityKind: 'text' } }),
    transfer({ data: { ...transfer().data, sourceId: 'current' } }), transfer({ data: { ...transfer().data, destinationId: 'derelict' } }),
    transfer({ data: { ...transfer().data, text: 'prose'.repeat(2000) } }), transfer({ data: new Date() }),
    transfer({ data: { ...transfer().data, amount: undefined } }), transfer({ actorId: 'a'.repeat(129) })];
  const getter = transfer(); Object.defineProperty(getter.data, 'amount', { get() { assert.fail('getter ran'); }, enumerable: true }); inputs.push(getter);
  const cycle = transfer(); cycle.data.loop = cycle; inputs.push(cycle);
  const symbol = transfer(); symbol.data[Symbol('x')] = 1; inputs.push(symbol);
  for (const input of inputs) { assert.throws(() => f.ledgerServices.append(f.state, input)); assert.deepEqual(f.state.worldLedger, before); }
});

test('utility fractions are canonical while bulk and counted fractions are rejected', () => {
  const f = setup();
  f.ledgerServices.append(f.state, transfer({ data: { ...transfer().data, resourceId: 'power', quantityKind: 'utility', amount: 0.125 } }));
  f.ledgerServices.append(f.state, transfer({ data: { ...transfer().data, resourceId: 'iron', quantityKind: 'count', amount: 2 } }));
  assert.throws(() => f.ledgerServices.append(f.state, transfer({ data: { ...transfer().data, resourceId: 'iron', quantityKind: 'count', amount: 0.5 } })));
  assert.equal(recentLedgerEntries(f.state)[1].data.amount, 0.125);
});

test('FIFO retains newest provisional limit while historical validity permits pruning, gaps and empty windows', () => {
  const f = setup();
  for (let i = 0; i < WORLD_LEDGER_LIMIT + 3; i++) f.ledgerServices.append(f.state, transfer());
  assert.equal(f.state.worldLedger.entries.length, WORLD_LEDGER_LIMIT);
  assert.deepEqual(f.state.worldLedger.entries.map(e => e.id), Array.from({ length: WORLD_LEDGER_LIMIT }, (_, i) => i + 4));
  f.state.worldLedger.entries = f.state.worldLedger.entries.filter(e => e.id % 2 === 0);
  const next = f.state.worldLedger.nextId; validateWorldLedger(f.state);
  const loaded = f.stateServices.migrateState(f.state); assert.deepEqual(loaded, f.state);
  assert.equal(f.ledgerServices.append(loaded, transfer()), next);
  loaded.worldLedger.entries = []; validateWorldLedger(loaded);
  assert.equal(f.ledgerServices.append(loaded, transfer()), next + 1);
  const size = JSON.stringify(f.state.worldLedger).length;
  assert.ok(size < WORLD_LEDGER_LIMIT * LEDGER_ENTRY_SIZE_LIMIT + 100);
});

test('counter exhaustion, duplicate/reordered IDs, malformed arrays and invalid time fail without repair', () => {
  const f = setup(); f.state.simulationTime = 3;
  f.ledgerServices.append(f.state, transfer()); f.ledgerServices.append(f.state, transfer());
  for (const mutate of [s => s.worldLedger.entries.reverse(), s => s.worldLedger.entries[1].id = 1,
    s => s.worldLedger.nextId = 2, s => s.worldLedger.entries[0].time = 4,
    s => s.worldLedger.entries[0].time = -1, s => s.worldLedger.entries[1].time = 2,
    s => s.worldLedger.entries[0].importance = NaN, s => delete s.worldLedger.entries[0],
    s => s.worldLedger.entries.extra = true, s => s.worldLedger.entries[0].data.resourceId = '',
    s => s.worldLedger.entries[0].type = 'UNKNOWN', s => s.worldLedger.entries[0].actorId = 'missing']) {
    const bad = structuredClone(f.state); mutate(bad); const before = structuredClone(bad);
    assert.throws(() => validateWorldLedger(bad)); assert.deepEqual(bad, before);
  }
  const exhausted = structuredClone(f.state); exhausted.worldLedger.nextId = Number.MAX_SAFE_INTEGER;
  validateWorldLedger(exhausted); const before = structuredClone(exhausted);
  assert.throws(() => f.ledgerServices.append(exhausted, transfer()), /exhausted/); assert.deepEqual(exhausted, before);
});

test('historical content removal/kind changes remain valid on reload and subsequent save; append stays strict', () => {
  const f = setup(); f.ledgerServices.append(f.state, transfer());
  f.ledgerServices.append(f.state, { type: 'RESEARCH_COMPLETED', actorId: 'player', locationId: 'habitat', areaId: 'vicinity',
    data: { methodId: 'bench', discoveryId: 'structuralFabrication', attemptId: 1 } });
  f.ledgerServices.append(f.state, { type: 'EQUIPMENT_REPAIRED', actorId: 'player', targetId: 'habitat', locationId: 'habitat',
    data: { equipmentId: 'solar', previousHealth: 0.1, health: 1 } });
  // Only history is altered: all authoritative catalogs/state remain compatible.
  // These are the persisted IDs after their definitions have been removed/renamed.
  const old = structuredClone(f.state);
  old.worldLedger.entries[0].data.resourceId = 'removedResource';
  old.worldLedger.entries[1].data.methodId = 'removedMethod';
  old.worldLedger.entries[1].data.discoveryId = 'removedDiscovery';
  old.worldLedger.entries[2].data.equipmentId = 'removedEquipment';
  const loaded = f.stateServices.migrateState(old); assert.deepEqual(loaded, old);
  for (const entry of loaded.worldLedger.entries) {
    const { id, time, ...input } = entry;
    assert.throws(() => f.ledgerServices.append(loaded, input), /current|Unknown/);
  }
  const changed = createWorldLedgerServices({ resourceKind: () => 'utility' });
  assert.throws(() => changed.append(loaded, transfer()), /current resource/);
  assert.doesNotThrow(() => changed.validate(loaded));
  let saved;
  const runtime = createGameRuntime({ ...f, initialState: loaded, save: s => { saved = structuredClone(s); } });
  runtime.applyAction(s => { s.flags.unrelatedAction = true; });
  assert.deepEqual(saved.worldLedger, old.worldLedger);
});

test('historical validation needs no append capabilities and never requires present cargo or repair truth', () => {
  const f = setup(); f.ledgerServices.append(f.state, transfer());
  f.ledgerServices.append(f.state, { type: 'EQUIPMENT_REPAIRED', actorId: 'player', targetId: 'habitat', locationId: 'habitat',
    data: { equipmentId: 'solar', previousHealth: 0.1, health: 1 } });
  f.state.locations.habitat.resources.scrap = 0;
  f.state.locations.habitat.infrastructure.solar.health = 0.02;
  const history = createWorldLedgerServices(); history.validate(f.state);
  assert.throws(() => history.append(f.state, transfer()), /missing append capability/);
});

test('queries filter predictable facts with inclusive time, exclusive cursor and detached involvement results', () => {
  const f = setup();
  f.ledgerServices.append(f.state, transfer()); f.state.simulationTime = 1;
  f.ledgerServices.append(f.state, transfer({ importance: 0.7 })); f.state.simulationTime = 2;
  f.ledgerServices.append(f.state, { type: 'ENTITY_CREATED', targetId: 'mira', locationId: 'habitat', areaId: 'vicinity',
    data: { entityType: 'npc', initialLifecycle: 'active' } });
  assert.deepEqual(recentLedgerEntries(f.state, { since: 0, until: 1 }).map(e => e.id), [2, 1]);
  assert.deepEqual(recentLedgerEntries(f.state, { afterId: 1, minImportance: 0.6 }).map(e => e.id), [2]);
  assert.equal(recentLedgerEntries(f.state, { actorId: null })[0].id, 3);
  assert.equal(recentLedgerEntries(f.state, { type: 'RESOURCE_TRANSFERRED', areaId: 'vicinity', actorId: 'player', limit: 1 })[0].id, 2);
  assert.deepEqual(recentLedgerEntries(f.state, { limit: 0 }), []);
  assert.deepEqual(ledgerEntriesForEntity(f.state, 'supplyPlatform').map(e => e.id), [2, 1]);
  assert.deepEqual(ledgerEntriesAtLocation(f.state, 'habitat').map(e => e.id), [3, 2, 1]);
  assert.deepEqual(ledgerEntriesForEntity(f.state, 'scrap'), []);
  for (const q of [{ surprise: true }, { since: 2, until: 1 }, { since: -1 }, { minImportance: 2 },
    { afterId: -1 }, { limit: 0.5 }, { limit: WORLD_LEDGER_LIMIT + 1 }, { type: 'UNKNOWN' }, { actorId: 3 }])
    assert.throws(() => recentLedgerEntries(f.state, q));
  assert.throws(() => ledgerEntriesAtLocation(f.state, 'habitat', { locationId: 'derelict' }), /conflicting/);
});

test('persistent references outlive movement and retirement without blocking lifecycle transitions', () => {
  const f = fixture(), ship = f.spawn(shipSpec({ dockedAtId: null }));
  f.runtime.applyAction(s => f.ledgerServices.append(s, { type: 'ENTITY_CREATED', targetId: ship, locationId: ship, areaId: 'vicinity',
    data: { entityType: 'ship', initialLifecycle: 'active' } }));
  const refs = collectWorldLedgerReferences(f.state); assert.ok(refs.length > 0 && refs.every(r => r.policy === 'retain'));
  f.runtime.applyAction(s => f.worldOperations.retireEntity(s, ship));
  assert.equal(f.state.entities[ship].retained.name, 'Light freighter'); f.validate(f.state);
  assert.equal(ledgerEntriesForEntity(f.state, ship).length, 3);
  const before = f.state.worldLedger.entries[0];
  f.runtime.applyAction(s => f.worldOperations.relocateNpc(s, 'mira', 'derelict'));
  assert.equal(ledgerEntriesForEntity(f.state, 'habitat').some(e => e.type === 'NPC_RELOCATED'), true);
  assert.equal(ledgerEntriesForEntity(f.state, 'derelict').some(e => e.type === 'NPC_RELOCATED'), true);
  assert.deepEqual(f.state.worldLedger.entries[0], before);
  const bad = structuredClone(f.state); delete bad.entities[ship]; assert.throws(() => validateWorldLedger(bad), /Missing entity/);
});
