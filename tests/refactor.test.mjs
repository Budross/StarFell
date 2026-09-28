import { legacyState, withoutLocalOwners } from "./legacyState.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGameSystems } from "../js/bootstrap.js";
import { createGameRuntime } from "../js/runtime.js";
import { createActionRegistry } from "../js/playerActions.js";
import { createInitialState, validateState, migrateState } from "../js/state.js";
import { locationDefinitions } from "../js/locationContent.js";
import { validateActionScopes, transferOptions, startupMessages } from "../js/locations.js";
import { capacity, transfer, moveExact } from "../js/resources.js";
import { researchInputView } from "../js/research/researchView.js";
import { grantOpeningKnowledge } from "./researchFixtures.mjs";
import { definitions } from "../js/content.js";
import { buildCatalog } from "../js/itemCatalog.js";
import { researchDefinitions } from "../js/research/researchContent.js";
import { dialogueDefinitions } from "../js/dialogueContent.js";

function session(options = {}, prepare = () => {}) {
  const systems = buildGameSystems(options);
  const { content, world, people, research } = systems;
  const initialState = systems.stateServices.createInitialState(12345);
  prepare(initialState);
  let failSave = false;
  const writes = [];
  let runtime;
  runtime = createGameRuntime({ ...systems, initialState, save(candidate) {
    assert.notEqual(runtime.getState(), candidate, "save precedes candidate replacement");
    if (failSave) throw new Error("Save failed");
    writes.push(structuredClone(candidate));
  } });
  const registry = createActionRegistry();
  systems.actions.forEach(registry.registerAction);
  registry.initialize({ getState: runtime.getState, getContext: systems.contextFor,
    validateActions: actions => validateActionScopes(actions, world),
    applyAction: execute => runtime.applyAction(execute).message });
  return { ...systems, runtime, registry, writes, setFailSave: value => { failSave = value; } };
}

test("production runtime saves before commit and rolls back failed execution and validation", () => {
  const s = session();
  const before = s.runtime.getState();
  assert.equal(s.registry.executeAction("salvage"), "Recovered 0.01 m³ metal scrap.");
  assert.equal(before.locations.habitat.resources.scrap, 0);
  assert.equal(s.runtime.getState().locations.habitat.resources.scrap, 10000);
  assert.deepEqual(s.writes.at(-1), s.runtime.getState());
  const committed = s.runtime.getState();
  assert.throws(() => s.runtime.applyAction(candidate => {
    candidate.flags.partial = true;
    throw new Error("Stopped");
  }), /Stopped/);
  assert.throws(() => s.runtime.applyAction(candidate => {
    candidate.locations.habitat.resources.scrap = -1;
  }), /quantity/);
  assert.equal(s.runtime.getState(), committed);
  assert.equal(s.writes.length, 1);
});

test("production action save failure rolls back research costs, evidence, journal and RNG", () => {
  const s = session();
  s.registry.executeAction("inspect:habitat:fitting");
  s.registry.executeAction("salvage");
  const before = structuredClone(s.runtime.getState());
  s.setFailSave(true);
  assert.throws(() => s.registry.executeAction("research:experiment", { methodId: "bench", items: ["scrap"] }), /Save failed/);
  assert.deepEqual(s.runtime.getState(), before);
  s.setFailSave(false);
  assert.match(s.registry.executeAction("research:experiment", { methodId: "bench", items: ["scrap"] }), /Discovered: Structural fabrication/);
  assert.equal(s.runtime.getState().research.attemptCount, 1);
  assert.notEqual(s.runtime.getState().research.rng, before.research.rng);
});

test("frame cadence, save failure pause and successful-action recovery use the production runtime", () => {
  const s = session();
  s.runtime.advance(2);
  s.runtime.advance(2);
  assert.equal(s.writes.length, 0);
  const before = s.runtime.getState();
  s.setFailSave(true);
  assert.throws(() => s.runtime.advance(1), /Save failed/);
  assert.equal(s.runtime.getState(), before);
  assert.equal(s.runtime.isPaused(), true);
  assert.equal(s.runtime.advance(10), null);
  assert.throws(() => s.registry.executeAction("salvage"), /Save failed/);
  assert.equal(s.runtime.isPaused(), true);
  s.setFailSave(false);
  s.registry.executeAction("salvage");
  assert.equal(s.runtime.isPaused(), false);
  s.runtime.advance(4);
  assert.equal(s.writes.length, 1, "action restarts the five-second save interval");
  s.runtime.advance(1);
  assert.equal(s.writes.length, 2);
  assert.equal(s.runtime.getState().simulationTime, 9);
});

