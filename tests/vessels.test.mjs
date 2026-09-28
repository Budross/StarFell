import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fixture } from './entityFixtures.mjs';
import { locationDefinitions } from '../js/locationContent.js';
import { definitions } from '../js/content.js';
import { buildCatalog } from '../js/itemCatalog.js';
import { buildGameSystems } from '../js/bootstrap.js';
import { researchDefinitions } from '../js/research/researchContent.js';
import { deriveVessel, moduleGeometry, reconcileVessels } from '../js/vessels.js';
import { createShipyardDraft, placeDraftModule, moveDraftModule, removeDraftModule, previewAssembly } from '../js/shipyard.js';
import { journeyQuote, navigationReason, cancelJourney } from '../js/ships.js';
import { setEntityAccess, setEntityController } from '../js/authority.js';
import { sampleQuantity } from '../js/quantities.js';
import { storageSummary } from '../js/storage.js';
import { committedNarrativeSummary } from '../js/narrativePresentation.js';

export const prospectorAssembly = () => ({ core: { key: 'core', moduleId: 'basicAutonomousCore', x: 0, y: 0 }, attachments: [
  ['cargo', 'smallCargoModule', -2, 0], ['tank', 'smallFuelTank', 2, 0], ['drive', 'basicReactionThruster', 3, 0],
  ['power', 'basicPowerModule', 1, 0], ['radio', 'basicRadioModule', 0, -1], ['extractor', 'basicExtractionModule', 0, 1]
].map(([key, moduleId, x, y]) => ({ key, moduleId, x, y })) });
const game = options => fixture({ locationSource: structuredClone(locationDefinitions), ...options });
function stocked(f, assembly = prospectorAssembly()) {
  f.runtime.applyAction(s => { const h = s.locations.habitat; h.resources.structuralFrame = 20;
    for (const p of [assembly.core, ...assembly.attachments]) h.resources[p.moduleId]++;
  });
  return { yardId: 'habitat', assembly };
}
function assembled(f, assembly = prospectorAssembly()) {
  f.registry.executeAction('assembleVessel', stocked(f, assembly));
  return Object.values(f.state.entities).find(e => e.type === 'ship').id;
}

test('module contracts, geometry, live envelope, connectivity, draft edits and count bill', () => {
  const f = game(), a = prospectorAssembly(), d = deriveVessel(a, f.content);
  assert.equal(d.dryMassKg, 318); assert.equal(d.volumeM3, 5.35);
  assert.deepEqual([d.geometry.width, d.geometry.length, d.geometry.depth], [6, 4, 0.5]);
  assert.equal(moduleGeometry('smallCargoModule', f.content).broadShallow, true);
  assert.equal(moduleGeometry('basicCrewedCore', f.content).shallow, false);
  assert.throws(() => deriveVessel({ core: a.core, attachments: [] }, f.content), /attachment/);
  assert.equal(deriveVessel({ core: a.core, attachments: [] }, f.content, { draft: true }).moduleCount, 1);
  const corner = { core: a.core, attachments: [{ key: 'radio', moduleId: 'basicRadioModule', x: 1, y: 1 }] };
  assert.throws(() => deriveVessel(corner, f.content), /disconnected/);
  corner.attachments[0].x = 0; corner.attachments[0].y = 0;
  assert.throws(() => deriveVessel(corner, f.content), /overlap/);
  let draft = placeDraftModule(createShipyardDraft('habitat'), 'basicAutonomousCore', 0, 0, f.content);
  draft = placeDraftModule(draft, 'basicRadioModule', 1, 0, f.content);
  const saved = structuredClone(f.state);
  assert.throws(() => moveDraftModule(draft, 'module1', 0, 0, f.content), /overlap/);
  assert.equal(removeDraftModule(draft, 'module1').attachments.length, 0);
  assert.deepEqual(f.state, saved);
  const request = stocked(f);
  assert.equal(previewAssembly(f.state, request, f).cost.structuralFrame, 7);
  const source = structuredClone(definitions); source.items.basicRadioModule.vesselModule.capabilities.equipment.capabilities = ['magic'];
  assert.throws(() => buildCatalog(source), /unsupported/);
  source.items.basicRadioModule.vesselModule.capabilities.equipment.capabilities = ['radio'];
  source.items.basicRadioModule.vesselModule.physicalVolumeM3 = 4;
  assert.throws(() => buildCatalog(source), /vessel module/);
});

