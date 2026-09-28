import assert from "node:assert/strict";
import { test } from "node:test";
import { definitions, content } from "../js/content.js";
import { buildCatalog } from "../js/itemCatalog.js";
import { previewRecipe, craft, ingredientOptions } from "../js/crafting.js";
import { createItemActions } from "../js/itemActions.js";
import { createInitialState, migrateState, validateState, worldFor } from "../js/state.js";
import { powerRate, advanceGame } from "../js/game.js";
import { grantOpeningKnowledge } from "./researchFixtures.mjs";
import { capacity } from "../js/resources.js";
import { storageSummary } from "../js/storage.js";

import { getLocationContext } from "../js/locations.js";
import { effectServicesFor as createEffectServices } from "./worldLedgerFixtures.mjs";
const context = (state, catalog = content) => getLocationContext(state, catalog, worldFor(catalog));
const local = (state, catalog = content) => context(state, catalog).actionState;
const tick = (state, seconds, catalog) => advanceGame(state, seconds, catalog, (s, id) => getLocationContext(s, catalog, worldFor(catalog), id));

test("passive storage is definition-driven, additive, and reads live installed counts", () => {
  const source = structuredClone(definitions);
  source.items.storageFixture = { name: "Storage fixture", category: "product", unitVolumeM3: 0.005,
    installation: { group: "fixtureStorage", capacityBonus: { power: 7 }, storageBonusM3: 0.03 } };
  const catalog = buildCatalog(source);
  const state = createInitialState(catalog);
  const view = local(state, catalog);
  view.capacities.power = 20.5;
  state.locations.habitat.resources.storageFixture = 2;
  assert.equal(capacity(view, "power", catalog), 20.5);
  const machine = state.locations.habitat.infrastructure.fixtureStorage;
  Object.assign(machine, { quantity: 2, health: 0, enabled: false });
  assert.equal(capacity(view, "power", catalog), 34.5);
  assert.equal(storageSummary(view, catalog).capacityVolumeUnits, 10060000);
  assert.throws(() => capacity(view, "scrap", catalog), /shared cargo/);
  state.locations.habitat.infrastructure.installedBatteryBanks.quantity = 1;
  assert.equal(capacity(view, "power", catalog), 44.5);
});

test("catalog rejects malformed storage bonuses", () => {
  for (const bonus of [null, [], 10, { missing: 1 }, { power: -1 }, { power: 0 },
    { power: 0.5 }, { power: NaN }, { power: Infinity }, { power: Number.MAX_SAFE_INTEGER + 1 }]) {
    const source = structuredClone(definitions);
    source.items.batteryBank.installation.capacityBonus = bonus;
    assert.throws(() => buildCatalog(source), /capacity bonus/);
  }
});

function transact(state, id, catalog = content) {
  const action = createItemActions(catalog, createEffectServices({ content: catalog, world: worldFor(catalog) })).find(action => action.id === id);
  assert.ok(action, id);
  assert.ok(!action.visible || action.visible(state, context(state, catalog)), `${id} is hidden`);
  assert.equal(action.requirement?.(state, context(state, catalog)) ?? "", "");
  const next = structuredClone(state);
  action.execute(next, context(next, catalog));
  validateState(next, catalog);
  return next;
}

function extendedCatalog() {
  const source = structuredClone(definitions);
  source.items.newMetal = {
    name: "New metal", category: "resource", researchSampleM3: 0.01,
    acquisition: [{ id: "gatherNewMetal", name: "Gather new metal", amount: 0.02 }],
    recipeContributions: [{ id: "structure", name: "Form new metal", output: "iron",
      inputs: [{ id: "material", item: "newMetal", quantity: 0.02 }] }]
  };
  source.items.newConductor = {
    name: "New conductor", category: "component", unitVolumeM3: 0.005, tags: ["conductive"],
    roles: { conductor: { units: 2, conditions: { discoveries: ["conductorAdaptation"] } } },
    recipes: [{ id: "make", name: "Make new conductor", inputs: [{ id: "material", item: "newMetal", quantity: 0.01 }] }]
  };
  source.items.newGenerator = {
    name: "New generator", category: "product", unitVolumeM3: 0.005,
    recipes: [{ id: "make", name: "Build new generator", inputs: [{ id: "frame", role: "structure", quantity: 1, defaultItem: "iron" }] }],
    installation: { group: "newGenerators", powerPerSecond: 0.7 },
    upgrades: [{ id: "boost", name: "Improve generator", cost: { iron: 1 }, powerBonus: 0.2 }],
    operations: [{ id: "testConsume", name: "Operate new generator", cost: { newMetal: 0.01, newConductor: 1 }, effect: { type: "setFlag", flag: "testedGenerator" } }]
  };
  return buildCatalog(source);
}

