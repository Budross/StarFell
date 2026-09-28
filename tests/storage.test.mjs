import assert from "node:assert/strict";
import { test } from "node:test";
import { content, definitions } from "../js/content.js";
import { buildCatalog } from "../js/itemCatalog.js";
import { buildGameSystems } from "../js/bootstrap.js";
import { createGameRuntime } from "../js/runtime.js";
import { createActionRegistry } from "../js/playerActions.js";
import { createInitialState, validateState } from "../js/state.js";
import { getLocationContext, compileLocationCatalog, locationTransferReason } from "../js/locations.js";
import { locationDefinitions } from "../js/locationContent.js";
import { volumeUnits, parseQuantity, formatVolume, checkedAdd, checkedMultiply, roleQuantity } from "../js/quantities.js";
import { storageSummary, maxReceivable, entryVolume } from "../js/storage.js";
import { transfer, previewExchange, moveExact, receiveUtilityClamped } from "../js/resources.js";
import { previewInstallation } from "../js/itemActions.js";
import { previewRecipe } from "../js/crafting.js";
import { researchInputView } from "../js/research/researchView.js";
import { grantOpeningKnowledge } from "./researchFixtures.mjs";

function fixture(options = {}) {
  const systems = buildGameSystems(options);
  const state = createInitialState(systems.content, systems.world, systems.people, systems.research);
  const store = id => systems.contextFor(state, id).store;
  return { ...systems, state, store };
}

function smallHabitatSource() {
  const source = structuredClone(locationDefinitions);
  source.types.habitat.storage.capacityM3 = 0.5;
  return source;
}

test("decimal volume parsing and display preserve every quantum through the safe range", () => {
  for (const [text, units] of [["0.000001", 1], ["0.0010000", 1000], [" 12.3400 ", 12340000], ["9007199254.740991", Number.MAX_SAFE_INTEGER]]) {
    assert.equal(parseQuantity(text, "scrap", content), units);
    assert.equal(parseQuantity(formatVolume(units).replace(" m³", ""), "scrap", content), units);
  }
  assert.equal(volumeUnits(1e-6), 1);
  assert.equal(parseQuantity(".000001", "scrap", content), 1);
  for (const text of ["", "-1", "NaN", "Infinity", "1e-6", "0,01", "0.0000001", "9007199254.740992", "1.2.3"])
    assert.throws(() => parseQuantity(text, "scrap", content));
  assert.throws(() => volumeUnits(0.1 + 0.2), /multiple/);
  assert.throws(() => parseQuantity("1.5", "iron", content), /whole/);
  assert.equal(parseQuantity("1.5", "power", content), 1.5);
  assert.throws(() => checkedAdd(Number.MAX_SAFE_INTEGER, 1), /overflow/);
  assert.throws(() => checkedMultiply(Number.MAX_SAFE_INTEGER, 2), /overflow/);
});

test("mixed physical items share capacity, power is excluded, exact fit succeeds", () => {
  const f = fixture({ locationSource: smallHabitatSource() }), store = f.store();
  transfer(store, {}, { scrap: 480000, iron: 4 }, content);
  assert.equal(storageSummary(store, content).usedVolumeUnits, 500000);
  assert.equal(maxReceivable(store, "iron", content), 0);
  const before = structuredClone(store.resources);
  assert.throws(() => transfer(store, {}, { scrap: 1 }, content), /capacity/);
  assert.deepEqual(store.resources, before);
  receiveUtilityClamped(store, { power: 100 }, content);
  assert.equal(store.resources.power, 40);
  assert.equal(storageSummary(store, content).usedVolumeUnits, 500000);
  assert.throws(() => receiveUtilityClamped(store, { power: 1, scrap: 1 }, content), /utility/);
  assert.throws(() => entryVolume("missing", 0, content), /Unknown/);
});