test('unknown recovered hardware assembles atomically; malformed requests and failed saves lose nothing', () => {
  const f = game(), request = stocked(f), before = structuredClone(f.state);
  assert.equal(f.state.knowledge.discoveries.autonomousCoreDesign, undefined);
  f.failSave(true); assert.throws(() => f.registry.executeAction('assembleVessel', request), /Save failed/);
  assert.deepEqual(f.state, before); f.failSave(false);
  const id = assembledWithRequest(f, request);
  assert.equal(f.state.entities[id].controllerId, 'player'); assert.deepEqual(f.state.locations[id].fuel, { items: {} });
  assert.equal(f.state.locations[id].resources.power, 0); assert.equal(f.state.locations[id].resources.smallCargoModule, 0);
  assert.equal(f.state.locations.habitat.resources.structuralFrame, 13);
  assert.equal(f.state.worldLedger.entries.filter(e => e.type === 'VESSEL_ASSEMBLED').length, 1);
  assert.equal(f.state.worldLedger.entries.some(e => e.type === 'ENTITY_CREATED'), false);
  assert.equal(f.state.locationId, 'habitat'); assert.deepEqual(f.reload(f.state), f.state);
  assert.match(navigationReason(f.state, 'board', id, f.world, f.content), /cannot carry/);
  assert.throws(() => f.runtime.applyAction(s => { s.locationId = id; }), /cannot carry/);
  assert.throws(() => f.runtime.applyAction(s => { s.npcs.mira.locationId = id; }), /cannot carry/);
  assert.throws(() => f.registry.executeAction('assembleVessel', { ...request, actorId: 'mira' }), /actor/);
});
test('one committed assembly produces a typed local narrative from current geometry and historical evidence', () => {
  const f = game(), request = stocked(f), previous = structuredClone(f.state);
  const id = assembledWithRequest(f, request);
  const summary = committedNarrativeSummary({ previous, state: f.state });
  assert.equal(summary.transitions.length, 1);
  assert.equal(summary.transitions[0].type, 'VESSEL_ASSEMBLED');
  const context = f.narrative.buildContext(f.state, { surface: 'operations_update', subjectId: 'habitat', triggers: summary.transitions });
  const history = context.facts.find(fact => fact.kind === 'recent_vessel_assembly' && fact.subject.id === id);
  const geometry = context.facts.find(fact => fact.kind === 'vessel_geometry' && fact.subject.id === id);
  assert.ok(history && geometry);
  assert.equal(history.basis, 'history'); assert.equal(geometry.basis, 'current');
  const result = f.narrative.describe(f.state, { surface: 'operations_update', subjectId: 'habitat', triggers: summary.transitions });
  assert.match(result.text, /assembled/); assert.match(result.text, /current.*envelope/);
  assert.ok(!JSON.stringify(f.state).includes('current envelope spans'));
});
function assembledWithRequest(f, request) { f.registry.executeAction('assembleVessel', request); return Object.values(f.state.entities).find(e => e.type === 'ship').id; }

