import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { content, definitions } from "../js/content.js";
import { buildCatalog } from "../js/itemCatalog.js";
import { locationDefinitions } from "../js/locationContent.js";
import { createItemActions } from "../js/itemActions.js";
import { createInitialState, migrateState, validateState, defaultWorld } from "../js/state.js";
import { buildLocationCatalog, getLocationContext, createLocationActions, validateActionScopes, graphView,
  movePlayer, travelReason, locationTransferReason, transferBetweenLocations } from "../js/locations.js";
import initialize, { registerAction, executeAction, resolveAction, getActionStatus } from "../js/playerActions.js";
import { previewRecipe, craft } from "../js/crafting.js";
import { advanceGame, createView } from "../js/game.js";
import { createShipActions } from "../js/ships.js";
import { grantOpeningKnowledge } from "./researchFixtures.mjs";
import { researchFor } from "../js/research/researchSystem.js";
import { createResearchActions } from "../js/research/researchActions.js";
import { peopleFor } from "../js/peopleSystem.js";
import { effectServicesFor as createEffectServices } from "./worldLedgerFixtures.mjs";

const authored = structuredClone(locationDefinitions);
authored.locations.shipA = { name: "Test ship A", type: "ship", areaId: "vicinity", initialOwnerId: "player",
  description: "A test-only ship.", remoteDescription: "A test ship.", actions: ["salvage", "inspectSite", "scopeA"],
  initialInfrastructure: { fabricator: { quantity: 1 }, solar: { quantity: 1 } }, initialResources: { power: 4 } };
authored.locations.shipB = { ...structuredClone(authored.locations.shipA), name: "Test ship B", actions: ["salvage", "inspectSite", "scopeB"] };
authored.locations.farOwned = { ...structuredClone(authored.locations.shipA), name: "Far owned site", areaId: "outerReach", actions: [] };
authored.locations.hidden = { name: "Hidden area", type: "area", position: [170, 50], conditions: { flags: ["revealed"] },
  description: "A hidden area.", remoteDescription: "Unknown collectors." };
authored.locations.distant = { name: "Distant area", type: "area", position: [1000, 1000], description: "Far away.", remoteDescription: "Distant." };
const custom = ["A", "B"].map(suffix => ({ id: `scope${suffix}`, name: "Survey hull", shortcut: "7", access: "public",
  execute(_state, ctx) { ctx.local.flags.surveyed = true; return "Surveyed."; } }));
const world = buildLocationCatalog(authored, content, [...createItemActions(content), ...custom]);
const itemActions = createItemActions(content, createEffectServices({ content, world }));
const actions = [...itemActions, ...custom, ...createLocationActions(world, content), ...createShipActions(world, content),
  ...createResearchActions(researchFor(content, world, peopleFor(content, world)))];
actions.forEach(registerAction);
let state, failSave, saved;
const context = (s, id) => getLocationContext(s, content, world, id);
initialize({ getState: () => state, getContext: context, validateActions: batch => validateActionScopes(batch, world),
  applyAction(execute) {
    const candidate = structuredClone(state);
    const message = execute(candidate);
    validateState(candidate, content, world);
    if (failSave) throw new Error("Save failed");
    saved = structuredClone(candidate); state = candidate; return message;
  } });
beforeEach(() => { state = grantOpeningKnowledge(createInitialState(content, world)); failSave = false; saved = structuredClone(state); });
const transfer = overrides => ({ sourceId: "habitat", destinationId: "shipA", assetId: "power", amount: 1, ...overrides });
// These tests isolate local asset behavior; actual journeys are covered in ships.test.mjs.
const occupyFixture = id => { state.locationId = id; };