test("complete exchanges neither clip multi-rewards nor fund inputs with outputs", () => {
  const f = fixture({ locationSource: smallHabitatSource() }), store = f.store(); store.resources.scrap = 490000;
  const before = structuredClone(store.resources);
  for (const rewards of [{ iron: 2, scrap: 1 }, { scrap: 1, iron: 2 }]) {
    assert.throws(() => transfer(store, { power: 1 }, rewards, content), /capacity/);
    assert.deepEqual(store.resources, before);
  }
  assert.equal(previewExchange(store, { iron: 1 }, { iron: 2 }, content).code, "insufficientStock");
  assert.throws(() => transfer(store, { scrap: 10000 }, { power: 40 }, content), /power capacity/);
  assert.deepEqual(store.resources, before);
  transfer(store, { scrap: 40000 }, { iron: 1 }, content);
  assert.equal(storageSummary(store, content).usedVolumeUnits, 455000);
});

test("invalid arithmetic and quantity maps never mutate stores", () => {
  const f = fixture(), store = f.store(), before = structuredClone(store.resources);
  for (const rewards of [{ iron: 0.5 }, { scrap: NaN }, { scrap: -1 }, { missing: 0 }, { iron: Number.MAX_SAFE_INTEGER }, null]) {
    assert.throws(() => transfer(store, {}, rewards, content)); assert.deepEqual(store.resources, before);
  }
  transfer(store, { scrap: 0 }, {}, content);
  assert.deepEqual(store.resources, before);
});

test("overloaded saves allow shrinking and equal-volume exchanges but reject expansion", () => {
  const f = fixture({ locationSource: smallHabitatSource() }), store = f.store(); store.resources.scrap = 700000;
  validateState(f.state, content, f.world, f.people, f.research);
  assert.equal(storageSummary(store, content).overloadVolumeUnits, 200000);
  assert.equal(maxReceivable(store, "scrap", content), 0);
  transfer(store, { scrap: 5000 }, { iron: 1 }, content);
  assert.equal(storageSummary(store, content).usedVolumeUnits, 700000);
  assert.throws(() => transfer(store, {}, { scrap: 1 }, content), /capacity/);
  transfer(store, { scrap: 40000 }, { iron: 1 }, content);
  assert.equal(storageSummary(store, content).usedVolumeUnits, 665000);
});

test("receivable item counts floor, transfers conserve bulk units and reject aliases", () => {
  const f = fixture(), from = f.store(), to = f.store("supplyPlatform");
  from.resources.scrap = 10001; to.resources.scrap = 1994999;
  assert.equal(maxReceivable(to, "iron", content), 1);
  for (let i = 0; i < 100; i++) { moveExact(from, to, "scrap", 1, content); moveExact(to, from, "scrap", 1, content); }
  assert.equal(from.resources.scrap, 10001); assert.equal(to.resources.scrap, 1994999);
  assert.deepEqual(JSON.parse(JSON.stringify(f.state)), f.state);
  const before = structuredClone(f.state);
  assert.throws(() => moveExact(from, { ...from }, "scrap", 1, content), /different/);
  assert.throws(() => moveExact(from, to, "scrap", 5002, content), /receiving/);
  assert.deepEqual(f.state, before);
});

test("bulk roles round upward exactly and aggregate repeated slots", () => {
  const source = structuredClone(definitions);
  source.items.scrap.roles = { structureFeed: { unitsPerM3: 3 } };
  source.items.iron.recipes[0].inputs = [{ id: "a", role: "structureFeed", quantity: 1 }, { id: "b", role: "structureFeed", quantity: 1 }];
  const c = buildCatalog(source), f = fixture({ content: c }); grantOpeningKnowledge(f.state);
  const approval = c.items.scrap.roles.structureFeed;
  assert.equal(roleQuantity(1, approval, true), 333334);
  assert.ok(333334n * 3n >= 1000000n); assert.ok(333333n * 3n < 1000000n);
  f.store().resources.scrap = 666667;
  const preview = previewRecipe(f.contextFor(f.state).actionState, "iron:refine", {}, c);
  assert.equal(preview.cost.scrap, 666668); assert.match(preview.reason, /Requires/);
  f.store().resources.scrap++;
  assert.equal(previewRecipe(f.contextFor(f.state).actionState, "iron:refine", {}, c).reason, "");
  source.items.scrap.roles.structureFeed.units = 1;
  assert.throws(() => buildCatalog(source), /unitsPerM3/);
});