test("definition-only additions generate gathering, alternate recipes, substitution, installation, and operations", () => {
  const catalog = extendedCatalog();
  let state = createInitialState(catalog);
  grantOpeningKnowledge(state);
  assert.equal(state.locations.habitat.resources.newMetal, 0);
  state = transact(state, "gatherNewMetal", catalog);
  craft(local(state, catalog), "newMetal:structure", {}, catalog);
  assert.equal(state.locations.habitat.resources.iron, 1);
  craft(local(state, catalog), "newGenerator:make", {}, catalog);
  state = transact(state, "install:newGenerator", catalog);
  assert.ok(Math.abs(powerRate(local(state, catalog), catalog) - 0.6) < 1e-10);
  state.locations.habitat.resources.iron = 1;
  state = transact(state, "upgrade:newGenerator:boost", catalog);
  assert.ok(Math.abs(powerRate(local(state, catalog), catalog) - 0.8) < 1e-10);
  state.locations.habitat.resources.newMetal = 10000;
  state.locations.habitat.resources.newConductor = 1;
  state = transact(state, "testConsume", catalog);
  assert.equal(state.locations.habitat.resources.newMetal, 0);
  assert.equal(state.locations.habitat.resources.newConductor, 0);
  assert.equal(state.flags.testedGenerator, true);
  const recipe = catalog.recipes["radioAntenna:assemble"];
  const wiring = recipe.inputs.find(slot => slot.id === "wiring");
  assert.match(ingredientOptions(local(state, catalog), recipe, wiring, catalog).find(option => option.id === "newConductor").reason, /discovery/);
  state.knowledge.discoveries.conductorAdaptation = true;
  assert.equal(ingredientOptions(local(state, catalog), recipe, wiring, catalog).find(option => option.id === "newConductor").reason, "");
  state.locations.habitat.resources.iron = 1;
  state.locations.habitat.resources.electronicParts = 1;
  state.locations.habitat.resources.newConductor = 1;
  craft(local(state, catalog), recipe.id, { wiring: "newConductor" }, catalog);
  assert.equal(state.locations.habitat.resources.radioAntenna, 1);
});

test("physical tags alone do not grant substitution; products cannot fill ingredient slots", () => {
  const source = structuredClone(definitions);
  source.items.electronicSalvage.tags.push("conductor");
  source.items.solarPanel.roles = { conductor: {} };
  const catalog = buildCatalog(source);
  const recipe = catalog.recipes["radioAntenna:assemble"];
  const options = ingredientOptions(local(createInitialState(catalog), catalog), recipe, recipe.inputs[1], catalog);
  assert.deepEqual(options.map(option => option.id), ["conductiveParts"]);
});

test("recipe discovery and role discovery are independent", () => {
  const catalog = extendedCatalog();
  catalog.recipes["radioAntenna:assemble"].conditions = { discoveries: ["antennaKnowledge"] };
  const state = createInitialState(catalog);
  state.knowledge.discoveries.conductorAdaptation = true;
  assert.match(previewRecipe(local(state, catalog), "radioAntenna:assemble", { wiring: "newConductor" }, catalog).reason, /discovery/);
  state.knowledge.discoveries.antennaKnowledge = true;
  delete state.knowledge.discoveries.conductorAdaptation;
  assert.match(previewRecipe(local(state, catalog), "radioAntenna:assemble", { wiring: "newConductor" }, catalog).reason, /discovery/);
});