test("a fresh game reaches battery storage through research and renewable local materials", () => {
  state = createInitialState(content, world);
  state.locations.habitat.resources.power = 0;
  assert.equal(getActionStatus("selectRecipe:batteryBank:assemble").available, false);
  executeAction("inspect:habitat:fitting");
  executeAction("salvage");
  executeAction("research:experiment", { methodId: "bench", items: ["scrap"] });
  executeAction("salvage");
  executeAction("gatherElectronics");
  executeAction("research:experiment", { methodId: "bench", items: ["scrap", "electronicSalvage"] });
  assert.equal(state.knowledge.discoveries.structuralFabrication, true);
  assert.equal(state.knowledge.discoveries.electricalConduction, true);
  for (let i = 0; i < 12; i++) executeAction("salvage");
  for (let i = 0; i < 2; i++) executeAction("gatherElectronics");
  for (const recipe of ["iron:refine", "conductiveParts:fabricate"]) {
    executeAction(`selectRecipe:${recipe}`);
    executeAction("craftSelected");
    executeAction("craftSelected");
  }
  executeAction("selectRecipe:batteryBank:assemble");
  executeAction("craftSelected");
  executeAction("install:batteryBank");
  assert.equal(createView(context(state).actionState, content).powerCapacity, 50);
  assert.equal(state.locations.habitat.resources.power, 0);
});

test("battery banks craft and install through local transactions, then store and spend surplus power", () => {
  executeAction("selectRecipe:batteryBank:assemble");
  delete state.knowledge.discoveries.electricalConduction;
  assert.equal(getActionStatus("craftSelected").available, false);
  state.knowledge.discoveries.electricalConduction = true;
  state.locations.habitat.resources.iron = 4;
  state.locations.habitat.resources.conductiveParts = 4;
  executeAction("craftSelected");
  executeAction("craftSelected");
  assert.equal(state.locations.habitat.resources.iron, 0);
  assert.equal(state.locations.habitat.resources.conductiveParts, 0);
  assert.equal(createView(context(state).actionState, content).powerCapacity, 40);
  assert.equal(resolveAction("install battery bank"), "install:batteryBank");
  const originalPower = state.locations.habitat.resources.power;
  executeAction("install:batteryBank");
  assert.equal(createView(context(state).actionState, content).powerCapacity, 50);
  assert.equal(state.locations.habitat.resources.power, originalPower);
  const before = structuredClone(state);
  failSave = true;
  assert.throws(() => executeAction("install:batteryBank"), /Save failed/);
  assert.deepEqual(state, before);
  failSave = false;
  executeAction("install:batteryBank");
  assert.equal(state.locations.habitat.resources.batteryBank, 0);
  assert.equal(createView(context(state).actionState, content).powerCapacity, 60);
  assert.equal(createView(context(state, "shipA").actionState, content).powerCapacity, 40);
  state.locations.habitat.infrastructure.solar.health = 1;
  advanceGame(state, 1000, content, context);
  assert.equal(state.locations.habitat.resources.power, 60);
  state.locations.habitat.infrastructure.solar.enabled = false;
  advanceGame(state, 10, content, context);
  assert.equal(state.locations.habitat.resources.power, 58);
  Object.assign(state.locations.habitat.infrastructure.installedBatteryBanks, { health: 0, enabled: false });
  validateState(state, content, world);
  const restored = migrateState(JSON.parse(JSON.stringify(state)), content, world);
  assert.deepEqual(restored, state);
  assert.equal(createView(context(restored).actionState, content).powerCapacity, 60);
});

test("battery storage respects location overrides, ownership, and transfer limits", () => {
  occupyFixture("supplyPlatform");
  state.locations.supplyPlatform.resources.batteryBank = 1;
  state.entities.supplyPlatform.ownerId = null;
  assert.throws(() => executeAction("install:batteryBank"), /ownership/);
  state.entities.supplyPlatform.ownerId = "player";
  executeAction("install:batteryBank");
  assert.equal(createView(context(state).actionState, content).powerCapacity, 30);
  state.locations.shipA.resources.power = 40;
  executeAction("transferLocations", { sourceId: "shipA", destinationId: "supplyPlatform", assetId: "power", amount: 28 });
  assert.equal(state.locations.supplyPlatform.resources.power, 30);
  const before = structuredClone(state);
  assert.throws(() => executeAction("transferLocations", { sourceId: "shipA", destinationId: "supplyPlatform", assetId: "power", amount: 1 }), /capacity/);
  assert.deepEqual(state, before);
  state.locations.supplyPlatform.resources.power = 31;
  assert.throws(() => validateState(state, content, world), /power quantity/);
});

