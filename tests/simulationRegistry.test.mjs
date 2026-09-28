import assert from 'node:assert/strict';
import { test } from 'node:test';
import { composeSimulationSteps, advanceSimulation } from '../js/simulationRegistry.js';
import { createGameRuntime } from '../js/runtime.js';
import { buildGameSystems } from '../js/bootstrap.js';
import { advanceGame } from '../js/game.js';
import { advanceJourneys } from '../js/ships.js';
import { reconcileContact } from '../js/dialogue.js';
import { fixture, shipSpec } from './entityFixtures.mjs';

test('simulation uses one candidate and explicit order, elapsed seconds, context, and report ownership', () => {
  const state = { count: 0 }, context = { token: 1 }, calls = [];
  const source = [
    { id: 'first', advance(s, elapsed, ctx) {
      assert.equal(s, state); assert.equal(elapsed, 300); assert.equal(ctx, context);
      calls.push('first'); s.count++; return { saveRequested: true, output: { first: s.count } };
    } },
    { id: 'second', advance(s) { calls.push('second'); assert.equal(s.count, 1); return { saveRequested: false, output: { second: 2 } }; } },
    { id: 'third', advance() { calls.push('third'); } }
  ];
  const steps = composeSimulationSteps(source);
  source.reverse(); source[0].advance = () => assert.fail('caller mutation leaked');
  assert.deepEqual(advanceSimulation(state, 300, steps, context), { saveRequested: true, output: { first: 1, second: 2 } });
  assert.deepEqual(calls, ['first', 'second', 'third']);
  assert.ok(Object.isFrozen(steps) && steps.every(Object.isFrozen));
  assert.equal(Object.isFrozen(source), false);
});

test('simulation rejects malformed manifests, reports, promises, duplicate and reserved output keys', () => {
  for (const input of [undefined, {}, [null], [{ id: '', advance() {} }], [{ id: 'bad' }],
    [{ id: 'a', advance() {} }, { id: 'a', advance() {} }]]) assert.throws(() => composeSimulationSteps(input));
  for (const report of [null, 1, [], Promise.resolve(), { saveRequested: 1 }, { surprise: true },
    { output: [] }, { output: null }, { output: { previous: 1 } }, { output: { state: 1 } },
    { output: JSON.parse('{"__proto__":1}') }]) {
    assert.throws(() => advanceSimulation({}, 1, composeSimulationSteps([{ id: 'bad', advance: () => report }])),
      error => error.participantId === 'bad' && error.phase === 'advance' && !!error.cause);
  }
  assert.throws(() => advanceSimulation({}, 1, composeSimulationSteps([
    { id: 'a', advance: () => ({ output: { same: 1 } }) },
    { id: 'b', advance: () => ({ output: { same: 2 } }) }
  ])), /"b".*duplicate simulation output: same/);
});

test('simulation errors preserve cause and stop before later participants', () => {
  const cause = new Error('original failure'), calls = [];
  assert.throws(() => advanceSimulation({}, 1, composeSimulationSteps([
    { id: 'broken', advance() { throw cause; } },
    { id: 'later', advance() { calls.push('later'); } }
  ])), error => error.cause === cause && error.participantId === 'broken' && /original failure/.test(error.message));
  assert.deepEqual(calls, []); assert.equal(cause.message, 'original failure');
});

test('bootstrap inserts a fake timed capability only at construction, independently per game', () => {
  let constructions = 0, advances = 0;
  const a = buildGameSystems({ composeSimulationSteps(defaults) {
    constructions++;
    return [defaults[0], { id: 'fake', advance(state, elapsed) {
      assert.equal(state.simulationTime, elapsed * ++advances);
      state.flags.fake = true; return { saveRequested: true, output: { fakeElapsed: elapsed } };
    } }, ...defaults.slice(1)];
  } });
  const b = buildGameSystems(), writes = [];
  const runtime = createGameRuntime({ ...a, initialState: a.stateServices.createInitialState(), save: s => writes.push(structuredClone(s)) });
  const report = runtime.advance(0.25);
  assert.equal(report.fakeElapsed, 0.25); assert.equal(report.state.flags.fake, true);
  assert.deepEqual(report.arrivals, []); assert.equal(report.closure, ''); assert.equal(writes.length, 1);
  runtime.advance(0.25); assert.equal(constructions, 1);
  assert.equal(b.simulationSteps.some(step => step.id === 'fake'), false);
  assert.equal(b.stateServices.createInitialState().flags.fake, undefined);
});