test("a new ingredient can restrict its own approved use to selected recipes", () => {
  const source = structuredClone(definitions);
  source.items.specialConductor = { name: "Special conductor", category: "component", unitVolumeM3: 0.005,
    roles: { conductor: { recipes: ["radioAntenna:assemble"] } } };
  const catalog = buildCatalog(source);
  const state = createInitialState(catalog);
  for (const [recipeId, expected] of [["radioAntenna:assemble", true], ["solarPanel:assemble", false]]) {
    const recipe = catalog.recipes[recipeId];
    const slot = recipe.inputs.find(slot => slot.role === "conductor");
    assert.equal(ingredientOptions(local(state, catalog), recipe, slot, catalog).some(option => option.id === "specialConductor"), expected);
  }
});

test("ratios round upward and one inventory unit cannot satisfy multiple slots", () => {
  const catalog = extendedCatalog();
  const recipe = catalog.recipes["radioAntenna:assemble"];
  recipe.inputs = [{ id: "first", role: "conductor", quantity: 3 }, { id: "second", role: "conductor", quantity: 1 }];
  const state = createInitialState(catalog);
  state.knowledge.discoveries.conductorAdaptation = true;
  state.locations.habitat.resources.newConductor = 2;
  const selection = { first: "newConductor", second: "newConductor" };
  const preview = previewRecipe(local(state, catalog), recipe.id, selection, catalog);
  assert.equal(preview.cost.newConductor, 3);
  assert.match(preview.reason, /Requires/);
  const before = structuredClone(state);
  assert.throws(() => craft(local(state, catalog), recipe.id, selection, catalog), /Requires/);
  assert.deepEqual(state, before);
});

test("preview is read-only and an expanding recipe cannot overflow shared storage", () => {
  const state = createInitialState();
  grantOpeningKnowledge(state);
  Object.assign(state.locations.habitat.resources, { scrap: 9986000, iron: 2, conductiveParts: 2 });
  const before = structuredClone(state);
  assert.match(previewRecipe(local(state, content), "batteryBank:assemble", {}, content).reason, /Make room/);
  assert.throws(() => craft(local(state, content), "batteryBank:assemble", {}, content), /Make room/);
  assert.deepEqual(state, before);
});

test("capacity uses inventory after input consumption", () => {
  const source = structuredClone(definitions);
  source.items.iron.recipes.push({ id: "rework", name: "Rework structural parts", inputs: [{ id: "part", item: "iron", quantity: 1 }] });
  const catalog = buildCatalog(source);
  const state = createInitialState(catalog);
  state.locations.habitat.resources.iron = 30;
  craft(local(state, catalog), "iron:rework", {}, catalog);
  assert.equal(state.locations.habitat.resources.iron, 30);
});

test("catalog rejects category violations, bad quantities, references, and unknown behaviors", () => {
  const invalid = mutate => { const source = structuredClone(definitions); mutate(source); assert.throws(() => buildCatalog(source), /Invalid catalog/); };
  invalid(source => { source.items.scrap.recipes = [{ id: "bad", name: "Bad", inputs: [{ id: "a", item: "iron", quantity: 1 }] }]; });
  invalid(source => { source.items.solarPanel.recipes[0].inputs[0] = { id: "a", item: "scrap", quantity: 1 }; });
  invalid(source => { source.items.iron.recipes[0].inputs[0].quantity = -1; });
  invalid(source => { source.items.iron.recipes[0].inputs[0].item = "missing"; });
  invalid(source => { source.items.iron.roles.structure.units = 0; });
  invalid(source => { source.items.radioAntenna.operations[0].effects[0].type = "teleport"; });
  invalid(source => { source.items.radioAntenna.operations[0].cost = { solarPanel: 1 }; });
  invalid(source => { source.items.solarPanel.maintenance[0].cost = { scrap: 1 }; });
  invalid(source => { source.items.solarPanel.recipes[0].cost = { scrap: 1 }; });
  invalid(source => { source.items.iron.recipeContributions = [{ id: "bad", name: "Bad output", output: "scrap", inputs: [{ id: "a", item: "iron", quantity: 1 }] }]; });
});