test("pre-battery saves gain empty inventory and installations without changing progress", () => {
  const oldDefinitions = structuredClone(definitions);
  delete oldDefinitions.items.batteryBank;
  const oldContent = buildCatalog(oldDefinitions);
  const oldWorld = buildLocationCatalog(locationDefinitions, oldContent, createItemActions(oldContent));
  const old = grantOpeningKnowledge(createInitialState(oldContent, oldWorld));
  old.locations.habitat.resources.power = 40;
  old.locations.habitat.resources.scrap = 70000;
  old.crafting = { recipeId: "iron:refine", ingredients: { metal: "scrap" } };
  const restored = migrateState(old);
  validateState(restored);
  for (const site of Object.values(restored.locations)) {
    assert.equal(site.resources.batteryBank, 0);
    assert.equal(site.infrastructure.installedBatteryBanks.quantity, 0);
    delete site.resources.batteryBank;
    delete site.infrastructure.installedBatteryBanks;
  }
  assert.deepEqual(restored, old);
});

test("distance connects areas inclusively; direct player travel is retired", () => {
  const source = structuredClone(authored); source.locations.outerReach.position = [120, 0];
  const boundary = buildLocationCatalog(source, content, [...itemActions, ...custom]);
  assert.ok(boundary.links.some(([a, b]) => a === "vicinity" && b === "outerReach"));
  source.locations.outerReach.position = [120.001, 0];
  assert.ok(!buildLocationCatalog(source, content, [...itemActions, ...custom]).links.some(([a, b]) => a === "vicinity" && b === "outerReach"));
  for (const id of ["shipA", "shipB", "supplyPlatform", "vicinity", "outerReach"]) {
    assert.match(travelReason(state, id, world, content), /Board a ship/);
    assert.throws(() => movePlayer(state, id, world, content), /Board a ship/);
  }
  assert.throws(() => executeAction("travel:outerReach"), /Board a ship/);
  assert.throws(() => executeAction("travel:derelict"), /Unknown action/);
  assert.equal(state.locationId, "habitat");
});

test("definition-only sites, deterministic template merging and independent mutable assets", () => {
  const source = structuredClone(locationDefinitions);
  source.types.platform.actions = ["salvage"];
  source.types.platform.initialResources = { scrap: 0.05, power: 3 };
  source.types.platform.initialInfrastructure = { solar: { quantity: 1, health: 0.4 } };
  source.types.platform.sceneObjects = [{ id: "panel", name: "Old panel", description: "Old." }, { id: "removed", name: "Remove", description: "Old." }];
  source.locations.added = { name: "Added platform", type: "platform", areaId: "vicinity", initialOwnerId: "player", description: "New.", remoteDescription: "New.",
    initialResources: { scrap: 0 }, initialInfrastructure: { solar: { health: 1 } }, removeActions: ["salvage"], removeSceneObjects: ["removed"],
    sceneObjects: [{ id: "panel", name: "New panel", description: "New." }] };
  const catalog = buildLocationCatalog(source, content, itemActions);
  const initial = createInitialState(content, catalog);
  assert.equal(initial.locations.added.resources.scrap, 0);
  assert.equal(initial.locations.added.resources.power, 3);
  assert.equal(initial.locations.added.infrastructure.solar.quantity, 1);
  assert.equal(initial.locations.added.infrastructure.solar.health, 1);
  assert.equal(catalog.definitions.added.sceneObjects[0].name, "New panel");
  assert.equal(catalog.definitions.added.sceneObjects.length, 1);
  assert.ok(!catalog.definitions.added.actions.includes("salvage"));
  assert.equal(new Set(catalog.definitions.added.actions).size, catalog.definitions.added.actions.length);
  initial.locations.added.infrastructure.solar.upgrades.push("test");
  assert.deepEqual(initial.locations.supplyPlatform.infrastructure.solar.upgrades, []);
  assert.match(travelReason(initial, "added", catalog, content), /Board a ship/);
});