test("capacity metadata rejects obsolete fields and invalid fresh loads", () => {
  for (const mutate of [s => s.items.scrap.baseCapacity = 1, s => s.items.iron.unitVolumeM3 = 0,
    s => s.items.scrap.researchSampleM3 = 0, s => s.items.batteryBank.installation.capacityBonus = { scrap: 1 },
    s => s.items.batteryBank.installation.storageBonusM3 = -1]) {
    const s = structuredClone(definitions); mutate(s); assert.throws(() => buildCatalog(s));
  }
  for (const mutate of [s => s.locations.habitat.initialResources.scrap = 10000001,
    s => s.types.habitat.storage = { capacityM3: -1 },
    s => s.locations.vicinity.initialResources = { scrap: 0.01 }]) {
    const s = structuredClone(locationDefinitions); mutate(s); assert.throws(() => compileLocationCatalog(s, content));
  }
  const source = structuredClone(locationDefinitions); source.locations.habitat.storage = { capacityM3: 0 };
  const f = fixture({ locationSource: source }); f.store().resources.scrap = 1;
  validateState(f.state, content, f.world, f.people, f.research);
  transfer(f.store(), { scrap: 1 }, {}, content);
  assert.equal(f.store().resources.scrap, 0);
  f.state.locations.vicinity.resources.scrap = 1;
  assert.throws(() => validateState(f.state, content, f.world, f.people, f.research), /area cargo/);
});

test("installed expansion is passive, live, and checked together with product consumption", () => {
  const source = structuredClone(definitions);
  source.items.hold = { name: "Cargo module", category: "product", unitVolumeM3: 0.03,
    installation: { group: "holds", storageBonusM3: 0.2, limit: 2 } };
  const c = buildCatalog(source), f = fixture({ content: c }), store = f.store();
  store.resources.hold = 1; store.resources.scrap = 600000;
  assert.equal(storageSummary(store, c).capacityVolumeUnits, 10000000);
  const preview = previewInstallation(store, c.items.hold, c);
  assert.equal(preview.ok, true); assert.equal(preview.after.overloadVolumeUnits, 0);
  f.actions.find(a => a.id === "install:hold").execute(f.state, f.contextFor(f.state));
  Object.assign(store.infrastructure.holds, { enabled: false, health: 0 });
  assert.equal(store.resources.hold, 0); assert.equal(storageSummary(store, c).capacityVolumeUnits, 10200000);
  store.infrastructure.holds.quantity = 2;
  assert.match(previewInstallation(store, c.items.hold, c).reason, /limit/);
  store.infrastructure.holds.quantity = 0;
  store.resources.hold = 1;
  c.infrastructure.holds.storageBonusVolumeUnits = Number.MAX_SAFE_INTEGER;
  assert.match(previewInstallation(store, c.items.hold, c).reason, /overflow/);
});

test("research sample threshold and preview use exact bulk quantities", () => {
  const f = fixture(); f.state.locations.habitat.flags["examined:fitting"] = true;
  const payload = { methodId: "bench", items: ["scrap"] };
  f.store().resources.scrap = 9999;
  assert.match(researchInputView(f.state, f.research, payload).reason, /samples/);
  f.store().resources.scrap = 10000;
  const before = structuredClone(f.state), view = researchInputView(f.state, f.research, payload);
  assert.equal(view.cost.scrap, 10000); assert.equal(view.reason, ""); assert.deepEqual(f.state, before);
});