test('live power dissipation is validated and idempotent; cargo/fuel overload and legacy saves survive', () => {
  const f = game(), id = assembled(f); f.runtime.advance(20);
  f.runtime.applyAction(s => { s.locations.habitat.resources.reactionMassCartridge = 25; });
  f.registry.executeAction('loadVesselFuel', { vesselId: id, cargoId: 'habitat', fuelItemId: 'reactionMassCartridge', amount: 25 });
  f.runtime.applyAction(s => { s.locations[id].resources.scrap = 400000; });
  const source = structuredClone(definitions);
  source.items.basicPowerModule.vesselModule.capabilities.equipment.capacityBonus.power = 8;
  source.items.smallCargoModule.vesselModule.capabilities.cargoStorage.capacityM3 = 0.1;
  source.items.smallFuelTank.vesselModule.capabilities.fuelStorage.capacityM3 = 0.1;
  source.items.smallCargoModule.vesselModule.dryMassKg = 90;
  const changed = buildGameSystems({ content: buildCatalog(source) }), reloaded = changed.stateServices.migrateState(f.state);
  assert.equal(reloaded.locations[id].resources.power, 8); assert.equal(reloaded.locations[id].resources.scrap, 400000);
  assert.equal(reloaded.locations[id].fuel.items.reactionMassCartridge, 25);
  assert.equal(deriveVessel(reloaded.locations[id].assembly, changed.content).dryMassKg, 323);
  assert.deepEqual(reloaded.locations[id].assembly, f.state.locations[id].assembly);
  assert.deepEqual(changed.stateServices.migrateState(reloaded), reloaded);
  for (const value of [-1, NaN, Infinity, '10', Number.MAX_SAFE_INTEGER + 1, undefined]) {
    const malformed = structuredClone(f.state); malformed.locations[id].resources.power = value;
    assert.throws(() => changed.stateServices.migrateState(malformed), /power/);
    assert.ok(Object.is(malformed.locations[id].resources.power, value));
  }
  const old = JSON.parse(readFileSync(new URL('./fixtures/preShipyardV9.json', import.meta.url)));
  const migrated = f.reload(old);
  assert.equal(migrated.locations.habitat.resources.scrap, old.locations.habitat.resources.scrap);
  assert.equal(migrated.locations.habitat.infrastructure.solar.health, 0.2);
  assert.equal(migrated.locations.habitat.resources.titaniumOre, 0);
  assert.equal(Object.values(migrated.entities).some(e => e.type === 'ship'), false);
});

test('dedicated fuel admission, command link, authority and exact berth prevent remote item teleporting', () => {
  const f = game(), id = assembled(f); f.runtime.advance(20);
  f.runtime.applyAction(s => { s.locations.habitat.resources.reactionMassCartridge = 26; });
  const load = { vesselId: id, cargoId: 'habitat', fuelItemId: 'reactionMassCartridge', amount: 26 };
  const before = structuredClone(f.state);
  assert.throws(() => f.registry.executeAction('loadVesselFuel', load), /capacity/); assert.deepEqual(f.state, before);
  assert.throws(() => f.registry.executeAction('loadVesselFuel', { ...load, amount: 0.5 }), /integer/);
  f.registry.executeAction('loadVesselFuel', { ...load, amount: 25 });
  assert.equal(journeyQuote(f.state, 'metallicFragmentArea', f.world, f.content, id).fuelUnits, 6);
  f.registry.executeAction('commandVesselNavigation', { vesselId: id, operation: 'undock' });
  assert.throws(() => f.registry.executeAction('commandVesselNavigation', { vesselId: id, operation: 'travel', targetId: 'metallicFragmentArea' }), /radio/);
  f.runtime.applyAction(s => { s.locations.habitat.infrastructure.installedAntenna.quantity = 1; });
  f.registry.executeAction('commandVesselNavigation', { vesselId: id, operation: 'travel', targetId: 'metallicFragmentArea' });
  assert.equal(f.state.locations[id].fuel.items.reactionMassCartridge, 19);
  assert.deepEqual(Object.keys(f.state.locations[id].journey).sort(), ['duration', 'kind', 'originAreaId', 'remaining', 'targetId']);
  assert.throws(() => f.registry.executeAction('commandVesselTransfer', { vesselId: id, sourceId: 'habitat', destinationId: id, assetId: 'iron', amount: 1 }), /berth/);
  f.runtime.advance(6);
  f.registry.executeAction('commandVesselNavigation', { vesselId: id, operation: 'dock', targetId: 'metallicFragment' }); f.runtime.advance(2);
  f.runtime.applyAction(s => { setEntityController(s, id, 'corporation'); setEntityAccess(s, id, { public: [], grants: {} }); });
  assert.throws(() => f.registry.executeAction('commandVesselProcess', { hostId: id, equipmentId: 'vessel_basicExtractionModule', processId: 'prospectResource', sourceLocationId: 'metallicFragment', nodeId: 'titaniumDeposit' }), /permission|Requires/);
});

