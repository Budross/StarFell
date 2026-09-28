import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStateLifecycleRegistry } from '../js/stateLifecycleRegistry.js';
import { createStateDomains, createStateLifecycle } from '../js/stateComposition.js';
import { buildGameSystems } from '../js/bootstrap.js';
import { createGameRuntime } from '../js/runtime.js';
import { validateState, migrateState } from '../js/stateCore.js';
import * as compatibility from '../js/state.js';
import { legacyState } from './legacyState.mjs';

test('state phases preserve explicit order, candidate/context identity, and immutable snapshots', () => {
  const calls = [], state = {}, context = { notices: [] };
  const source = [
    { id: 'validate-only', validate(s, c) { assert.equal(s, state); assert.equal(c, context); calls.push('first'); } },
    { id: 'both', validate() { calls.push('second'); }, reconcile(s, c) { s.repaired = true; c.notices.push('repaired'); calls.push('repair'); } },
    { id: 'reconcile-only', reconcile() { calls.push('last'); } }
  ];
  const registry = createStateLifecycleRegistry(source);
  source.reverse(); source[0].reconcile = () => assert.fail('mutation leaked');
  registry.validate(state, context); assert.deepEqual(state, {});
  registry.reconcile(state, context);
  assert.deepEqual(calls, ['first', 'second', 'repair', 'last']);
  assert.deepEqual(state, { repaired: true }); assert.deepEqual(context.notices, ['repaired']);
  assert.ok(Object.isFrozen(registry) && Object.isFrozen(registry.domains) && registry.domains.every(Object.isFrozen));
  assert.equal(Object.isFrozen(source), false);
});

test('state descriptors and asynchronous hooks fail with participant, phase and original cause', () => {
  for (const domains of [null, {}, [null], [{ id: 'empty' }], [{ id: '', validate() {} }],
    [{ id: 'bad', validate: 1, reconcile() {} }], [{ id: 'a', validate() {} }, { id: 'a', reconcile() {} }]])
    assert.throws(() => createStateLifecycleRegistry(domains));
  for (const phase of ['validate', 'reconcile']) {
    let later = false;
    const cause = new Error('underlying detail');
    const registry = createStateLifecycleRegistry([
      { id: 'failed', [phase]() { throw cause; } }, { id: 'later', [phase]() { later = true; } }
    ]);
    assert.throws(() => registry[phase]({}, {}), error => error.cause === cause && error.phase === phase &&
      error.participantId === 'failed' && error.message.endsWith('underlying detail'));
    assert.equal(later, false); assert.equal(cause.message, 'underlying detail');
    const asynchronous = createStateLifecycleRegistry([{ id: 'async', [phase]: () => Promise.resolve() }]);
    assert.throws(() => asynchronous[phase]({}), /"async".*synchronous/);
  }
});

test('a persistent capability joins startup, loads, actions and saved frames through construction alone', () => {
  const calls = [];
  let constructions = 0;
  const systems = buildGameSystems({ composeStateDomains(defaults) {
    constructions++;
    return [...defaults, { id: 'fake',
      validate(state) { calls.push(['validate', state.saveVersion]); if (state.flags.fake === false) throw new Error('fake rejected'); },
      reconcile(state, context) { calls.push(['reconcile', state.saveVersion, context.reconcileCurrentInstances]);
        state.flags.fake = true; context.notices.push('fake repaired'); }
    }];
  } });
  const initial = systems.stateServices.createInitialState(123);
  assert.deepEqual(calls, [['validate', 9]]);
  const notices = [], loaded = systems.stateServices.migrateState(initial, notices);
  assert.equal(loaded.flags.fake, true); assert.deepEqual(notices, ['fake repaired']);
  assert.deepEqual(calls.slice(1), [['reconcile', 9, true], ['validate', 9]]);
  const runtime = createGameRuntime({ ...systems, initialState: loaded, save() {} });
  runtime.applyAction(() => {}); runtime.advance(5);
  assert.deepEqual(calls.slice(-2), [['validate', 9], ['validate', 9]]);
  const before = runtime.getState();
  assert.throws(() => runtime.applyAction(s => { s.flags.fake = false; }), /"fake".*fake rejected/);
  assert.equal(runtime.getState(), before);
  assert.equal(constructions, 1);
  const independent = buildGameSystems();
  assert.equal(independent.stateLifecycle.domains.some(d => d.id === 'fake'), false);
  assert.equal(independent.stateServices.createInitialState().flags.fake, undefined);
});

