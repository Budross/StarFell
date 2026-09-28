import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, shipSpec } from './entityFixtures.mjs';
import { legacyState } from './legacyState.mjs';
import { migrateState } from '../js/stateCore.js';
import { ownerOf, canUse } from '../js/authority.js';
import { retireEntity } from '../js/entityLifecycle.js';
import { allocateEntityId } from '../js/entities.js';

test('version seven migrates authority once, preserving assets, history, and independent RNG', () => {
  const f = fixture(); f.registry.executeAction('salvage');
  const old = legacyState(f.state), original = structuredClone(old), notices = [];
  const next = migrateState(old, f.content, f.world, f.people, notices, f.research);
  assert.deepEqual(old, original); assert.equal(next.saveVersion, 9);
  assert.equal(next.entities.habitat.ownerId, 'player'); assert.equal(next.entities.habitat.controllerId, null);
  assert.equal(Object.hasOwn(next.locations.habitat, 'ownerId'), false);
  assert.deepEqual(next.locations, f.state.locations); assert.deepEqual(next.research, f.state.research);
  assert.deepEqual(next.dialogue, f.state.dialogue); assert.ok(notices.some(n => n.includes('identities')));
  assert.deepEqual(f.reload(next), next);
});

test('unknown legacy title owners become inert identities, never guessed factions or public assets', () => {
  const f = fixture(), old = legacyState(f.state);
  old.locations.habitat.ownerId = 'oldCompany';
  const next = f.reload(old);
  assert.equal(ownerOf(next, 'habitat'), 'oldCompany');
  assert.equal(next.entities.oldCompany.role, 'legacy');
  assert.equal(canUse(next, 'oldCompany', 'habitat', 'withdrawCargo'), false);
  assert.equal(canUse(next, 'player', 'habitat', 'withdrawCargo'), false);
  old.locations.habitat.ownerId = 'derelict';
  assert.throws(() => f.reload(old), /non-principal/);
});

test('legacy historical-only references receive retained identities while malformed/live references still fail', () => {
  const f = fixture(), old = legacyState(f.state);
  old.dialogue.met.departed = true;
  old.dialogue.history[JSON.stringify(['oldTopic', 'npcLocation', 'departed', 'oldStation'])] = { completed: true, choices: {} };
  const next = f.reload(old);
  assert.equal(next.entities.departed.lifecycle, 'retired'); assert.equal(next.entities.oldStation.type, 'site');
  assert.deepEqual(next.dialogue.history, old.dialogue.history); assert.deepEqual(f.reload(next), next);
  const invalid = structuredClone(old); invalid.npcs.mira.locationId = 'missing'; assert.throws(() => f.reload(invalid), /location/);
  invalid.dialogue.history.bad = {}; assert.throws(() => f.reload(invalid));
});

test('current saves reject missing/orphan state and do not resurrect terminal authored entities', () => {
  const f = fixture(); f.runtime.applyAction(s => retireEntity(s, 'supplyPlatform', f));
  const loaded = f.reload(f.saved);
  assert.equal(loaded.entities.supplyPlatform.lifecycle, 'retired');
  assert.deepEqual(f.reload(loaded), loaded);
  for (const mutate of [s => delete s.locations.habitat, s => delete s.entities.habitat, s => delete s.npcs.mira, s => delete s.entities.mira]) {
    const invalid = structuredClone(loaded); mutate(invalid); const before = structuredClone(invalid);
    assert.throws(() => f.reload(invalid)); assert.deepEqual(invalid, before);
  }
});

test('missing live definitions, invalid allocator state, and mixed ownership fail without mutating saves', () => {
  const f = fixture(), ship = f.spawn(shipSpec());
  for (const mutate of [s => s.entities[ship].definition.id = 'missing', s => s.entityIds.next = 1,
    s => s.locations.habitat.ownerId = 'player', s => s.entities[ship].id = 'other']) {
    const invalid = structuredClone(f.state); mutate(invalid); const before = structuredClone(invalid);
    assert.throws(() => f.reload(invalid)); assert.deepEqual(invalid, before);
  }
});

test('legacy identity strings in the generated namespace reserve their sequence permanently', () => {
  const f = fixture(), old = legacyState(f.state);
  old.locations.habitat.ownerId = 'gen_ship_9';
  const next = f.reload(old);
  assert.equal(next.entities.gen_ship_9.type, 'principal');
  assert.equal(next.entityIds.next, 10);
  assert.equal(allocateEntityId(next, 'ship'), 'gen_ship_10');
});