test("confirmed discard recovers unusable products and save failures roll back", () => {
  const f = fixture(); f.store().resources.radioAntenna = 100;
  f.store().infrastructure.installedAntenna.quantity = 1;
  let fail = false;
  const runtime = createGameRuntime({ ...f, initialState: f.state, save() { if (fail) throw new Error("Save failed"); } });
  const registry = createActionRegistry(); f.actions.forEach(registry.registerAction);
  registry.initialize({ getState: runtime.getState, getContext: f.contextFor, applyAction: execute => runtime.applyAction(execute).message });
  const payload = { locationId: "habitat", assetId: "radioAntenna", amount: 50, confirmed: true };
  for (const bad of [{ confirmed: false }, { locationId: "supplyPlatform" }, { assetId: "power" }, { assetId: "installedAntenna" }, { amount: 0.5 }, { amount: 101 }]) {
    assert.throws(() => registry.executeAction("discardCargo", { ...payload, ...bad }));
    assert.equal(runtime.getState().locations.habitat.resources.radioAntenna, 100);
  }
  fail = true; const before = runtime.getState();
  assert.throws(() => registry.executeAction("discardCargo", payload), /Save failed/); assert.equal(runtime.getState(), before);
  fail = false; registry.executeAction("discardCargo", payload);
  assert.equal(runtime.getState().locations.habitat.resources.radioAntenna, 50);
  assert.equal(storageSummary(f.contextFor(runtime.getState()).store, content).overloadVolumeUnits, 0);
  runtime.applyAction(s => { s.entities.habitat.ownerId = null; });
  assert.throws(() => registry.executeAction("discardCargo", payload), /ownership|available/);
});

test("new catalog items do not add capacity and endpoint policy precedes quantity diagnostics", () => {
  const source = structuredClone(definitions); source.items.extra = { name: "Extra", category: "component", unitVolumeM3: 0.005 };
  const f = fixture({ content: buildCatalog(source) });
  assert.equal(storageSummary(f.store(), f.content).capacityVolumeUnits, 10000000);
  f.state.entities.supplyPlatform.ownerId = null;
  assert.match(locationTransferReason(f.state, { sourceId: "habitat", destinationId: "supplyPlatform", assetId: "scrap", amount: 1 }, f.world, f.content), /ownership|permission/);
});

test("an isolated overloaded ship can travel and discard while ordinary transfers stay blocked", () => {
  const source = structuredClone(locationDefinitions);
  source.locations.courier = { name: "Courier", description: "Ship", remoteDescription: "Ship", type: "ship", areaId: "vicinity", initialOwnerId: "player",
    initialResources: { power: 20 }, initialInfrastructure: { engine: { quantity: 1 } } };
  const f = fixture({ locationSource: source }); f.state.locationId = "courier";
  f.store().resources.radioAntenna = 50;
  const runtime = createGameRuntime({ ...f, initialState: f.state, save() {} });
  const registry = createActionRegistry(); f.actions.forEach(registry.registerAction);
  registry.initialize({ getState: runtime.getState, getContext: f.contextFor, applyAction: execute => runtime.applyAction(execute).message });
  registry.executeAction("travel:outerReach");
  assert.ok(runtime.getState().locations.courier.journey);
  assert.throws(() => registry.executeAction("transferLocations", { sourceId: "courier", destinationId: "habitat", assetId: "radioAntenna", amount: 1 }), /journey/);
  registry.executeAction("discardCargo", { locationId: "courier", assetId: "radioAntenna", amount: 30, confirmed: true });
  const current = runtime.getState();
  assert.equal(current.locations.courier.resources.radioAntenna, 20);
  assert.equal(current.locations.courier.resources.power, 15);
  assert.equal(storageSummary(f.contextFor(current).store, content).overloadVolumeUnits, 0);
});