test('legacy versions use frozen migration before custom current hooks, with current-only instance repair', () => {
  const calls = [];
  const systems = buildGameSystems({ composeStateDomains(defaults) {
    return [...defaults, { id: 'observer', reconcile(state, context) {
      assert.equal(state.saveVersion, 9); assert.ok(state.entities.player);
      calls.push(context.reconcileCurrentInstances);
    }, validate(state) { assert.equal(state.saveVersion, 9); } }];
  } });
  const literal = JSON.parse(readFileSync(new URL('./fixtures/storage-legacy-saves.json', import.meta.url)));
  for (let version = 1; version <= 7; version++) {
    const saved = version === 7 ? legacyState(systems.stateServices.createInitialState(123)) : literal[version];
    const original = structuredClone(saved), notices = [];
    const migrated = systems.stateServices.migrateState(saved, notices);
    assert.deepEqual(saved, original); assert.equal(migrated.saveVersion, 9);
    assert.equal(calls.at(-1), false);
    const reloadNotices = [];
    assert.deepEqual(systems.stateServices.migrateState(migrated, reloadNotices), migrated);
    assert.equal(calls.at(-1), true); assert.deepEqual(reloadNotices, []);
  }
  assert.deepEqual(calls, Array.from({ length: 7 }, () => [false, true]).flat());
});

test('one default manifest serves bootstrap, direct core and compatibility callers', () => {
  const systems = buildGameSystems(), { content, world, people, research } = systems;
  const initial = systems.stateServices.createInitialState(123);
  const original = structuredClone(initial);
  const expectedIds = ['entities', 'authority', 'vessels', 'entity-instances', 'ships', 'dialogue',
    'knowledge-flags', 'research', 'world-ledger', 'entity-references', 'processing', 'crafting-selection'];
  assert.deepEqual(createStateDomains(systems).map(d => d.id), expectedIds);
  assert.deepEqual(systems.stateLifecycle.domains.map(d => d.id), expectedIds);
  validateState(initial, content, world, people, research);
  compatibility.validateState(initial, content, world, people, research);
  assert.deepEqual(initial, original);
  assert.deepEqual(migrateState(initial, content, world, people, [], research), original);
  assert.deepEqual(compatibility.migrateState(initial, content, world, people, [], research), original);
  assert.deepEqual(compatibility.createInitialState(content, world, people, research, 123), original);
});

test('compatibility wrappers forward composed lifecycle and collector overrides', () => {
  const systems = buildGameSystems(), { content, world, people, research } = systems;
  let validations = 0, reconciliations = 0;
  const lifecycle = createStateLifecycle(systems, [...createStateDomains(systems), {
    id: 'fake', validate() { validations++; }, reconcile() { reconciliations++; }
  }]);
  const initial = compatibility.createInitialState(content, world, people, research, 123, lifecycle);
  compatibility.validateState(initial, content, world, people, research, undefined, lifecycle);
  compatibility.migrateState(initial, content, world, people, [], research, undefined, lifecycle);
  assert.equal(validations, 3); assert.equal(reconciliations, 1);
  const cause = new Error('custom collector failed');
  assert.throws(() => compatibility.validateState(initial, content, world, people, research, [() => { throw cause; }]),
    error => error.participantId === 'entity-references' && error.cause === cause);
});

