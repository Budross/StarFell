import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, shipSpec, npcSpec } from './entityFixtures.mjs';
import { getEntity, hasEntity, allocateEntityId, isEntityActive } from '../js/entities.js';
import { getEntityLocation, getEntityLabel, resolveEntityDefinition } from '../js/entityQueries.js';
import { createEntity } from '../js/entityCreation.js';
import { navigate, shipGraphView } from '../js/ships.js';
import { transferOptions } from '../js/locations.js';
import { npcInstances } from '../js/entityQueries.js';
import { dialogueView } from '../js/dialogue.js';

test('authored identities and reusable definitions are distinct, with one canonical store and owner', () => {
  const f = fixture();
  assert.ok(hasEntity(f.state, 'habitat')); assert.ok(hasEntity(f.state, 'mira'));
  assert.equal(hasEntity(f.state, 'freighter'), false);
  assert.equal(hasEntity(f.state, 'merchant'), false);
  assert.equal(f.state.entities.habitat.ownerId, 'player');
  assert.equal(Object.hasOwn(f.state.locations.habitat, 'ownerId'), false);
  const a = f.spawn(shipSpec({ displayName: 'Carina' })), b = f.spawn(shipSpec({ displayName: 'Helix' }));
  assert.notEqual(a, b); assert.equal(resolveEntityDefinition(f.state, f, a).id, 'freighter');
  assert.equal(getEntityLabel(f.state, f, a), 'Carina');
  f.runtime.applyAction(s => { s.locations[a].resources.scrap = 0; });
  assert.equal(f.state.locations[b].resources.scrap, 30000);
  assert.deepEqual(f.reload(f.saved), f.state);
  assert.equal(f.spawn(shipSpec()), 'gen_ship_3');
});

test('creation and ID allocation roll back on invalid bindings and failed saves without changing catalogs/actions', () => {
  const f = fixture(), before = structuredClone(f.state), catalog = structuredClone(f.world), actions = f.actions.map(a => a.id);
  assert.throws(() => f.spawn(shipSpec({ areaId: 'missing' })), /area|target/i);
  assert.deepEqual(f.state, before);
  f.failSave(true); assert.throws(() => f.spawn(shipSpec()), /Save failed/); f.failSave(false);
  assert.deepEqual(f.state, before); assert.deepEqual(f.world, catalog); assert.deepEqual(f.actions.map(a => a.id), actions);
  assert.equal(f.spawn(shipSpec()), 'gen_ship_1');
  assert.throws(() => f.runtime.applyAction(s => { s.entityIds.next = Number.MAX_SAFE_INTEGER; allocateEntityId(s, 'ship'); }), /counter/);
  assert.throws(() => f.spawn({ type: 'npc', definitionId: 'mira', locationId: 'habitat' }), /template/);
  assert.throws(() => f.spawn(shipSpec({ areaId: { ref: 'absent' } })), /binding/);
});

test('batch creation binds actor and container identities before validating the final state', () => {
  const f = fixture();
  const [ship, npc] = f.batch([shipSpec({ key: 'ship', controllerId: { ref: 'captain' } }), npcSpec({ key: 'captain', locationId: { ref: 'ship' } })]);
  assert.equal(f.state.entities[ship].controllerId, npc);
  assert.equal(getEntityLocation(f.state, npc).locationId, ship);
  assert.equal(getEntityLocation(f.state, npc).areaId, 'vicinity');
});

test('generated ships use normal target commands, scenes, maps, transfers, and reload', () => {
  const f = fixture(), ship = f.spawn(shipSpec({ displayName: 'Carina' }));
  assert.ok(shipGraphView(f.state, f.world, f.content, 'vicinity').nodes.some(n => n.id === ship));
  assert.ok(transferOptions(f.state, f.world, f.content).endpoints.some(n => n.id === ship));
  assert.equal(f.registry.resolveAction('Board Carina'), `board:${ship}`);
  f.registry.executeAction('board', { targetId: ship });
  assert.equal(f.state.locationId, ship);
  f.registry.executeAction(`inspect:${ship}:bridge`);
  assert.equal(f.state.locations[ship].flags['examined:bridge'], true);
  assert.equal(f.registry.resolveAction('Inspect Bridge console'), null);
  f.registry.executeAction('undock'); f.registry.executeAction('travel:outerReach');
  assert.deepEqual(f.reload(f.saved), f.state);
  f.runtime.advance(1000);
  assert.equal(f.state.locations[ship].areaId, 'outerReach'); assert.equal(f.state.locationId, ship);
});

