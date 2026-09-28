import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, shipSpec, npcSpec } from './entityFixtures.mjs';
import { canUse, ownerOf, controllerOf, setEntityOwner, setEntityController, setEntityAccess } from '../js/authority.js';
import { retireEntity } from '../js/entityLifecycle.js';
import { locationTransferReason, transferBetweenLocations } from '../js/locations.js';
import { previewExperiment } from '../js/research/researchActions.js';

test('title, operational control, and administrative permissions remain separate', () => {
  const f = fixture(), ship = f.spawn(shipSpec()), captain = f.spawn(npcSpec());
  f.runtime.applyAction(s => setEntityController(s, ship, captain));
  assert.equal(ownerOf(f.state, ship), 'player'); assert.equal(controllerOf(f.state, ship), captain);
  assert.equal(canUse(f.state, captain, ship, 'pilot'), true);
  assert.equal(canUse(f.state, 'player', ship, 'withdrawCargo'), false);
  assert.equal(canUse(f.state, captain, ship, 'transferOwnership'), false);
  assert.equal(canUse(f.state, captain, ship, 'discardCargo'), false);
  assert.equal(canUse(f.state, 'player', ship, 'discardCargo'), true);
  assert.throws(() => f.runtime.applyAction(s => setEntityOwner(s, ship, captain, captain)), /permission/);
  f.runtime.applyAction(s => retireEntity(s, captain, f));
  assert.equal(controllerOf(f.state, ship), captain);
  assert.equal(canUse(f.state, captain, ship, 'pilot'), false);
  assert.equal(canUse(f.state, 'player', ship, 'pilot'), false);
  f.runtime.applyAction(s => setEntityController(s, ship, null));
  assert.equal(canUse(f.state, 'player', ship, 'pilot'), true);
});

test('explicit grants are operation-specific and ownership transfer revokes old delegation', () => {
  const f = fixture(), ship = f.spawn(shipSpec({ ownerId: 'corporation' }));
  f.runtime.applyAction(s => setEntityAccess(s, ship, { public: ['enter'], grants: { player: ['depositCargo'] } }, 'corporation'));
  assert.equal(canUse(f.state, 'player', ship, 'depositCargo'), true);
  assert.equal(canUse(f.state, 'player', ship, 'withdrawCargo'), false);
  const incoming = { sourceId: 'habitat', destinationId: ship, assetId: 'power', amount: 1 };
  assert.equal(locationTransferReason(f.state, incoming, f.world, f.content), '');
  assert.match(locationTransferReason(f.state, { ...incoming, sourceId: ship, destinationId: 'habitat' }, f.world, f.content), /withdrawCargo/);
  f.runtime.applyAction(s => setEntityOwner(s, ship, 'mira', 'corporation'));
  assert.equal(canUse(f.state, 'player', ship, 'depositCargo'), false);
  assert.equal(controllerOf(f.state, ship), 'mira');
});

test('passenger navigation permits propulsion power but no private inventory or equipment access', () => {
  const f = fixture(), ship = f.spawn(shipSpec({ ownerId: null }));
  f.registry.executeAction(`board:${ship}`);
  assert.equal(f.contextFor(f.state).permissions.viewCargo, false);
  f.registry.executeAction('undock'); f.registry.executeAction('travel:outerReach');
  assert.equal(f.state.locations[ship].resources.power, 25);
  assert.match(previewExperiment(f.state, f.research, { methodId: 'bench', items: ['scrap'] }).reason, /permission/);
  assert.throws(() => f.registry.executeAction('discardCargo', { locationId: ship, assetId: 'scrap', amount: 1, confirmed: true }), /permission/);
  assert.throws(() => f.registry.executeAction('research:experiment', { actorId: 'mira' }), /actor/);
});

test('permission changes between preview and execution are rechecked, including global actions', () => {
  const f = fixture(), ship = f.spawn(shipSpec());
  f.registry.executeAction(`board:${ship}`);
  const payload = { locationId: ship, assetId: 'scrap', amount: 1, confirmed: true };
  assert.equal(f.registry.getActionStatus('discardCargo', payload).available, true);
  f.runtime.applyAction(s => setEntityOwner(s, ship, 'corporation'));
  assert.throws(() => f.registry.executeAction('discardCargo', payload), /permission/);
  assert.equal(f.state.locations[ship].resources.scrap, 30000);
});

test('an NPC uses the same transfer rules with its own placement and authority', () => {
  const f = fixture(), npc = f.spawn(npcSpec()), ship = f.spawn(shipSpec({ ownerId: npc }));
  f.runtime.applyAction(s => setEntityAccess(s, 'habitat', { public: ['enter', 'dock'], grants: { [npc]: ['depositCargo'] } }));
  const request = { sourceId: ship, destinationId: 'habitat', assetId: 'scrap', amount: 1 };
  assert.equal(locationTransferReason(f.state, request, f.world, f.content, npc), '');
  f.runtime.applyAction(s => transferBetweenLocations(s, request, f.world, f.content, npc));
  assert.equal(f.state.locations[ship].resources.scrap, 29999); assert.equal(f.state.locations.habitat.resources.scrap, 1);
  assert.match(locationTransferReason(f.state, request, f.world, f.content), /withdrawCargo/);
});

test('loss of an owner preserves title and grants no automatic succession or claim', () => {
  const f = fixture(), npc = f.spawn(npcSpec()), ship = f.spawn(shipSpec({ ownerId: npc }));
  f.runtime.applyAction(s => retireEntity(s, npc, f));
  assert.equal(ownerOf(f.state, ship), npc);
  assert.equal(canUse(f.state, npc, ship, 'transferOwnership'), false);
  assert.equal(canUse(f.state, 'player', ship, 'transferOwnership'), false);
  assert.deepEqual(f.reload(f.saved), f.state);
});