test("generated action collisions are caught before registration", () => {
  const source = structuredClone(definitions);
  source.items.siliconMinerals.acquisition[0].id = "salvage";
  assert.throws(() => createItemActions(buildCatalog(source)), /duplicate generated action/i);
});

test("version-one saves preserve progress and new catalog entries receive defaults", () => {
  const saved = { saveVersion: 1, simulationTime: 42, locationId: "habitat", resources: { power: 3, scrap: 7, iron: 2 },
    infrastructure: { solar: { quantity: 1, health: 0.4, enabled: true }, habitat: { quantity: 1, health: 1, enabled: true } } };
  const original = structuredClone(saved);
  const migrated = migrateState(saved);
  assert.deepEqual(saved, original);
  assert.equal(migrated.locations.habitat.resources.iron, 2);
  assert.equal(migrated.locations.habitat.infrastructure.solar.health, 0.4);
  assert.equal(migrated.simulationTime, 42);
  assert.equal(migrated.locations.habitat.infrastructure.installedPanels.quantity, 0);
  assert.equal(migrateState(migrated, extendedCatalog()).locations.habitat.resources.newMetal, 0);
  assert.deepEqual(migrateState(migrated), migrated);
});

test("migration rejects corrupted values and unsupported versions without mutating the source", () => {
  const state = createInitialState();
  state.locations.habitat.resources.iron = -1;
  const original = structuredClone(state);
  assert.throws(() => migrateState(state), /Invalid iron/);
  assert.deepEqual(state, original);
  assert.throws(() => migrateState({ ...state, saveVersion: 99 }), /Unsupported/);
});

test("with fabrication knowledge, both products and repair are reachable from depleted reserves", () => {
  let state = createInitialState();
  grantOpeningKnowledge(state);
  state.locations.habitat.resources.power = 0;
  for (let i = 0; i < 20; i++) state = transact(state, "salvage");
  for (let i = 0; i < 5; i++) craft(local(state, content), "iron:refine", {}, content);
  state = transact(state, "repairSolar");
  for (let i = 0; i < 4; i++) state = transact(state, "salvage");
  for (let i = 0; i < 8; i++) state = transact(state, "gatherElectronics");
  for (let i = 0; i < 4; i++) state = transact(state, "gatherMinerals");
  for (let i = 0; i < 2; i++) craft(local(state, content), "conductiveParts:fabricate", {}, content);
  for (let i = 0; i < 3; i++) craft(local(state, content), "electronicParts:fabricate", {}, content);
  for (let i = 0; i < 2; i++) craft(local(state, content), "solarCells:fabricate", {}, content);
  craft(local(state, content), "solarPanel:assemble", {}, content);
  craft(local(state, content), "radioAntenna:assemble", {}, content);
  state = transact(state, "install:solarPanel");
  state = transact(state, "install:radioAntenna");
  assert.equal(state.locations.habitat.resources.solarPanel, 0);
  assert.equal(state.locations.habitat.resources.radioAntenna, 0);
  assert.equal(powerRate(local(state, content), content), 0.8);
  tick(state, 2, content);
  state = transact(state, "scanSignal");
  assert.equal(state.flags.localSignalObserved, true);
  assert.ok(Math.abs(state.locations.habitat.resources.power - 0.6) < 1e-10);
});

test("new panels preserve starting damage and generation is timestep independent", () => {
  let state = createInitialState();
  state.locations.habitat.resources.solarPanel = 1;
  state = transact(state, "install:solarPanel");
  assert.equal(state.locations.habitat.infrastructure.solar.health, 0.2);
  assert.equal(state.locations.habitat.infrastructure.installedPanels.health, 1);
  assert.equal(powerRate(local(state, content), content), 0.4);
  const other = structuredClone(state);
  tick(state, 10, content);
  for (let i = 0; i < 10; i++) tick(other, 1, content);
  assert.ok(Math.abs(state.locations.habitat.resources.power - other.locations.habitat.resources.power) < 1e-10);
});