test('current validation preserves entity iteration and first-error order', () => {
  const systems = buildGameSystems(), state = systems.stateServices.createInitialState();
  state.locations.habitat.resources.scrap = -1;
  state.npcs.mira.inventory.scrap = -1;
  state.crafting.recipeId = 'missing';
  assert.throws(() => systems.stateServices.validateState(state),
    error => error.participantId === 'entity-instances' && /quantity/.test(error.cause.message));
  state.locations.habitat.resources.scrap = 0;
  assert.throws(() => systems.stateServices.validateState(state), error => error.participantId === 'entity-instances' && /mira/.test(error.cause.message));
  state.npcs.mira.inventory.scrap = 0;
  assert.throws(() => systems.stateServices.validateState(state), /"crafting-selection".*Invalid crafting selection/);
  state.saveVersion = 10;
  assert.throws(() => systems.stateServices.validateState(state), error => !error.participantId && /Unsupported/.test(error.message));
});

test('reconciliation failures retain caller saves and stop later domains', () => {
  let later = false;
  const cause = new Error('repair stopped');
  const systems = buildGameSystems({ composeStateDomains(defaults) {
    return [...defaults, { id: 'failure', reconcile(s) { s.flags.partial = true; throw cause; } },
      { id: 'later', reconcile() { later = true; } }];
  } });
  const saved = systems.stateServices.createInitialState(), before = structuredClone(saved);
  assert.throws(() => systems.stateServices.migrateState(saved), error => error.cause === cause && error.phase === 'reconcile');
  assert.deepEqual(saved, before); assert.equal(later, false);
});

test('current entity repair precedes dialogue/research and retains preflight failure attribution', () => {
  const calls = [];
  const systems = buildGameSystems({ composeStateDomains(defaults) {
    return defaults.map(domain => ({ ...domain, ...(domain.reconcile ? { reconcile(state, context) {
      calls.push(domain.id); return domain.reconcile(state, context);
    } } : {}) }));
  } });
  const saved = systems.stateServices.createInitialState();
  systems.stateServices.migrateState(saved);
  assert.deepEqual(calls, ['vessels', 'entity-instances', 'dialogue', 'research', 'world-ledger', 'processing']);
  calls.length = 0;
  saved.entityIds.next = 0;
  const before = structuredClone(saved);
  assert.throws(() => systems.stateServices.migrateState(saved), error => error.participantId === 'entity-instances' && error.phase === 'reconcile');
  assert.deepEqual(calls, ['vessels', 'entity-instances']); assert.deepEqual(saved, before);
});

test('production import graph stays acyclic and generic engines have no domain dependencies', () => {
  const root = fileURLToPath(new URL('../js/', import.meta.url)), graph = new Map();
  function visitFile(file) {
    if (graph.has(file)) return;
    const text = readFileSync(file, 'utf8');
    const imports = [...text.matchAll(/^\s*(?:import|export)\s+(?:[^;\n]*?\s+from\s+)?["']([^"']+)["']/gm)]
      .map(match => match[1]).filter(specifier => specifier.startsWith('.')).map(specifier => resolve(dirname(file), specifier.split(/[?#]/)[0]));
    graph.set(file, imports); imports.forEach(visitFile);
  }
  function visitDirectory(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name);
      if (entry.isDirectory()) visitDirectory(file);
      else if (entry.name.endsWith('.js')) visitFile(file);
    }
  }
  visitDirectory(root);
  const done = new Set(), active = new Set();
  function walk(file) {
    assert.equal(active.has(file), false, `Import cycle at ${file}`);
    if (done.has(file)) return;
    active.add(file); graph.get(file).forEach(walk); active.delete(file); done.add(file);
  }
  [...graph.keys()].forEach(walk);
  assert.deepEqual(graph.get(resolve(root, 'simulationRegistry.js')), []);
  assert.deepEqual(graph.get(resolve(root, 'stateLifecycleRegistry.js')), []);
  assert.deepEqual(graph.get(resolve(root, 'runtime.js')), [resolve(root, 'simulationRegistry.js')]);
  assert.equal(graph.get(resolve(root, 'stateComposition.js')).includes(resolve(root, 'bootstrap.js')), false);
  assert.equal(graph.get(resolve(root, 'stateComposition.js')).includes(resolve(root, 'stateCore.js')), false);
});