test('generated NPCs use normal contact and independent encounter histories', () => {
  const f = fixture(), a = f.spawn(npcSpec({ displayName: 'Edda' })), b = f.spawn(npcSpec({ displayName: 'Suri' }));
  assert.ok(npcInstances(f.state, f.people).some(n => n.id === a));
  f.registry.executeAction('dialogue:start', { npcId: a });
  assert.equal(dialogueView(f.state, f.people).name, 'Edda');
  f.registry.executeAction('dialogue:leave', dialogueView(f.state, f.people).token);
  assert.equal(f.state.dialogue.met[a], true); assert.equal(f.state.dialogue.met[b], undefined);
  assert.deepEqual(f.reload(f.saved), f.state);
});

test('an authorized ship can move without moving or being occupied by the player', () => {
  const f = fixture(), ship = f.spawn(shipSpec()), npc = f.spawn(npcSpec({ locationId: ship }));
  f.runtime.applyAction(s => { navigate(s, 'undock', null, f.world, f.content, ship); navigate(s, 'travel', 'outerReach', f.world, f.content, ship); });
  assert.equal(f.state.locationId, 'habitat'); assert.ok(getEntityLocation(f.state, npc).journey);
  f.runtime.advance(1000);
  assert.equal(f.state.locations[ship].areaId, 'outerReach'); assert.equal(f.state.locationId, 'habitat');
  assert.equal(getEntityLocation(f.state, npc).areaId, 'outerReach');
});

test('registry validation rejects collisions, dangling slices, incorrect types, and missing live definitions', () => {
  const f = fixture();
  for (const mutate of [s => s.entities.mira.id = 'oren', s => s.entities.habitat.type = 'ship', s => delete s.locations.habitat,
    s => s.npcs.stray = structuredClone(s.npcs.mira), s => s.entities.habitat.definition.id = 'missing', s => s.entities.mira.ownerId = 'player',
    s => s.entities.player.lifecycle = 'inactive', s => s.entities.habitat.ownerId = 'habitat']) {
    const s = structuredClone(f.state); mutate(s); assert.throws(() => f.validate(s));
  }
  assert.throws(() => fixture({ principals: { mira: { name: 'Collision' } } }), /collision/);
  assert.throws(() => f.spawn(shipSpec({ id: 'habitat' })), /specification/);
});

test('creation rejects incompatible fields and overloaded initial cargo, while saved overload remains valid', () => {
  const f = fixture(), before = structuredClone(f.state);
  for (const spec of [shipSpec({ resources: { scrap: 3000000 } }), shipSpec({ inventory: {} }), npcSpec({ areaId: 'vicinity' }),
    { type: 'principal', displayName: 'Company', definitionId: 'freighter' }, { type: 'area', definitionId: 'vicinity' }]) {
    assert.throws(() => f.spawn(spec)); assert.deepEqual(f.state, before);
  }
  const ship = f.spawn(shipSpec());
  f.runtime.applyAction(s => { s.locations[ship].resources.scrap = 3000000; });
  assert.equal(f.reload(f.saved).locations[ship].resources.scrap, 3000000);
});

test('runtime target payloads are order-independent and remote scene status is safely unavailable', () => {
  const f = fixture(), ship = f.spawn(shipSpec());
  f.registry.executeAction('board', { targetId: ship });
  const remote = f.registry.getActionStatus('inspect:habitat:collectors');
  assert.equal(remote.available, false);
  f.registry.executeAction('inspectScene', { sceneId: 'bridge', targetId: ship });
  assert.equal(f.state.locations[ship].flags['examined:bridge'], true);
});