test('an extra basic tank reaches every authored deposit and off-site titanium enables a real advanced recipe', () => {
  const f = game({ researchSource: { ...structuredClone(researchDefinitions), bonusChance: 0 } });
  const assembly = prospectorAssembly(); assembly.attachments.push({ key: 'farTank', moduleId: 'smallFuelTank', x: 4, y: 0 });
  const id = assembled(f, assembly), act = (action, payload) => f.registry.executeAction(action, payload);
  f.runtime.applyAction(s => { s.locations.habitat.infrastructure.installedAntenna.quantity = 1;
    s.locations.habitat.resources.reactionMassCartridge = 200; });
  f.runtime.advance(20);
  act('loadVesselFuel', { vesselId: id, cargoId: 'habitat', fuelItemId: 'reactionMassCartridge', amount: 50 });
  assert.equal(deriveVessel(f.state.locations[id].assembly, f.content).dryMassKg, 353);
  const destinations = [
    ['metallicFragmentArea','metallicFragment',[['titaniumDeposit','titaniumOre',8],['rareEarthDeposit','rareEarthMinerals',3]]],
    ['carbonaceousBodyArea','carbonaceousBody',[['carbonDeposit','carbonaceousRock',4]]],
    ['denseMetallicBodyArea','denseMetallicBody',[['tungstenDeposit','tungstenOre',4]]],
    ['icyBodyArea','icyBody',[['iceDeposit','waterIce',3]]]
  ];
  for (const [area, site, nodes] of destinations) {
    const outward = journeyQuote(f.state, area, f.world, f.content, id);
    assert.ok(outward.fuelUnits * 2 + 4 <= 50, `${area} requires the extra tank`);
    act('commandVesselNavigation', { vesselId: id, operation: 'undock' });
    act('commandVesselNavigation', { vesselId: id, operation: 'travel', targetId: area }); f.runtime.advance(Math.ceil(outward.duration) + 1);
    act('commandVesselNavigation', { vesselId: id, operation: 'dock', targetId: site }); f.runtime.advance(3);
    for (const [nodeId, resourceId, batches] of nodes) {
      for (let i = 0; i < batches; i++) {
        act('commandVesselProcess', { hostId: id, equipmentId: 'vessel_basicExtractionModule', processId: 'prospectResource', sourceLocationId: site, nodeId });
        f.runtime.advance(21);
      }
      assert.equal(f.state.locations[id].resources[resourceId], batches * 10000);
    }
    act('commandVesselNavigation', { vesselId: id, operation: 'undock' });
    const back = journeyQuote(f.state, 'vicinity', f.world, f.content, id);
    act('commandVesselNavigation', { vesselId: id, operation: 'travel', targetId: 'vicinity' }); f.runtime.advance(Math.ceil(back.duration) + 1);
    act('commandVesselNavigation', { vesselId: id, operation: 'dock', targetId: 'habitat' }); f.runtime.advance(3);
    for (const [, resourceId, batches] of nodes) act('commandVesselTransfer', { vesselId: id, sourceId: id, destinationId: 'habitat', assetId: resourceId, amount: batches * 10000 });
    const remaining = f.state.locations[id].fuel.items.reactionMassCartridge;
    act('loadVesselFuel', { vesselId: id, cargoId: 'habitat', fuelItemId: 'reactionMassCartridge', amount: 50 - remaining });
  }
  for (const resourceId of ['titaniumOre','rareEarthMinerals','carbonaceousRock','tungstenOre','waterIce'])
    assert.ok(f.state.locations.habitat.resources[resourceId] > 0, resourceId);
  f.runtime.applyAction(s => { s.knowledge.discoveries.structuralFabrication = true; s.locations.habitat.resources.iron = 2; });
  act('research:experiment', { methodId: 'bench', items: ['titaniumOre'] });
  act('research:experiment', { methodId: 'bench', items: ['titaniumOre','iron'] });
  assert.equal(f.state.knowledge.discoveries.lightAlloyMetallurgy, true);
  f.runtime.applyAction(s => { s.locations.habitat.infrastructure.fabricator.quantity = 1; });
  act('selectRecipe:titaniumAlloyStock:fabricate'); act('craftSelected');
  assert.equal(f.state.locations.habitat.resources.titaniumAlloyStock, 2);
  assert.equal(f.state.locationId, 'habitat'); assert.deepEqual(f.reload(f.state), f.state);
});

