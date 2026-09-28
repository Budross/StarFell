import { legacyState, withoutLocalOwners } from "./legacyState.mjs";
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { content, definitions } from "../js/content.js";
import { buildCatalog } from "../js/itemCatalog.js";
import { locationDefinitions } from "../js/locationContent.js";
import { buildLocationCatalog, createLocationActions, validateActionScopes, getLocationContext, locationTransferReason, movePlayer } from "../js/locations.js";
import { createItemActions } from "../js/itemActions.js";
import { createInitialState, migrateState, validateState } from "../js/state.js";
import { createShipActions, navigationReason, navigate, shipSpeed, journeyQuote, advanceJourneys, shipGraphView } from "../js/ships.js";
import { advanceGame } from "../js/game.js";
import initialize, { registerAction, executeAction, resolveAction } from "../js/playerActions.js";

const source = structuredClone(locationDefinitions);
source.locations.courier = { name: "Test courier", type: "ship", areaId: "vicinity", initialDockedAtId: "habitat",
  initialOwnerId: "player", description: "A cargo hold and flight console.", remoteDescription: "A courier.",
  initialResources: { power: 30, scrap: 0.07 }, initialInfrastructure: { engine: { quantity: 1 }, solar: { quantity: 1 } },
  actions: ["inspectSite"] };
source.locations.passenger = { ...structuredClone(source.locations.courier), name: "Passenger ship", initialOwnerId: null };
source.locations.hidden = { name: "Hidden area", type: "area", position: [150, 0], conditions: { flags: ["revealed"] }, description: "Hidden.", remoteDescription: "Hidden." };
source.locations.far = { name: "Far area", type: "area", position: [999, 999], description: "Far.", remoteDescription: "Far." };
source.locations.locked = { ...structuredClone(source.locations.supplyPlatform), name: "Locked platform", accessConditions: { flags: ["permitted"] } };
const items = createItemActions(content), world = buildLocationCatalog(source, content, items);
const actions = [...items, ...createLocationActions(world, content), ...createShipActions(world, content)];
validateActionScopes(actions, world); actions.forEach(registerAction);
let state, saved, failSave;
const context = (s, id) => getLocationContext(s, content, world, id);
function commit(candidate) {
  validateState(candidate, content, world);
  if (failSave) throw new Error("Save failed");
  saved = structuredClone(candidate); state = candidate;
}
initialize({ getState: () => state, getContext: context, validateActions: batch => validateActionScopes(batch, world),
  applyAction(execute) { const candidate = structuredClone(state); const result = execute(candidate); commit(candidate); return result; } });
beforeEach(() => { state = createInitialState(content, world); saved = structuredClone(state); failSave = false; });
function tick(seconds) {
  const candidate = structuredClone(state);
  advanceGame(candidate, seconds, content, context);
  const arrivals = advanceJourneys(candidate, seconds, world);
  commit(candidate); return arrivals;
}
function finish() { return tick(state.locations[state.locationId].journey.remaining); }
function depart(id = "courier") { executeAction(`board:${id}`); executeAction("undock"); }

test("fresh production games add no ship; static sites cannot travel even with engines", () => {
  assert.equal(Object.values(createInitialState().locations).some(local => "dockedAtId" in local), false);
  for (const id of ["habitat", "supplyPlatform", "vicinity", "outerReach"]) assert.throws(() => movePlayer(state, id, world, content), /Board a ship/);
  state.locations.habitat.infrastructure.engine.quantity = 1;
  assert.throws(() => executeAction("travel:outerReach"), /Board a ship/);
  assert.equal(resolveAction("travel:supplyPlatform"), null);
  assert.throws(() => executeAction("dock:supplyPlatform"), /Board a ship/);
});

test("boarding requires exact docking site, discovery and access, but not ownership", () => {
  state.locations.courier.dockedAtId = "supplyPlatform";
  assert.throws(() => executeAction("board:courier"), /docked at your/);
  executeAction("board:passenger");
  assert.equal(state.locationId, "passenger");
  assert.throws(() => executeAction("board:courier"), /Disembark/);
  executeAction("disembark:habitat");
  const restricted = structuredClone(world);
  restricted.definitions.passenger.accessConditions = { flags: ["ticket"] };
  assert.match(navigationReason(state, "board", "passenger", restricted, content), /investigation/);
  state.flags.ticket = true;
  assert.equal(navigationReason(state, "board", "passenger", restricted, content), "");
  restricted.definitions.passenger.conditions = { flags: ["unknown"] };
  assert.match(navigationReason(state, "board", "passenger", restricted, content), /not yet known/);
});