test("unknown definitions, references, capacities and command conflicts fail at startup", () => {
  for (const mutate of [
    s => { s.locations.habitat.type = "missing"; }, s => { s.locations.habitat.areaId = "missing"; },
    s => { s.locations.habitat.actions = ["missing"]; }, s => { s.locations.habitat.initialResources = { missing: 1 }; },
    s => { s.locations.habitat.initialInfrastructure = { missing: { quantity: 1 } }; },
    s => { s.locations.habitat.sceneObjects = [{ id: "bad", locationId: "missing" }]; },
    s => { s.locations.habitat.capacities = { power: 1 }; }, s => { s.locations.vicinity.position = [0, NaN]; },
    s => { s.locations.habitat.actions = ["scopeA", "scopeB"]; }
  ]) { const source = structuredClone(authored); mutate(source); assert.throws(() => buildLocationCatalog(source, content, [...itemActions, ...custom]), /Invalid/); }
});

test("shared actions and scoped commands use fresh local assets and cannot act remotely", () => {
  executeAction("salvage"); occupyFixture("shipA"); executeAction("salvage");
  assert.equal(state.locations.habitat.resources.scrap, 10000);
  assert.equal(state.locations.shipA.resources.scrap, 10000);
  assert.equal(resolveAction("7"), "scopeA"); executeAction("scopeA");
  occupyFixture("shipB"); assert.equal(resolveAction("Survey hull"), "scopeB");
  assert.throws(() => executeAction("scopeA"), /not available/);
  occupyFixture("supplyPlatform");
  assert.equal(resolveAction("1"), null);
  assert.throws(() => executeAction("salvage"), /not available/);
  assert.equal(state.locations.shipB.flags.surveyed, undefined);
});

test("ownership and operational local fabrication are checked by previews and execution", () => {
  occupyFixture("supplyPlatform"); state.locations.supplyPlatform.resources.scrap = 40000;
  assert.match(previewRecipe(context(state).actionState, "iron:refine", {}, content).reason, /capability/);
  assert.throws(() => craft(context(state).actionState, "iron:refine", {}, content), /capability/);
  assert.throws(() => executeAction("refineScrap"), /operational fabricator/);
  executeAction("selectRecipe:iron:refine"); assert.throws(() => executeAction("craftSelected"), /capability/);
  occupyFixture("shipA"); state.locations.shipA.resources.scrap = 40000;
  state.entities.shipA.ownerId = null;
  assert.match(previewRecipe(context(state).actionState, "iron:refine", {}, content).reason, /ownership/);
  assert.throws(() => executeAction("craftSelected"), /ownership/);
  state.entities.shipA.ownerId = "player";
  for (const patch of [{ enabled: false }, { health: 0 }, { quantity: 0 }]) {
    state.locations.shipA.infrastructure.fabricator = { quantity: 1, health: 1, enabled: true, upgrades: [], ...patch };
    assert.throws(() => executeAction("craftSelected"), /capability/);
  }
  assert.equal(state.locations.shipA.resources.scrap, 40000);
});

test("installation, repair and local completion stay local; legacy radio flag stays global", () => {
  occupyFixture("shipA"); state.locations.shipA.resources.solarPanel = 1;
  state.locations.shipA.resources.iron = 2; state.locations.shipA.infrastructure.solar.health = 0.3;
  executeAction("install:solarPanel"); executeAction("repairSolar"); executeAction("inspectSite");
  assert.equal(state.locations.shipA.infrastructure.installedPanels.quantity, 1);
  assert.equal(state.locations.shipA.infrastructure.solar.health, 1);
  assert.equal(state.locations.habitat.infrastructure.solar.health, 0.2);
  assert.equal(state.locations.habitat.infrastructure.installedPanels.quantity, 0);
  occupyFixture("shipB"); assert.equal(getActionStatus("inspectSite").available, true);
  executeAction("inspectSite");
  state.locations.shipB.infrastructure.installedAntenna.quantity = 1;
  executeAction("scanSignal"); assert.equal(state.flags.localSignalObserved, true);
  occupyFixture("shipA"); state.locations.shipA.infrastructure.installedAntenna.quantity = 1;
  assert.equal(getActionStatus("scanSignal").visible, false);
});