test('a crewed core produces a boardable ordinary ship without changing autonomous occupancy rules', () => {
  const f = game(), assembly = { core: { key: 'core', moduleId: 'basicCrewedCore', x: 0, y: 0 }, attachments: [
    { key: 'cargo', moduleId: 'smallCargoModule', x: -2, y: 0 },
    { key: 'tank', moduleId: 'smallFuelTank', x: 2, y: 0 },
    { key: 'drive', moduleId: 'basicReactionThruster', x: 3, y: 0 },
    { key: 'power', moduleId: 'basicPowerModule', x: 0, y: 2 }
  ] };
  const id = assembled(f, assembly), def = f.world.definitions.modularVessel;
  assert.equal(def.boardable, undefined); // the current core, not the template, decides
  assert.equal(deriveVessel(f.state.locations[id].assembly, f.content).dryMassKg, 420);
  assert.equal(navigationReason(f.state, 'board', id, f.world, f.content), '');
  f.registry.executeAction(`board:${id}`); assert.equal(f.state.locationId, id);
  assert.equal(f.state.entities[id].type, 'ship');
  f.registry.executeAction('disembark:habitat'); assert.equal(f.state.locationId, 'habitat');
  assert.deepEqual(f.reload(f.state), f.state);
});

test('content-only cargo and same-fuel drive extensions research, fabricate, assemble, navigate and reload', () => {
  const source = structuredClone(definitions), addonRecipe = name => [{ id: 'fabricate', name: `Fabricate ${name}`, amount: 1,
    conditions: { discoveries: ['addonDesign'] }, inputs: [{ id: 'frame', item: 'structuralFrame', quantity: 1 }] }];
  source.items.testAddonCargo = { name: 'Test Cargo Block', category: 'product', unitVolumeM3: 0.6, tags: ['vesselModule'], recipes: addonRecipe('cargo block'),
    vesselModule: { role: 'attachment', category: 'Logistics', footprint: { width: 1, height: 2 }, dryMassKg: 30,
      designDiscoveryId: 'addonDesign', capabilities: { cargoStorage: { capacityM3: 0.25 } } } };
  source.items.testAddonDrive = { name: 'Test Auxiliary Drive', category: 'product', unitVolumeM3: 0.5, tags: ['vesselModule'], recipes: addonRecipe('auxiliary drive'),
    vesselModule: { role: 'attachment', category: 'Propulsion', footprint: { width: 1, height: 2 }, dryMassKg: 40,
      designDiscoveryId: 'addonDesign', capabilities: { propulsion: { travelSpeed: 12, distancePerFuelUnit: 12, fuelItemId: 'reactionMassCartridge' } } } };
  const researchSource = structuredClone(researchDefinitions); researchSource.bonusChance = 0;
  researchSource.discoveries.addonDesign = { name: 'Auxiliary vessel design', description: 'Test extension design.', families: ['mechanics'], threshold: 10,
    evidence: [{ id: 'ironTest', samples: { items: ['iron'], minSamples: 1, maxSamples: 1 }, insight: 10, once: true,
      observation: 'A small frame test establishes an auxiliary module pattern.' }] };
  const f = game({ content: buildCatalog(source), researchSource, processSource: [] }), act = (id, payload) => f.registry.executeAction(id, payload);
  f.runtime.applyAction(s => { const h = s.locations.habitat; h.resources.iron = 2; h.resources.structuralFrame = 12;
    h.resources.reactionMassCartridge = 25; h.infrastructure.fabricator.quantity = 1; h.infrastructure.installedAntenna.quantity = 1;
    for (const id of ['basicAutonomousCore','smallFuelTank','basicPowerModule','basicRadioModule']) h.resources[id] = 1; });
  act('research:experiment', { methodId: 'bench', items: ['iron'] });
  assert.equal(f.state.knowledge.discoveries.addonDesign, true);
  for (const itemId of ['testAddonCargo','testAddonDrive']) { act(`selectRecipe:${itemId}:fabricate`); act('craftSelected');
    assert.equal(f.state.locations.habitat.resources[itemId], 1); }
  const assembly = { core: { key: 'core', moduleId: 'basicAutonomousCore', x: 0, y: 0 }, attachments: [
    { key: 'cargo', moduleId: 'testAddonCargo', x: -1, y: 0 }, { key: 'drive', moduleId: 'testAddonDrive', x: 1, y: 0 },
    { key: 'tank', moduleId: 'smallFuelTank', x: 2, y: 0 }, { key: 'power', moduleId: 'basicPowerModule', x: 0, y: -1 },
    { key: 'radio', moduleId: 'basicRadioModule', x: 0, y: 1 } ] };
  act('assembleVessel', { yardId: 'habitat', name: 'Addon courier', assembly });
  const id = Object.values(f.state.entities).find(e => e.type === 'ship').id;
  assert.equal(deriveVessel(f.state.locations[id].assembly, f.content).cargoVolumeUnits, 250000);
  f.runtime.advance(20); act('loadVesselFuel', { vesselId: id, cargoId: 'habitat', fuelItemId: 'reactionMassCartridge', amount: 25 });
  act('commandVesselNavigation', { vesselId: id, operation: 'undock' });
  const quote = journeyQuote(f.state, 'metallicFragmentArea', f.world, f.content, id);
  assert.ok(quote.fuelUnits > 0 && quote.fuelUnits < 25);
  act('commandVesselNavigation', { vesselId: id, operation: 'travel', targetId: 'metallicFragmentArea' });
  f.runtime.advance(Math.ceil(quote.duration) + 1);
  assert.equal(f.state.locations[id].areaId, 'metallicFragmentArea');
  assert.deepEqual(f.reload(f.state), f.state);
});