test("passenger navigation spends only ship power and grants no management access", () => {
  const habitatPower = state.locations.habitat.resources.power;
  depart("passenger"); executeAction("travel:outerReach");
  assert.equal(state.locations.passenger.resources.power, 25);
  assert.equal(state.locations.habitat.resources.power, habitatPower);
  assert.throws(() => executeAction("install:solarPanel"), /ownership|not available/);
  state.knowledge.discoveries.structuralFabrication = true;
  executeAction("selectRecipe:iron:refine");
  assert.throws(() => executeAction("craftSelected"), /ownership/);
  finish(); executeAction("dock:derelict"); finish(); executeAction("disembark:derelict");
  executeAction("board:passenger");
  assert.equal(state.locationId, "passenger");
});

test("same-area journey preserves ship assets and location ID until disembarking", () => {
  depart();
  const before = structuredClone(state.locations.courier);
  executeAction("dock:supplyPlatform");
  assert.equal(state.locationId, "courier");
  assert.equal(state.locations.courier.dockedAtId, null);
  assert.equal(state.locations.courier.resources.power, before.resources.power - 1);
  assert.equal(state.locations.courier.journey.duration, 1);
  assert.throws(() => executeAction("disembark:supplyPlatform"), /journey/);
  assert.throws(() => executeAction("dock:supplyPlatform"), /journey/);
  tick(0.4);
  assert.equal(state.locations.courier.journey.remaining, 0.6);
  const arrivals = finish();
  assert.equal(arrivals.length, 1);
  assert.equal(state.locations.courier.dockedAtId, "supplyPlatform");
  assert.deepEqual(state.locations.courier.infrastructure, before.infrastructure);
  assert.equal(state.locations.courier.resources.scrap, before.resources.scrap);
  executeAction("disembark:supplyPlatform");
  assert.equal(state.locationId, "supplyPlatform");
  assert.equal(state.locations.courier.areaId, "vicinity");
});

test("round trip uses one area edge at a time and only changes position on arrival", () => {
  depart(); executeAction("travel:outerReach");
  const duration = Math.hypot(90, 45) / 10;
  assert.equal(state.locations.courier.journey.duration, duration);
  tick(duration / 2);
  assert.equal(state.locations.courier.areaId, "vicinity");
  assert.throws(() => executeAction("undock"), /journey/);
  finish();
  assert.equal(state.locations.courier.areaId, "outerReach");
  assert.equal(state.locationId, "courier");
  executeAction("dock:derelict"); finish(); executeAction("disembark:derelict");
  executeAction("board:courier"); executeAction("undock");
  executeAction("travel:vicinity"); finish(); executeAction("dock:habitat"); finish(); executeAction("disembark:habitat");
  assert.equal(state.locationId, "habitat");
  assert.equal(tick(100).length, 0, "Completed arrivals cannot run twice");
});

test("route checks block locked, unknown, nonadjacent, mobile and wrong-area targets", () => {
  depart();
  for (const [op, id, reason] of [["travel", "vicinity", /already/], ["travel", "hidden", /known/],
    ["travel", "far", /range/], ["dock", "derelict", /area first/], ["dock", "locked", /investigation/], ["dock", "passenger", /stationary/]]) {
    const before = structuredClone(state);
    assert.throws(() => navigate(state, op, id, world, content), reason);
    assert.deepEqual(state, before);
  }
  state.flags.permitted = true;
  executeAction("dock:locked"); finish(); state.flags.permitted = false;
  assert.throws(() => executeAction("disembark:locked"), /investigation/);
});

test("engines and exact power are rechecked and movement failures never debit", () => {
  depart();
  for (const patch of [{ quantity: 0 }, { health: 0 }, { enabled: false }]) {
    const engine = state.locations.courier.infrastructure.engine;
    const before = structuredClone(engine); Object.assign(engine, patch);
    assert.throws(() => executeAction("travel:outerReach"), /propulsion/);
    assert.equal(state.locations.courier.resources.power, 30);
    Object.assign(engine, before);
  }
  state.locations.courier.resources.power = 4.99;
  assert.throws(() => executeAction("travel:outerReach"), /Insufficient/);
  state.locations.courier.resources.power = 5;
  executeAction("travel:outerReach");
  assert.equal(state.locations.courier.resources.power, 0);
});