test("explicit local item-operation flags do not complete operations elsewhere", () => {
  const source = structuredClone(definitions);
  const operation = source.items.radioAntenna.operations[0];
  delete operation.effects; delete operation.completion;
  operation.effect = { type: "setFlag", flag: "localSignalObserved", scope: "local" };
  const catalog = buildCatalog(source), localWorld = buildLocationCatalog(locationDefinitions, catalog, createItemActions(catalog));
  const s = createInitialState(catalog, localWorld);
  const action = createItemActions(catalog, createEffectServices({ content: catalog, world: localWorld })).find(a => a.id === "scanSignal");
  s.locations.habitat.infrastructure.installedAntenna.quantity = 1;
  action.execute(s, getLocationContext(s, catalog, localWorld));
  assert.equal(s.locations.habitat.flags.localSignalObserved, true);
  assert.equal(s.flags.localSignalObserved, undefined);
  assert.equal(s.locations.supplyPlatform.flags.localSignalObserved, undefined);
});

test("power advances independently at every location with only one world-clock increment", () => {
  advanceGame(state, 10, content, context);
  assert.equal(state.simulationTime, 10);
  assert.equal(state.locations.habitat.resources.power, 7);
  assert.equal(state.locations.shipA.resources.power, 9);
  assert.equal(state.locations.supplyPlatform.resources.power, 2);
  assert.equal(state.locations.vicinity.resources.power, 0);
  assert.equal(createView(context(state, "supplyPlatform").actionState, content).solarHealth, null);
});

test("transfers conserve items and fractional power, support receiving, and recheck live state", () => {
  state.locations.habitat.resources.solarPanel = 2;
  executeAction("transferLocations", transfer({ assetId: "solarPanel", amount: 2 }));
  assert.equal(state.locations.habitat.resources.solarPanel, 0); assert.equal(state.locations.shipA.resources.solarPanel, 2);
  executeAction("transferLocations", transfer({ amount: 0.5 }));
  assert.equal(state.locations.habitat.resources.power, 7.5); assert.equal(state.locations.shipA.resources.power, 4.5);
  executeAction("transferLocations", transfer({ sourceId: "shipA", destinationId: "habitat", amount: 1.5 }));
  assert.equal(state.locations.habitat.resources.power, 9); assert.equal(state.locations.shipA.resources.power, 3);
  state.entities.shipA.ownerId = null;
  assert.throws(() => executeAction("transferLocations", transfer()), /ownership|permission/);
  state.entities.shipA.ownerId = "player"; state.locations.shipA.areaId = "outerReach";
  assert.throws(() => executeAction("transferLocations", transfer()), /same area/);
});

test("invalid transfers never partially debit either endpoint", () => {
  for (const payload of [undefined, transfer({ destinationId: "habitat" }), transfer({ destinationId: "derelict" }),
    transfer({ destinationId: "farOwned" }), transfer({ sourceId: "shipA", destinationId: "shipB" }),
    transfer({ assetId: "solar" }), transfer({ amount: NaN }), transfer({ amount: Infinity }), transfer({ amount: -1 }),
    transfer({ amount: 0 }), transfer({ amount: 99 }), transfer({ assetId: "scrap", amount: 0.5 }), transfer({ destinationId: "vicinity" })]) {
    const before = structuredClone(state);
    assert.ok(locationTransferReason(state, payload, world, content));
    assert.throws(() => transferBetweenLocations(state, payload, world, content)); assert.deepEqual(state, before);
  }
  state.locations.shipA.resources.power = 40;
  assert.match(locationTransferReason(state, transfer(), world, content), /capacity/);
});

