import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture, shipSpec } from './entityFixtures.mjs';
import { buildGameSystems } from '../js/bootstrap.js';
import { buildCatalog } from '../js/itemCatalog.js';
import { definitions } from '../js/content.js';
import { locationDefinitions } from '../js/locationContent.js';
import { processingDefinitions } from '../js/processingContent.js';
import { compileProcessingCatalog } from '../js/processingCatalog.js';
import { startProcess, previewStartProcess, abortProcess, previewAbortProcess, claimedReserve } from '../js/processing.js';
import { advanceIndustrialInterval } from '../js/processingSimulation.js';
import { processingWorkshopView } from '../js/processingView.js';
import { storageSummary } from '../js/storage.js';
import { setEntityAccess, setEntityController } from '../js/authority.js';
const fill = (f,hostId) => f.runtime.applyAction(s => {
  s.locations[hostId].resources.scrap = 0;
  const storage = storageSummary(f.contextFor(s,hostId).store,f.content);
  s.locations[hostId].resources.scrap = storage.capacityVolumeUnits-storage.usedVolumeUnits;
});

const refining = (hostId = 'habitat') => ({ hostId,equipmentId: 'thermalProcessors',processId: 'processSolarCells' });
const extracting = (hostId = 'habitat') => ({ hostId,equipmentId: 'mineralExtractors',processId: 'surfaceMineralExtraction',sourceLocationId: 'habitat',nodeId: 'surfaceMinerals' });
function ready(f, hostId = 'habitat') {
  f.runtime.applyAction(s => {
    s.knowledge.discoveries.photovoltaicFabrication = true;
    const h = s.locations[hostId]; h.resources.power = 20; h.resources.siliconMinerals = 200000; h.resources.electronicParts = 8;
    h.infrastructure.solar.quantity = h.infrastructure.habitat.quantity = 0;
    h.infrastructure.thermalProcessors.quantity = 3; h.infrastructure.mineralExtractors.quantity = 2;
  });
}
test('manual no-power rejection is pure and precedes IDs, loaded inputs and start facts; zero-rate starts', () => {
  const f = fixture(); ready(f);
  f.runtime.applyAction(s => { s.locations.habitat.resources.power = 0; s.locations.habitat.infrastructure.solar.quantity = 1; });
  const before = structuredClone(f.state), request = refining();
  assert.match(previewStartProcess(f.state,request,f.processing).reason,/insufficient power/);
  assert.throws(() => f.registry.executeAction('startProcess',request),/insufficient power/);
  assert.deepEqual(f.state,before);
  const source = structuredClone(processingDefinitions); source[1].powerRate = 0;
  const zero = fixture({ processSource: source }); ready(zero); zero.runtime.applyAction(s => { s.locations.habitat.resources.power = 0; });
  zero.registry.executeAction('startProcess',refining()); zero.runtime.advance(30);
  assert.equal(zero.state.locations.habitat.resources.solarCells,2);
});
test('loading, partial power failure, quiet blocked work and restoration preserve committed inputs', () => {
  const f = fixture(); ready(f); f.runtime.applyAction(s => { s.locations.habitat.resources.power = 0.15; });
  f.registry.executeAction('startProcess',refining());
  assert.equal(f.state.locations.habitat.resources.siliconMinerals,160000);
  f.runtime.advance(5);
  let run = f.state.processing.runs[1]; assert.equal(run.workRemaining,29); assert.equal(run.blockedReason,'NO_POWER');
  const facts = f.state.worldLedger.entries.length; f.runtime.advance(1); assert.equal(f.state.worldLedger.entries.length,facts);
  f.runtime.applyAction(s => { s.locations.habitat.resources.power = 8; }); f.runtime.advance(29);
  assert.deepEqual(f.state.processing.runs,{}); assert.equal(f.state.locations.habitat.resources.solarCells,2);
  assert.deepEqual(f.state.worldLedger.entries.filter(e => e.type.startsWith('PROCESS')).map(e => e.type),['PROCESS_STARTED','PROCESS_BLOCKED','PROCESS_RESUMED','PROCESS_COMPLETED']);
});
test('completed extraction debits once, releases claim, buffers in full cargo, travels and abort loses buffer', () => {
  const f = fixture(), ship = f.spawn(shipSpec()); ready(f,ship);
  f.registry.executeAction(`board:${ship}`); f.registry.executeAction('startProcess',extracting(ship));
  assert.equal(claimedReserve(f.state,'habitat','surfaceMinerals'),10000);
  fill(f,ship); f.runtime.advance(20);
  const run = f.state.processing.runs[1]; assert.equal(run.phase,'delivery'); assert.equal(run.sourceClaim,0); assert.equal(run.blockedReason,'OUTPUT_FULL');
  assert.equal(claimedReserve(f.state,'habitat','surfaceMinerals'),0); assert.equal(f.state.locations.habitat.resourceNodes.surfaceMinerals.remaining,490000);
  assert.deepEqual(f.reload(f.state),f.state);
  f.registry.executeAction('undock'); f.runtime.advance(1);
  assert.equal(f.state.processing.runs[1].phase,'delivery');
  f.registry.executeAction('abortProcess',{ runId: 1,phase: 'delivery',confirmed: true });
  assert.deepEqual(f.state.processing.runs,{}); assert.equal(f.state.locations.habitat.resourceNodes.surfaceMinerals.remaining,490000);
  const fact = f.state.worldLedger.entries.find(e => e.type === 'PROCESS_ABORTED'); assert.equal(fact.data.lostOutputs[0].amount,10000); assert.deepEqual(fact.data.lostInputs,[]);
});
test('broken machine can unload atomic finished output; delivery consumes no power and no resumption', () => {
  const f = fixture(); ready(f); f.registry.executeAction('startProcess',refining()); fill(f,'habitat'); f.runtime.advance(30);
  assert.equal(f.state.processing.runs[1].phase,'delivery'); assert.equal(f.state.locations.habitat.resources.solarCells,0);
  const beforePower = f.state.locations.habitat.resources.power;
  f.runtime.applyAction(s => { s.locations.habitat.infrastructure.thermalProcessors.enabled = false; s.locations.habitat.infrastructure.thermalProcessors.quantity = 0; s.locations.habitat.resources.scrap -= 100000; });
  f.runtime.advance(1);
  assert.equal(f.state.locations.habitat.resources.solarCells,2); assert.equal(f.state.locations.habitat.resources.power,beforePower);
  assert.deepEqual(f.state.processing.runs,{}); assert.equal(f.state.worldLedger.entries.some(e => e.type === 'PROCESS_RESUMED'),false);
});
test('own-run access, other-user denial, manager-only access and revocation share preview and mutation rules', () => {
  const f = fixture(); ready(f);
  f.runtime.applyAction(s => {
    setEntityController(s,'habitat','corporation');
    setEntityAccess(s,'habitat',{ public: ['enter','dock'],grants: { player: ['useFacilities','depositCargo','withdrawCargo'],mira: ['useFacilities'],oren: ['manageEquipment'] } });
  });
  f.registry.executeAction('startProcess',refining());
  assert.equal(previewAbortProcess(f.state,1,f.processing,'player').ok,true);
  assert.equal(previewAbortProcess(f.state,1,f.processing,'mira').ok,false);
  assert.equal(previewAbortProcess(f.state,1,f.processing,'oren').ok,true);
  assert.throws(() => f.runtime.applyAction(s => abortProcess(s,1,f.processing,'mira')),/Requires current facility/);
  f.runtime.applyAction(s => { s.entities.habitat.access.grants.player = ['depositCargo','withdrawCargo']; });
  assert.equal(previewAbortProcess(f.state,1,f.processing,'player').ok,false);
  f.runtime.applyAction(s => abortProcess(s,1,f.processing,'oren'));
  assert.equal(f.state.locations.habitat.resources.siliconMinerals,160000);
});
test('claims prevent concurrent overcommit, aborted work releases reserve, IDs never reuse', () => {
  const f = fixture(); ready(f); f.runtime.applyAction(s => { s.locations.habitat.resourceNodes.surfaceMinerals.remaining = 15000; });
  f.registry.executeAction('startProcess',extracting());
  assert.match(previewStartProcess(f.state,extracting(),f.processing).reason,/claimed/);
  f.registry.executeAction('abortProcess',{ runId: 1,phase: 'working',confirmed: true });
  assert.equal(f.state.locations.habitat.resourceNodes.surfaceMinerals.remaining,15000);
  f.registry.executeAction('startProcess',extracting()); assert.equal(f.state.processing.runs[2].id,2);
});
test('machine group count allocates oldest slots; delivery holds capacity until admitted', () => {
  const f = fixture(); ready(f);
  for (let i=0;i<3;i++) f.registry.executeAction('startProcess',refining());
  assert.match(previewStartProcess(f.state,refining(),f.processing).reason,/occupied/);
  f.runtime.applyAction(s => { s.locations.habitat.infrastructure.thermalProcessors.quantity = 1; });
  f.runtime.advance(1);
  assert.equal(f.state.processing.runs[1].workRemaining,29);
  for (const id of [2,3]) { assert.equal(f.state.processing.runs[id].workRemaining,30); assert.equal(f.state.processing.runs[id].blockedReason,'EQUIPMENT_UNAVAILABLE'); }
});
test('removed/rebalanced process definitions do not reinterpret snapshots or historical facts', () => {
  const f = fixture(); ready(f); f.registry.executeAction('startProcess',refining()); f.runtime.advance(10);
  const next = buildGameSystems({ processSource: [] }), saved = next.stateServices.migrateState(f.state);
  advanceIndustrialInterval(saved,20,next.processing); next.validate(saved);
  assert.equal(saved.locations.habitat.resources.solarCells,2); assert.deepEqual(saved.processing.runs,{});
});
test('v8 migration preserves generated identity, counters, delegation and assets; v9 malformed state fails', () => {
  const f = fixture(), ship = f.spawn(shipSpec()); ready(f,ship);
  const v8 = structuredClone(f.state); v8.saveVersion = 8; delete v8.processing;
  for (const local of Object.values(v8.locations)) delete local.resourceNodes;
  const before = structuredClone(v8), loaded = f.reload(v8);
  assert.deepEqual(v8,before); assert.equal(loaded.saveVersion,9);
  assert.deepEqual(loaded.entities,v8.entities); assert.deepEqual(loaded.entityIds,v8.entityIds);
  assert.deepEqual(loaded.locations[ship].resources,v8.locations[ship].resources); assert.deepEqual(loaded.worldLedger,v8.worldLedger);
  assert.deepEqual(loaded.processing,{ nextRunId: 1,runs: {} });
  loaded.locations.habitat.resourceNodes.surfaceMinerals.remaining = 0;
  assert.equal(f.reload(loaded).locations.habitat.resourceNodes.surfaceMinerals.remaining,0);
  for (const bad of [s => delete s.processing,s => s.processing.runs = null,s => s.processing.nextRunId = 0]) {
    const copy = structuredClone(loaded); bad(copy); assert.throws(() => f.reload(copy),/processing/);
  }
});
test('start and extraction buffer transitions roll back IDs, inputs, debit and ledger on save failure', () => {
  const f = fixture(); ready(f); const before = structuredClone(f.state); f.failSave(true);
  assert.throws(() => f.registry.executeAction('startProcess',refining()),/Save failed/); assert.deepEqual(f.state,before);
  f.failSave(false); f.registry.executeAction('startProcess',extracting()); fill(f,'habitat');
  const committed = structuredClone(f.state); f.failSave(true);
  assert.throws(() => f.runtime.advance(20),/Save failed/); assert.deepEqual(f.state,committed);
});
test('abort review binds phase; full-storage warning never rejects an otherwise operable start', () => {
  const f = fixture(); ready(f); fill(f,'habitat');
  assert.equal(previewStartProcess(f.state,extracting(),f.processing).ok,true);
  assert.match(previewStartProcess(f.state,extracting(),f.processing).warning,/machine/);
  f.registry.executeAction('startProcess',extracting()); f.runtime.advance(20);
  assert.throws(() => f.registry.executeAction('abortProcess',{ runId: 1,phase: 'working',confirmed: true }),/Batch changed/);
  assert.ok(f.state.processing.runs[1]);
});
test('workshop is occupied-host only, reveals installed groups through facility access, respects unlocks', () => {
  const f = fixture(), ship = f.spawn(shipSpec()); ready(f); ready(f,ship);
  const view = processingWorkshopView(f.state,f.processing);
  assert.equal(view.hostId,'habitat'); assert.equal(view.groups.length,2);
  assert.ok(view.groups.every(g => g.choices.every(c => c.request.hostId === 'habitat')));
  f.runtime.applyAction(s => { delete s.knowledge.discoveries.photovoltaicFabrication; });
  assert.equal(processingWorkshopView(f.state,f.processing).groups.find(g => g.equipmentId === 'thermalProcessors').choices.length,0);
  f.runtime.applyAction(s => { setEntityController(s,'habitat','corporation'); });
  assert.equal(processingWorkshopView(f.state,f.processing).groups.length,0);
});
test('all resource/component transformations compile and run; products, utilities and conditions alias reject', () => {
  const systems = buildGameSystems();
  for (const inputs of [ [{ itemId: 'siliconMinerals',amount: 0.001 }], [{ itemId: 'siliconMinerals',amount: 0.001 },{ itemId: 'scrap',amount: 0.001 }],
    [{ itemId: 'siliconMinerals',amount: 0.001 },{ itemId: 'electronicParts',amount: 1 }], [{ itemId: 'electronicParts',amount: 1 },{ itemId: 'iron',amount: 1 }], [{ itemId: 'electronicParts',amount: 1 }] ]) {
    const p = { ...processingDefinitions[1],inputs,outputs: [{ itemId: 'conductiveParts',amount: 1 }],duration: 1,startConditions: {} };
    const f = fixture({ processSource: [p] }); ready(f); f.runtime.applyAction(s => { s.locations.habitat.resources.scrap = 1000; s.locations.habitat.resources.iron = 1; });
    f.registry.executeAction('startProcess',refining()); f.runtime.advance(1); assert.equal(f.state.locations.habitat.resources.conductiveParts,1);
  }
  for (const itemId of ['solarPanel','power']) assert.throws(() => compileProcessingCatalog([{ ...processingDefinitions[1],outputs: [{ itemId,amount: 1 }] }],systems.content,systems.world),/line item/);
  assert.throws(() => compileProcessingCatalog([{ ...processingDefinitions[1],conditions: {} }],systems.content,systems.world),/startConditions/);
});
test('terminal host orchestration aborts committed material atomically; inactive hosts can resume', () => {
  const f = fixture(); ready(f,'supplyPlatform');
  f.runtime.applyAction(s => startProcess(s,refining('supplyPlatform'),f.processing));
  f.runtime.applyAction(s => f.worldOperations.deactivateEntity(s,'supplyPlatform'));
  f.runtime.advance(1); assert.equal(f.state.processing.runs[1].blockedReason,'HOST_INACTIVE');
  f.runtime.applyAction(s => f.worldOperations.activateEntity(s,'supplyPlatform')); f.runtime.advance(1);
  assert.equal(f.state.processing.runs[1].workRemaining,29);
  f.runtime.applyAction(s => f.worldOperations.destroyEntity(s,'supplyPlatform'));
  assert.deepEqual(f.state.processing.runs,{}); assert.equal(f.state.worldLedger.entries.at(-2).type,'PROCESS_ABORTED');
});
test('arrival gives no retroactive extraction; paid journey completes after processing empties the battery', () => {
  const f = fixture(), ship = f.spawn(shipSpec()); ready(f,ship); f.registry.executeAction(`board:${ship}`);
  f.registry.executeAction('startProcess',extracting(ship)); f.registry.executeAction('startProcess',refining(ship));
  f.registry.executeAction('undock'); f.registry.executeAction('dock:habitat');
  const duration = f.state.locations[ship].journey.remaining;
  f.runtime.applyAction(s => { s.locations[ship].resources.power = .01; });
  const elapsed = f.runtime.advance(duration);
  assert.equal(elapsed.arrivals.length,1); assert.equal(f.state.locations[ship].journey,null);
  assert.equal(f.state.processing.runs[1].workRemaining,20); assert.ok(f.state.processing.runs[2].workRemaining < 30);
  assert.equal(f.state.locations[ship].resources.power,0);
  f.runtime.applyAction(s => { s.locations[ship].resources.power = 5; }); f.runtime.advance(1);
  assert.equal(f.state.processing.runs[1].workRemaining,19);
});
test('depletion precedes output delivery, staged reload does not debit again, malformed claims/phases fail', () => {
  const f = fixture(); ready(f); f.runtime.applyAction(s => { s.locations.habitat.resourceNodes.surfaceMinerals.remaining = 10000; });
  f.registry.executeAction('startProcess',extracting()); fill(f,'habitat'); f.runtime.advance(20);
  const facts = f.state.worldLedger.entries.filter(e => e.type.includes('PROCESS') || e.type === 'RESOURCE_NODE_DEPLETED');
  assert.deepEqual(facts.map(e => e.type),['PROCESS_STARTED','RESOURCE_NODE_DEPLETED','PROCESS_BLOCKED']);
  assert.equal(facts[1].targetId,'habitat');
  for (const change of [r => r.sourceClaim = 10000,r => r.workRemaining = 1,r => r.blockedReason = 'EQUIPMENT_UNAVAILABLE']) {
    const invalid = structuredClone(f.state); change(invalid.processing.runs[1]); assert.throws(() => f.reload(invalid),/processing/);
  }
  const next = f.reload(f.state); next.locations.habitat.resources.scrap = 0; advanceIndustrialInterval(next,1,f.processing); f.validate(next);
  assert.equal(next.locations.habitat.resourceNodes.surfaceMinerals.remaining,0);
  assert.equal(next.locations.habitat.resources.siliconMinerals,210000);
  assert.equal(next.worldLedger.entries.filter(e => e.type === 'RESOURCE_NODE_DEPLETED').length,1);
});
test('generic extraction works with another material, node, generated source and machine capability group', () => {
  const source = structuredClone(definitions); source.infrastructure.alternateMiner = { name: 'Alternate miner',capabilities: ['surfaceExtraction'] };
  const locations = structuredClone(locationDefinitions);
  locations.templates = { mine: { type: 'platform',name: 'Generated mine',description: 'Mine',remoteDescription: 'Mine',
    resourceNodes: [{ id: 'metal',resourceId: 'scrap',initialReserveM3: .03,tags: ['solid','surface'] }],
    initialInfrastructure: { alternateMiner: { quantity: 1 } },initialResources: { power: 10 } } };
  const f = fixture({ content: buildCatalog(source),locationSource: locations,processSource: [processingDefinitions[0]] });
  const id = f.spawn({ type: 'site',definitionId: 'mine',areaId: 'vicinity',ownerId: 'player' });
  f.runtime.applyAction(s => startProcess(s,{ hostId: id,equipmentId: 'alternateMiner',processId: 'surfaceMineralExtraction',sourceLocationId: id,nodeId: 'metal' },f.processing));
  f.runtime.advance(20); assert.equal(f.state.locations[id].resources.scrap,10000); assert.equal(f.state.locations[id].resourceNodes.metal.remaining,20000);
});
test('industrial machines can be assembled and installed through ordinary existing actions', () => {
  const f = fixture();
  f.runtime.applyAction(s => {
    for (const id of ['structuralFabrication','electricalConduction','photovoltaicFabrication']) s.knowledge.discoveries[id] = true;
    Object.assign(s.locations.habitat.resources,{ iron: 4,conductiveParts: 2,electronicParts: 2,power: 10 });
  });
  for (const [product,group] of [['mineralExtractor','mineralExtractors'],['thermalProcessor','thermalProcessors']]) {
    const recipe = Object.values(f.content.recipes).find(r => r.output === product);
    f.registry.executeAction(`selectRecipe:${recipe.id}`); f.registry.executeAction('craftSelected');
    f.registry.executeAction(`install:${product}`);
    assert.equal(f.state.locations.habitat.infrastructure[group].quantity,1);
  }
  f.registry.executeAction('startProcess',extracting()); f.runtime.advance(20);
  assert.equal(f.state.locations.habitat.resources.siliconMinerals,10000);
});
test('machine multipliers are snapshotted and bulk refining outputs remain exact', () => {
  const source = structuredClone(definitions);
  source.items.thermalProcessor.installation.processing = { speedMultiplier: 2,powerMultiplier: .5 };
  const process = { ...processingDefinitions[1],inputs: [{ itemId: 'electronicParts',amount: 1 }],outputs: [{ itemId: 'scrap',amount: .001 }] };
  const f = fixture({ content: buildCatalog(source),processSource: [process] }); ready(f);
  f.registry.executeAction('startProcess',refining());
  assert.equal(f.state.processing.runs[1].workTotal,15); assert.equal(f.state.processing.runs[1].powerRate,.075);
  f.runtime.advance(5);
  const changed = structuredClone(source); changed.items.thermalProcessor.installation.processing.speedMultiplier = 10;
  const next = buildGameSystems({ content: buildCatalog(changed),processSource: [{ ...process,duration: 100,outputs: [{ itemId: 'scrap',amount: .000001 }] }] });
  const saved = next.stateServices.migrateState(f.state); advanceIndustrialInterval(saved,10,next.processing); next.validate(saved);
  assert.equal(saved.locations.habitat.resources.scrap,1000);
});
test('finished extraction survives a terminal source and removal of its live node definition', () => {
  const f = fixture(), ship = f.spawn(shipSpec()); ready(f,ship); f.registry.executeAction(`board:${ship}`);
  f.registry.executeAction('startProcess',extracting(ship)); fill(f,ship); f.runtime.advance(20); f.registry.executeAction('undock');
  f.runtime.applyAction(s => {
    for (const [id,npc] of Object.entries(s.npcs)) if (npc.locationId === 'habitat') f.worldOperations.relocateNpc(s,id,'supplyPlatform');
    f.worldOperations.destroyEntity(s,'habitat');
  });
  // Simulate an authored node removed only from an already-terminal source.
  f.world.definitions.habitat.resourceNodes = {};
  const saved = f.reload(f.state); assert.equal(saved.processing.runs[1].phase,'delivery');
  saved.locations[ship].resources.scrap = 0; advanceIndustrialInterval(saved,1,f.processing); f.validate(saved);
  assert.equal(saved.locations[ship].resources.siliconMinerals,210000); assert.deepEqual(saved.processing.runs,{});
});
test('whole-output quantity overflow remains buffered without pausing or clipping the simulation', () => {
  const source = structuredClone(definitions); source.items.solarCells.unitVolumeM3 = .000001;
  const process = { ...processingDefinitions[1],startConditions: {},duration: 1,powerRate: 0,
    inputs: [{ itemId: 'solarCells',amount: 1 }],outputs: [{ itemId: 'solarCells',amount: 2 }] };
  const f = fixture({ content: buildCatalog(source),processSource: [process] }); ready(f);
  f.runtime.applyAction(s => { for (const id of Object.keys(f.content.items)) s.locations.habitat.resources[id] = 0; s.locations.habitat.resources.solarCells = Number.MAX_SAFE_INTEGER; });
  f.registry.executeAction('startProcess',refining()); f.runtime.advance(1);
  assert.equal(f.state.processing.runs[1].phase,'delivery'); assert.equal(f.state.processing.runs[1].blockedReason,'OUTPUT_FULL');
  assert.equal(f.state.locations.habitat.resources.solarCells,Number.MAX_SAFE_INTEGER-1); assert.equal(f.runtime.isPaused(),false);
});