test('default power, arrival and contact results match existing domain behavior on a shared candidate', () => {
  const order = [];
  const f = fixture({ composeSimulationSteps: defaults => defaults.map(step => ({ ...step,
    advance(state, elapsed, context) { order.push(step.id); return step.advance(state, elapsed, context); }
  })) }), ship = f.spawn(shipSpec());
  f.registry.executeAction(`board:${ship}`); f.registry.executeAction('undock');
  f.registry.executeAction('dock:supplyPlatform');
  const initial = structuredClone(f.state);
  // A stale contact must close during the update, after the arrival.
  initial.dialogue.active = { npcId: 'oren', locationId: 'habitat', sessionId: 1, revision: 0,
    phase: 'topics', conversationId: null, nodeId: null };
  initial.dialogue.nextSession = 2;
  const expected = structuredClone(initial), elapsed = initial.locations[ship].journey.remaining;
  advanceGame(expected, elapsed, f.content, f.contextFor);
  const arrivals = advanceJourneys(expected, elapsed, f.world, f.ledgerServices);
  const closure = reconcileContact(expected, f.people);
  let saved;
  const runtime = createGameRuntime({ ...f, initialState: initial, save(candidate) {
    assert.equal(runtime.getState(), initial); saved = structuredClone(candidate);
  } });
  const report = runtime.advance(elapsed);
  assert.deepEqual(report, { previous: initial, state: expected, arrivals, closure });
  assert.equal(report.state.simulationTime, initial.simulationTime + elapsed);
  assert.equal(arrivals.length, 1);
  assert.equal(closure, 'Conversation with Oren ended; local contact was lost.');
  assert.deepEqual(saved, expected);
  assert.deepEqual(order, ['power', 'journeys', 'contacts']);
});

test('a failed middle step rolls back the frame, preserves cadence, and successful actions recover', () => {
  let fail = true, later = 0, saves = 0;
  const cause = new Error('step failure');
  const systems = buildGameSystems({ composeSimulationSteps(defaults) {
    return [defaults[0], { id: 'failure', advance(state) { if (fail && state.simulationTime >= 5) { state.flags.partial = true; throw cause; } } },
      ...defaults.slice(1), { id: 'later', advance() { later++; } }];
  } });
  const runtime = createGameRuntime({ ...systems, initialState: systems.stateServices.createInitialState(), save() { saves++; } });
  runtime.advance(4); const committed = runtime.getState();
  assert.throws(() => runtime.advance(1), error => error.cause === cause);
  assert.equal(runtime.getState(), committed); assert.equal(committed.flags.partial, undefined);
  assert.equal(later, 1); assert.equal(saves, 0); assert.equal(runtime.isPaused(), true);
  assert.equal(runtime.advance(1), null);
  // A successful saved action resumes advancement and restarts the cadence.
  fail = false;
  runtime.applyAction(() => {}); assert.equal(runtime.isPaused(), false); assert.equal(saves, 1);
  runtime.advance(4); assert.equal(saves, 1);
  runtime.advance(1); assert.equal(saves, 2);
});

test('frame validation failure leaves the committed candidate untouched and pauses before saving', () => {
  const systems = buildGameSystems({ composeStateDomains: defaults => [...defaults, {
    id: 'frame-validation', validate(s) { if (s.simulationTime >= 5) throw new Error('frame rejected'); }
  }] });
  let saves = 0;
  const runtime = createGameRuntime({ ...systems, initialState: systems.stateServices.createInitialState(), save() { saves++; } });
  runtime.advance(4); const before = runtime.getState();
  assert.throws(() => runtime.advance(1), error => error.participantId === 'frame-validation' && error.phase === 'validate');
  assert.equal(runtime.getState(), before); assert.equal(before.simulationTime, 4);
  assert.equal(runtime.isPaused(), true); assert.equal(saves, 0);
});

test('runtime validates capability inputs, ignores invalid elapsed, and freezes supplied step order', () => {
  assert.throws(() => createGameRuntime({ initialState: {}, save() {} }), /requires composed/);
  const source = [{ id: 'tick', advance(s, elapsed) { s.time += elapsed; } }];
  let validations = 0, saves = 0;
  const initialState = { time: 0 };
  const runtime = createGameRuntime({ initialState, simulationSteps: source, reconcileAction: () => '',
    validate() { validations++; }, save() { saves++; } });
  source.length = 0;
  for (const elapsed of [0, -1, NaN, Infinity, undefined]) assert.equal(runtime.advance(elapsed), null);
  assert.equal(runtime.getState(), initialState);
  runtime.advance(1); assert.equal(runtime.getState().time, 1); assert.equal(validations, 0); assert.equal(saves, 0);
  runtime.flush(); assert.equal(saves, 1); assert.equal(validations, 0);
});