test('hard fresh-game production route researches, fabricates, assembles, fuels, mines, returns and uses new ore without luck or salvage', t => {
  const researchSource = structuredClone(researchDefinitions); researchSource.bonusChance = 0;
  const f = game({ researchSource }); let peak = 0;
  const act = (id, payload) => { const result = f.registry.executeAction(id, payload); peak = Math.max(peak, storageSummary(f.contextFor(f.state).store, f.content).usedVolumeUnits); return result; };
  function ensure(id, target) {
    const item = f.content.items[id];
    if (item.category === 'resource') {
      assert.ok(item.acquisition.length, `No Habitat acquisition for ${id}`);
      while (f.state.locations.habitat.resources[id] < target) act(item.acquisition[0].id);
    } else while (f.state.locations.habitat.resources[id] < target) {
      const recipe = f.content.recipes[`${id}:${item.recipes[0].id}`];
      const needs = {};
      for (const slot of recipe.inputs) { const itemId = slot.item ?? slot.defaultItem; needs[itemId] = (needs[itemId] ?? 0) + slot.quantity; }
      prepare(needs);
      act(`selectRecipe:${recipe.id}`); act('craftSelected');
    }
  }
  function prepare(needs) { while (Object.entries(needs).some(([id, n]) => f.state.locations.habitat.resources[id] < n)) for (const [id, n] of Object.entries(needs)) ensure(id, n); }
  function experiment(items) { prepare(Object.fromEntries(items.map(id => [id, sampleQuantity(id, f.content)]))); act('research:experiment', { methodId: 'bench', items }); }
  function learn(id, routes) { for (const samples of routes) { if (f.state.knowledge.discoveries[id]) break; experiment(samples); } assert.equal(f.state.knowledge.discoveries[id], true, id); }
  act('inspect:habitat:fitting'); experiment(['scrap']);
  experiment(['scrap', 'electronicSalvage']); experiment(['electronicSalvage', 'conductiveParts']);
  act('inspect:habitat:solarHardware'); experiment(['siliconMinerals', 'electronicSalvage']); experiment(['siliconMinerals', 'electronicParts']);
  ensure('iron', 2); act('repairSolar');
  learn('radioAssembly', [['electronicParts'], ['electronicParts', 'conductiveParts']]);
  learn('modularStructures', [['iron'], ['iron', 'conductiveParts']]);
  learn('autonomousCoreDesign', [['electronicParts'], ['electronicParts', 'conductiveParts']]);
  learn('reactionPropulsion', [['iron', 'conductiveParts'], ['electronicParts', 'conductiveParts']]);
  experiment(['siliconMinerals']); experiment(['siliconMinerals', 'iron']); experiment(['siliconMinerals', 'conductiveParts']);
  for (const id of ['modularStructures', 'autonomousCoreDesign', 'reactionPropulsion', 'propellantHandling', 'modularExtraction', 'radioAssembly']) assert.equal(f.state.knowledge.discoveries[id], true, id);
  const a = prospectorAssembly(); for (const p of [a.core, ...a.attachments]) ensure(p.moduleId, 1);
  ensure('radioAntenna', 1); act('install:radioAntenna'); ensure('structuralFrame', 7); ensure('reactionMassCartridge', 25);
  for (const id of ['titaniumOre', 'carbonaceousRock', 'rareEarthMinerals', 'tungstenOre', 'waterIce']) assert.equal(f.state.locations.habitat.resources[id], 0);
  assert.equal(f.state.locations.habitat.flags['examined:reactionWreckage'], undefined);
  f.runtime.advance(20); act('assembleVessel', { yardId: 'habitat', name: 'First prospector', assembly: a });
  const vesselId = Object.values(f.state.entities).find(e => e.type === 'ship').id;
  act('loadVesselFuel', { vesselId, cargoId: 'habitat', fuelItemId: 'reactionMassCartridge', amount: 25 }); f.runtime.advance(20);
  act('commandVesselNavigation', { vesselId, operation: 'undock' });
  act('commandVesselNavigation', { vesselId, operation: 'travel', targetId: 'metallicFragmentArea' }); f.runtime.advance(6);
  act('commandVesselNavigation', { vesselId, operation: 'dock', targetId: 'metallicFragment' }); f.runtime.advance(2);
  act('commandVesselProcess', { hostId: vesselId, equipmentId: 'vessel_basicExtractionModule', processId: 'prospectResource', sourceLocationId: 'metallicFragment', nodeId: 'titaniumDeposit' }); f.runtime.advance(20);
  assert.equal(f.state.locations[vesselId].resources.titaniumOre, 10000);
  assert.equal(f.state.locations.metallicFragment.resourceNodes.titaniumDeposit.remaining, 990000);
  act('commandVesselNavigation', { vesselId, operation: 'undock' });
  act('commandVesselNavigation', { vesselId, operation: 'travel', targetId: 'vicinity' }); f.runtime.advance(6);
  act('commandVesselNavigation', { vesselId, operation: 'dock', targetId: 'habitat' }); f.runtime.advance(2);
  act('commandVesselTransfer', { vesselId, sourceId: vesselId, destinationId: 'habitat', assetId: 'titaniumOre', amount: 10000 });
  act('research:experiment', { methodId: 'bench', items: ['titaniumOre'] });
  assert.equal(f.state.locations.habitat.resources.titaniumOre, 0);
  assert.equal(f.state.locations[vesselId].fuel.items.reactionMassCartridge, 9);
  assert.equal(f.state.locationId, 'habitat'); assert.ok(peak <= 10000000);
  assert.equal(f.state.knowledge.discoveries.crewedCoreDesign, undefined);
  assert.deepEqual(f.reload(f.state), f.state); t.diagnostic(`Fresh production loop peak Habitat cargo: ${peak / 1000000} m³.`);
});