test("engine condition, quantities, ship speed and equipment upgrades change future durations", () => {
  depart(); const engine = state.locations.courier.infrastructure.engine;
  engine.health = 0.5; assert.equal(shipSpeed(state, "courier", world, content), 5);
  engine.quantity = 2; assert.equal(shipSpeed(state, "courier", world, content), 10);
  const faster = structuredClone(world); faster.definitions.courier.travelSpeed = 2;
  assert.equal(journeyQuote(state, "outerReach", faster, content).duration, journeyQuote(state, "outerReach", world, content).duration / 2);
  const equipment = structuredClone(definitions);
  equipment.items.drive = { name: "Drive", category: "product", unitVolumeM3: 0.005,
    installation: { group: "drive", capabilities: ["propulsion"], travelSpeed: 5 },
    upgrades: [{ id: "boost", name: "Boost", powerBonus: 0, travelSpeedBonus: 5, cost: {} }] };
  const catalog = buildCatalog(equipment);
  const w = buildLocationCatalog(source, catalog, createItemActions(catalog)), s = createInitialState(catalog, w);
  s.locations.courier.infrastructure.drive.quantity = 1;
  assert.equal(shipSpeed(s, "courier", w, catalog), 15);
  s.locations.courier.infrastructure.drive.upgrades.push("boost");
  assert.equal(shipSpeed(s, "courier", w, catalog), 20);
});

test("departure, boarding and arrival save failures roll back every affected field", () => {
  let before = structuredClone(state); failSave = true;
  assert.throws(() => executeAction("board:courier"), /Save failed/); assert.deepEqual(state, before);
  failSave = false; depart(); before = structuredClone(state); failSave = true;
  assert.throws(() => executeAction("travel:outerReach"), /Save failed/); assert.deepEqual(state, before);
  failSave = false; executeAction("travel:outerReach"); before = structuredClone(state); failSave = true;
  assert.throws(() => finish(), /Save failed/); assert.deepEqual(state, before); assert.deepEqual(saved, before);
  failSave = false; assert.equal(finish().length, 1);
});

test("active journeys save remaining visible time and resume without offline progress", () => {
  depart(); executeAction("travel:outerReach"); tick(2);
  const remaining = state.locations.courier.journey.remaining;
  const reloaded = migrateState(JSON.parse(JSON.stringify(saved)), content, world);
  assert.equal(reloaded.locations.courier.journey.remaining, remaining);
  assert.deepEqual(advanceJourneys(reloaded, 0, world), []);
  assert.deepEqual(advanceJourneys(reloaded, NaN, world), []);
  // Changing propulsion after departure does not rewrite the agreed duration.
  state.locations.courier.infrastructure.engine.enabled = false;
  assert.equal(finish().length, 1);
});

test("transfers block in transit and recheck changed areas on arrival", () => {
  depart();
  const payload = { sourceId: "courier", destinationId: "habitat", assetId: "scrap", amount: 1 };
  assert.equal(locationTransferReason(state, payload, world, content), "");
  executeAction("travel:outerReach");
  assert.match(locationTransferReason(state, payload, world, content), /journey/);
  finish(); assert.match(locationTransferReason(state, payload, world, content), /same area/);
});

test("map browsing is read-only, docking links are real, and ship follows saved position", () => {
  const before = structuredClone(state);
  const graph = shipGraphView(state, world, content, "vicinity");
  assert.ok(graph.links.some(([a,b]) => a === "courier" && b === "habitat"));
  assert.ok(!graph.links.some(([a,b]) => a === "habitat" && b === "supplyPlatform"));
  assert.equal(graph.nodes.find(n => n.id === "courier").actionId, "board:courier");
  assert.deepEqual(state, before);
  depart(); executeAction("travel:outerReach");
  assert.match(shipGraphView(state, world, content, "vicinity").nodes.find(n => n.id === "courier").description, /En route/);
  finish();
  assert.ok(!shipGraphView(state, world, content, "vicinity").nodes.some(n => n.id === "courier"));
  assert.ok(shipGraphView(state, world, content, "outerReach").nodes.some(n => n.id === "courier"));
});