test("an arrival saves immediately and a failed arrival retains the journey", () => {
  const source = structuredClone(locationDefinitions);
  source.locations.courier = { name: "Courier", type: "ship", areaId: "vicinity", initialDockedAtId: "habitat",
    initialOwnerId: "player", description: "Test courier.", remoteDescription: "Test courier.", localTravelDistance: 20,
    initialResources: { power: 30 }, initialInfrastructure: { engine: { quantity: 1 } } };
  const s = session({ locationSource: source });
  s.registry.executeAction("board:courier");
  s.registry.executeAction("undock");
  s.registry.executeAction("dock:supplyPlatform");
  const saves = s.writes.length;
  assert.deepEqual(s.runtime.advance(1).arrivals, []);
  assert.equal(s.writes.length, saves);
  const before = s.runtime.getState();
  s.setFailSave(true);
  assert.throws(() => s.runtime.advance(1), /Save failed/);
  assert.equal(s.runtime.getState(), before);
  assert.equal(before.locations.courier.journey.remaining, 1);
  s.setFailSave(false);
  s.runtime.applyAction(() => {});
  const commit = s.runtime.advance(1);
  assert.equal(commit.arrivals.length, 1);
  assert.equal(commit.state.locations.courier.dockedAtId, "supplyPlatform");
  assert.equal(commit.state.locations.courier.journey, null);
  assert.deepEqual(s.writes.at(-1), commit.state);
});

test("contact reconciliation is part of the saved action, before its result is returned", () => {
  const s = session();
  s.registry.executeAction("dialogue:start", { npcId: "oren" });
  const before = s.runtime.getState();
  const move = candidate => { candidate.locationId = "supplyPlatform"; return "Moved."; };
  s.setFailSave(true);
  assert.throws(() => s.runtime.applyAction(move), /Save failed/);
  assert.equal(s.runtime.getState(), before);
  assert.ok(before.dialogue.active);
  s.setFailSave(false);
  const commit = s.runtime.applyAction(move);
  assert.equal(commit.message, "Moved. Conversation with Oren ended; local contact was lost.");
  assert.equal(commit.state.dialogue.active, null);
  assert.equal(s.writes.at(-1).dialogue.active, null);
});

test("new action families use normal location collections and retain collision checks", () => {
  const source = structuredClone(locationDefinitions);
  source.locations.habitat.actionSets = ["survey"];
  const options = { locationSource: source, createAdditionalActions: () => [{
    id: "surveyHull", name: "Survey hull", collection: "survey", access: "public",
    execute(state, context) { state.locations[context.id].flags.surveyed = true; return "Surveyed."; }
  }] };
  const s = session(options);
  assert.equal(s.registry.executeAction("surveyHull"), "Surveyed.");
  assert.equal(s.runtime.getState().locations.habitat.flags.surveyed, true);
  assert.equal(s.world.definitions.supplyPlatform.actions.includes("surveyHull"), false);
  assert.throws(() => buildGameSystems({ ...options, createAdditionalActions: () => [{
    id: "surveyHull", name: "Survey hull", aliases: ["salvage"], collection: "survey", execute() {}
  }] }), /conflicting command/);
});

test("independent registries execute against their own current state", () => {
  const a = session(), b = session();
  a.registry.executeAction("salvage");
  a.registry.executeAction("salvage");
  b.registry.executeAction("salvage");
  assert.equal(a.runtime.getState().locations.habitat.resources.scrap, 20000);
  assert.equal(b.runtime.getState().locations.habitat.resources.scrap, 10000);
  a.registry.registerAction({ id: "onlyA", name: "Only A", scope: "global", execute() {} });
  assert.equal(b.registry.resolveAction("onlyA"), null);
});

test("explicit stores keep selection replacement at root and equipment capacity live", () => {
  const s = session({}, state => {
    grantOpeningKnowledge(state);
    state.locations.habitat.resources.batteryBank = 1;
  });
  const context = s.contextFor(s.runtime.getState());
  assert.equal(Object.hasOwn(context.store, "crafting"), false);
  assert.equal(Object.hasOwn(context.store, "locations"), false);
  s.registry.executeAction("selectRecipe:iron:refine");
  assert.equal(s.runtime.getState().crafting.recipeId, "iron:refine");
  s.runtime.applyAction(candidate => {
    const ctx = s.contextFor(candidate);
    assert.equal(capacity(ctx.store, "power", s.content), 40);
    s.actions.find(a => a.id === "install:batteryBank").execute(candidate, ctx);
    assert.equal(capacity(ctx.store, "power", s.content), 50);
  });
  assert.equal(s.runtime.getState().locations.supplyPlatform.infrastructure.installedBatteryBanks.quantity, 0);
});