test("failed saves roll back travel and both transfer endpoints", () => {
  state.locations.shipA.dockedAtId = "habitat";
  saved = structuredClone(state);
  const before = state; const snapshot = structuredClone(state); failSave = true;
  assert.throws(() => executeAction("transferLocations", transfer()), /Save failed/);
  assert.throws(() => executeAction("board:shipA"), /Save failed/);
  assert.equal(state, before); assert.deepEqual(state, snapshot); assert.deepEqual(saved, snapshot);
});

test("discovery and travel access differ; graph views are read-only and use saved ship areas", () => {
  const before = structuredClone(state);
  assert.ok(!graphView(state, world, content).nodes.some(n => n.id === "hidden"));
  graphView(state, world, content, "vicinity"); assert.deepEqual(state, before);
  state.flags.revealed = true;
  assert.ok(graphView(state, world, content).nodes.some(n => n.id === "hidden"));
  state.locations.shipA.areaId = "outerReach";
  assert.ok(!graphView(state, world, content, "vicinity").nodes.some(n => n.id === "shipA"));
  assert.ok(graphView(state, world, content, "outerReach").nodes.some(n => n.id === "shipA"));
  const source = structuredClone(locationDefinitions); source.locations.outerReach.accessConditions = { flags: ["permission"] };
  const locked = buildLocationCatalog(source, content, itemActions);
  const fresh = createInitialState(content, locked);
  assert.ok(graphView(fresh, locked, content).nodes.some(n => n.id === "outerReach"));
  assert.throws(() => movePlayer(fresh, "outerReach", locked, content), /Board a ship/);
});

test("legacy migration preserves progress once; later additions do not replay starting grants", () => {
  const old = { saveVersion: 2, locationId: "supplyPlatform", simulationTime: 123, resources: { power: 5, iron: 4 },
    infrastructure: { solar: { quantity: 1, health: 0.6, enabled: false, upgrades: [] } },
    knowledge: { discoveries: { known: true } }, flags: { localSignalObserved: true }, crafting: { recipeId: "iron:refine", ingredients: { metal: "scrap" } } };
  const migrated = migrateState(old);
  assert.equal(migrated.locationId, "supplyPlatform"); assert.equal(migrated.locations.habitat.resources.power, 5);
  assert.deepEqual(migrated.locations.habitat.infrastructure.solar, old.infrastructure.solar);
  assert.equal(migrated.locations.habitat.infrastructure.fabricator.quantity, 1);
  for (const key of ["simulationTime", "flags", "crafting"]) assert.deepEqual(migrated[key], old[key]);
  assert.equal(migrated.knowledge.discoveries.known, true);
  assert.equal(migrated.knowledge.discoveries.structuralFabrication, true);
  const source = structuredClone(locationDefinitions);
  source.locations.habitat.initialResources.power = 30;
  source.locations.added = { ...source.locations.supplyPlatform, name: "Added site", initialResources: { power: 6 } };
  const addedWorld = buildLocationCatalog(source, content, itemActions);
  migrated.entities.habitat.ownerId = null;
  const added = migrateState(migrated, content, addedWorld);
  assert.equal(added.locations.habitat.resources.power, 5); assert.equal(added.entities.habitat.ownerId, null);
  assert.equal(added.locations.added.resources.power, 6);
  assert.deepEqual(migrateState(added, content, addedWorld), added);
  assert.throws(() => migrateState({ ...old, locationId: "missing" }), /Invalid location/);
  const malformed = createInitialState(); malformed.locations.habitat.resources.scrap = -1;
  assert.throws(() => migrateState(malformed), /Invalid scrap/);
  const removed = structuredClone(defaultWorld); delete removed.definitions.supplyPlatform;
  assert.throws(() => migrateState(createInitialState(), content, removed), /removed/);
});