test("version-three area and ship saves migrate once without grants or replenishment", () => {
  const legacy = legacyState(state, 3); legacy.locationId = "outerReach";
  for (const id of ["courier", "passenger"]) legacy.locations[id].resources.scrap = 7;
  for (const id of ["courier", "passenger"]) { delete legacy.locations[id].dockedAtId; delete legacy.locations[id].journey; }
  const migrated = migrateState(legacy, content, world);
  assert.equal(migrated.saveVersion, 9); assert.equal(migrated.locationId, "derelict");
  assert.equal(migrated.locations.courier.dockedAtId, null);
  assert.equal(legacy.locationId, "outerReach");
  assert.deepEqual(migrateState(migrated, content, world), migrated);
  legacy.locationId = "courier"; legacy.locations.courier.areaId = "outerReach";
  legacy.locations.courier.resources.power = 0;
  const aboard = migrateState(legacy, content, world);
  assert.equal(aboard.locationId, "courier"); assert.equal(aboard.locations.courier.areaId, "outerReach");
  assert.equal(aboard.locations.courier.resources.power, 0);
  legacy.locationId = "far";
  assert.throws(() => migrateState(legacy, content, world), /No accessible site migration/);
});

test("invalid docking, journeys, area occupancy and unsupported ship metadata fail clearly", () => {
  for (const change of [s => { delete s.locations.courier.dockedAtId; }, s => { delete s.locations.courier.journey; },
    s => { s.locations.courier.dockedAtId = "derelict"; }, s => { s.locations.courier.dockedAtId = "passenger"; },
    s => { s.locationId = "vicinity"; }, s => { s.locations.habitat.journey = null; }]) {
    const s = structuredClone(state); change(s); assert.throws(() => migrateState(s, content, world), /Invalid/);
  }
  depart(); executeAction("travel:outerReach");
  for (const change of [s => { s.locations.courier.journey.remaining = -1; }, s => { s.locations.courier.journey.duration = Infinity; },
    s => { s.locations.courier.journey.targetId = "far"; }, s => { s.locations.courier.journey.originAreaId = "outerReach"; },
    s => { s.locations.courier.journey.targetId = "missing"; }]) {
    const s = structuredClone(state); change(s); assert.throws(() => validateState(s, content, world), /Invalid/);
  }
  for (const [key, value] of [["initialDockedAtId", "passenger"], ["propulsionCapability", "missing"], ["travelSpeed", 0], ["localTravelDistance", NaN], ["areaTravelPowerCost", -1], ["boardingCost", { scrap: 1 }]]) {
    const authored = structuredClone(source); authored.locations.courier[key] = value;
    assert.throws(() => buildLocationCatalog(authored, content, items), /courier/);
  }
});

test("one content entry adds a different ship to an existing save without resetting others", () => {
  const authored = structuredClone(source);
  authored.locations.workship = { ...structuredClone(authored.locations.courier), name: "Work ship", storage: { capacityM3: 2 },
    localTravelPowerCost: 0, initialInfrastructure: { engine: { quantity: 2 }, fabricator: { quantity: 1 } },
    sceneObjects: [{ id: "bench", name: "Workbench", description: "A workbench." }] };
  const updated = buildLocationCatalog(authored, content, items);
  state.locations.courier.resources.scrap = 20000;
  const s = migrateState(state, content, updated);
  assert.equal(s.locations.courier.resources.scrap, 20000);
  assert.equal(getLocationContext(s, content, updated, "workship").store.capacityVolumeUnits, 2000000);
  assert.equal(s.locations.workship.infrastructure.fabricator.quantity, 1);
  assert.equal(createShipActions(updated, content).find(a => a.id === "board").targets(s).some(a => a.id === "board:workship"), true);
  assert.equal(createLocationActions(updated, content).find(a => a.id === "inspectScene").targets(s, getLocationContext(s, content, updated, "workship")).some(a => a.id === "inspect:workship:bench"), true);
  navigate(s, "board", "workship", updated, content); navigate(s, "undock", null, updated, content);
  assert.equal(journeyQuote(s, "supplyPlatform", updated, content).duration, 0.5);
  navigate(s, "dock", "supplyPlatform", updated, content);
  assert.equal(s.locations.workship.resources.power, 30);
  assert.notEqual(s.locations.workship.infrastructure.engine, s.locations.courier.infrastructure.engine);
});