test("shared exchange and cross-store operations reject without partial arithmetic", () => {
  const s = session({}, grantOpeningKnowledge);
  const state = s.runtime.getState();
  const source = s.contextFor(state).store, destination = s.contextFor(state, "supplyPlatform").store;
  source.resources.scrap = 10000000;
  source.resources.iron = 30;
  const before = structuredClone(state);
  assert.throws(() => transfer(source, {}, { solarPanel: 400 }, s.content), /Make room/);
  assert.deepEqual(state, before);
  destination.resources.scrap = 2000000;
  assert.throws(() => moveExact(source, destination, "scrap", 1, s.content), /receiving capacity/);
  assert.equal(source.resources.scrap, 10000000);
});

test("research presentation inputs are detached from the clock and hide private stocks", () => {
  const s = session();
  const state = s.runtime.getState(), payload = { methodId: "bench", items: [] };
  const before = structuredClone(state);
  const first = researchInputView(state, s.research, payload);
  assert.deepEqual(state, before, "view construction is read-only");
  state.simulationTime = 5;
  assert.deepEqual(researchInputView(state, s.research, payload), first);
  state.entities.habitat.ownerId = null;
  state.locations.habitat.resources.scrap = 200000;
  const privateView = researchInputView(state, s.research, payload);
  assert.equal(privateView.owned, false);
  assert.ok(privateView.samples.every(sample => sample.amount === 0 && sample.hidden && sample.disabled));
  assert.deepEqual(transferOptions(state, s.world, s.content).endpoints, []);
});

test("refactored composition preserves version-six round trips and old-save migration", () => {
  const s = session();
  s.registry.executeAction("salvage");
  const saved = structuredClone(s.runtime.getState());
  assert.deepEqual(migrateState(saved, s.content, s.world, s.people, [], s.research), saved);
  const old = legacyState(saved, 5);
  old.locations.habitat.resources.scrap = 1;
  old.npcs.mira.inventory.scrap = 4;
  delete old.research;
  const migrated = migrateState(old, s.content, s.world, s.people, [], s.research);
  assert.equal(migrated.saveVersion, 9);
  assert.equal(migrated.locations.habitat.resources.scrap, saved.locations.habitat.resources.scrap);
  assert.equal(migrated.knowledge.discoveries.structuralFabrication, true);
  validateState(migrated, s.content, s.world, s.people, s.research);
});

test("discovery references retain external IDs without treating requirements as grant routes", () => {
  const items = structuredClone(definitions);
  items.items.iron.recipes[0].conditions.discoveries = ["cycleA", "externalFact"];
  const researchSource = structuredClone(researchDefinitions);
  researchSource.discoveries.cycleA = { name: "Cycle A", description: "A test cycle.", families: ["materials"], threshold: 1,
    eligibility: { discoveries: ["cycleB"] }, evidence: [{ id: "a", samples: { allTags: ["metal"] }, insight: 1, observation: "A." }] };
  researchSource.discoveries.cycleB = { ...structuredClone(researchSource.discoveries.cycleA), name: "Cycle B", eligibility: { discoveries: ["cycleA"] } };
  const dialogueSource = structuredClone(dialogueDefinitions);
  dialogueSource.conversations.miraRequest.nodes.offer.choices[0].effects.push({ type: "discover", id: "externalGrant" });
  const s = session({ content: buildCatalog(items), researchSource, dialogueSource });
  assert.ok(s.content.discoveryReferences.required.includes("externalFact"));
  assert.ok(s.people.discoveryReferences.granted.includes("externalGrant"));
  assert.ok(s.research.catalog.warnings.some(w => w.startsWith("cycleA:")));
  assert.ok(s.research.catalog.warnings.some(w => w.startsWith("cycleB:")));
  s.runtime.applyAction(candidate => { candidate.knowledge.discoveries.externalFact = true; });
  assert.equal(s.runtime.getState().knowledge.discoveries.externalFact, true);
});

test("authored startup notices preserve fresh, knowledgeable, repaired and remote openings", () => {
  const s = session();
  const state = s.runtime.getState();
  assert.deepEqual(startupMessages(state, s.world, s.content), [
    "Solar array degraded. Inspect the damaged structural fitting, salvage metal, and open Research to learn how to fabricate replacement parts. Basic experiments need no power."
  ]);
  state.knowledge.discoveries.structuralFabrication = true;
  assert.deepEqual(startupMessages(state, s.world, s.content), [
    "Solar array degraded. Salvage metal and fabricate structural parts to repair it."
  ]);
  state.locations.habitat.infrastructure.solar.health = 1;
  assert.deepEqual(startupMessages(state, s.world, s.content), []);
  state.locations.habitat.infrastructure.solar.health = 0.2;
  state.locationId = "supplyPlatform";
  assert.deepEqual(startupMessages(state, s.world, s.content), []);
});
