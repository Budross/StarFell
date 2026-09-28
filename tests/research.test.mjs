import { createActionRegistry } from "../js/playerActions.js";
import { legacyState, withoutLocalOwners } from "./legacyState.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { content, definitions } from "../js/content.js";
import { buildCatalog } from "../js/itemCatalog.js";
import { createInitialState, validateState, migrateState, defaultWorld } from "../js/state.js";
import { peopleFor } from "../js/peopleSystem.js";
import { buildLocationCatalog, getLocationContext, createLocationActions } from "../js/locations.js";
import { locationDefinitions } from "../js/locationContent.js";
import { createItemActions } from "../js/itemActions.js";
import { craft, previewRecipe } from "../js/crafting.js";
import { grantDiscovery } from "../js/knowledge.js";
import { advanceGame } from "../js/game.js";
import { researchDefinitions } from "../js/research/researchContent.js";
import { buildResearchSystem } from "../js/research/researchSystem.js";
import { buildResearchContext } from "../js/research/researchContext.js";
import { buildResearchProfile, matchesSamples } from "../js/research/researchProfile.js";
import { resolveExperiment } from "../js/research/researchEngine.js";
import { previewExperiment, executeExperiment } from "../js/research/researchActions.js";
import { storageSummary } from "../js/storage.js";
import { effectServicesFor as createEffectServices } from "./worldLedgerFixtures.mjs";

const people = peopleFor(content, defaultWorld);
function fixture(source = structuredClone(researchDefinitions), items = content, world = defaultWorld) {
  const npcs = peopleFor(items, world);
  const system = buildResearchSystem(items, world, npcs, source);
  let state = createInitialState(items, world, npcs, system), failSave = false, peakCargo = 0;
  const transact = fn => {
    const draft = structuredClone(state); const message = fn(draft);
    validateState(draft, items, world, npcs, system);
    if (failSave) throw new Error("Save failed");
    state = draft;
    peakCargo = Math.max(peakCargo, storageSummary(getLocationContext(state, items, world).store, items).usedVolumeUnits);
    return message;
  };
  return { get state() { return state; }, get peakCargo() { return peakCargo; }, system, transact, setFail: value => { failSave = value; },
    stock(values) { Object.assign(state.locations[state.locationId].resources, Object.fromEntries(Object.entries(values).map(([id, n]) =>
      [id, n * ({ scrap: 10000, electronicSalvage: 5000, siliconMinerals: 10000 }[id] ?? 1)]))); },
    run(...items) { return transact(s => executeExperiment(s, system, { methodId: "bench", items })); },
    action(id) { return transact(s => {
      const registry = createActionRegistry();
      [...createItemActions(items, createEffectServices({ content: items, world, people: npcs })), ...createLocationActions(world, items)].forEach(registry.registerAction);
      registry.initialize({ getState: () => s, getContext: candidate => getLocationContext(candidate, items, world), applyAction: execute => execute(s) });
      return registry.executeAction(id);
    }); },
    craft(id) { return transact(s => craft(getLocationContext(s, items, world).actionState, id, {}, items)); }
  };
}
function noLuck() { const source = structuredClone(researchDefinitions); source.bonusChance = 0; return source; }
function singleSource() {
  const source = noLuck(); source.hints = [];
  source.discoveries = { testKnowledge: { name: "Test knowledge", description: "A test-only discovery.", families: ["materials"], threshold: 100,
    evidence: [{ id: "metal", samples: { allTags: ["metal"] }, insight: 10, observation: "A useful observation." }] } };
  return source;
}
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

test("catalog rejects malformed mechanics, predicates, tags, references and duplicate variants", () => {
  const invalid = mutate => { const source = noLuck(); mutate(source); assert.throws(() => buildResearchSystem(content, defaultWorld, people, source), /Invalid/); };
  invalid(s => { s.discoveries.structuralFabrication.threshold = -1; });
  invalid(s => { s.discoveries.structuralFabrication.researchUnlocks = ["iron"]; });
  invalid(s => { s.methods.bench.conditions = { capabilities: ["unknown"] }; });
  invalid(s => { s.methods.bench.cost = { scrap: 1 }; });
  invalid(s => { s.discoveries.structuralFabrication.eligibility = { discoveries: ["missing"] }; });
  invalid(s => { s.discoveries.structuralFabrication.eligibility = { npcFlags: { speaker: ["heard"] } }; });
  invalid(s => { s.discoveries.structuralFabrication.eligibility = { anyFlags: ["heard"] }; });
  invalid(s => { s.discoveries.structuralFabrication.evidence[0].samples = { allTags: ["typo"] }; });
  invalid(s => { s.discoveries.structuralFabrication.evidence[0].insight = Infinity; });
  invalid(s => { s.discoveries.structuralFabrication.evidence[0].once = "yes"; });
  invalid(s => { s.discoveries.circuitAssembly.evidence[0].variants[1].priority = 0; });
  invalid(s => { s.discoveries.structuralFabrication.evidence.push(s.discoveries.structuralFabrication.evidence[0]); });
  invalid(s => { s.repetition = [100, -10]; });
  invalid(s => { s.bonusChance = NaN; });
  const source = singleSource(); source.discoveries.testKnowledge.eligibility = { discoveries: ["testKnowledge"] };
  assert.match(buildResearchSystem(content, defaultWorld, people, source).catalog.warnings.join(" "), /entry route/);
});

test("resolver is pure, seeded and always gives bounded positive progress", () => {
  const f = fixture(singleSource());
  const ctx = buildResearchContext(f.state, f.system, "bench", ["scrap"]);
  const before = structuredClone([ctx, f.state.research]);
  freeze(ctx); freeze(f.state.research); freeze(f.system.catalog);
  const result = resolveExperiment(f.system.catalog, ctx, f.state.research);
  assert.deepEqual(result, resolveExperiment(f.system.catalog, ctx, f.state.research));
  assert.deepEqual([ctx, f.state.research], before);
  assert.equal(result.insight.testKnowledge, 1000);
  const randomSource = singleSource(); randomSource.bonusChance = 0.5;
  const random = fixture(randomSource), outcomes = new Set();
  for (let seed = 0; seed < 100; seed++) {
    const r = resolveExperiment(random.system.catalog, ctx, { ...random.state.research, rng: seed });
    assert.ok(r.insight.testKnowledge >= 1000 && r.insight.testKnowledge <= 1250);
    outcomes.add(r.insight.testKnowledge);
  }
  assert.equal(outcomes.size, 2);
});

test("catalog insertion order cannot change outcomes and context is detached from game state", () => {
  const a = fixture(), source = structuredClone(researchDefinitions);
  source.discoveries = Object.fromEntries(Object.entries(source.discoveries).reverse());
  for (const d of Object.values(source.discoveries)) d.evidence.reverse();
  const b = fixture(source);
  const ctx = buildResearchContext(a.state, a.system, "bench", ["scrap", "electronicSalvage"]);
  assert.deepEqual(resolveExperiment(a.system.catalog, ctx, a.state.research), resolveExperiment(b.system.catalog, ctx, b.state.research));
  a.state.flags.changed = true; a.state.knowledge.discoveries.electricalConduction = true;
  assert.equal(ctx.discoveries.electricalConduction, undefined);
  ctx.profile.samples[0].tags.push("invented");
  assert.ok(!content.items.electronicSalvage.tags.includes("invented"));
});

test("one experiment advances several candidates but never cascades new eligibility", () => {
  const f = fixture(noLuck()); f.stock({ scrap: 3, electronicSalvage: 3 });
  f.run("scrap", "electronicSalvage");
  assert.equal(f.state.research.insight.structuralFabrication, 600);
  assert.equal(f.state.knowledge.discoveries.electricalConduction, true);
  assert.equal(f.state.research.insight.circuitAssembly, undefined);
  f.run("scrap", "electronicSalvage");
  assert.equal(f.state.knowledge.discoveries.structuralFabrication, true);
  assert.equal(f.state.knowledge.discoveries.circuitAssembly, true);
  assert.equal(f.state.knowledge.discoveries.radioAssembly, undefined);
});

test("repetition counts meaningful evidence, not reordered, padded or equivalent samples", () => {
  const f = fixture(singleSource()); f.stock({ scrap: 3, iron: 3, electronicSalvage: 3 });
  f.run("scrap"); f.run("electronicSalvage", "scrap"); f.run("iron");
  assert.equal(f.state.research.insight.testKnowledge, 1500);
  const before = structuredClone(f.state);
  f.state.flags.unrelated = true;
  assert.throws(() => f.run("scrap", "electronicSalvage"), /no new evidence/);
  assert.deepEqual(f.state.research, before.research);
  assert.deepEqual(f.state.locations, before.locations);
});

test("relevant capability variants expose fresh evidence, and toggling never restores old credit", () => {
  const source = singleSource();
  source.discoveries.testKnowledge.evidence[0].variants = [
    { id: "basic", priority: 0 },
    { id: "instrumented", priority: 10, conditions: { capabilities: ["radio"] }, insight: 20 }
  ];
  const f = fixture(source); f.stock({ scrap: 8 });
  for (let i = 0; i < 3; i++) f.run("scrap");
  f.state.locations.habitat.infrastructure.installedAntenna.quantity = 1;
  for (let i = 0; i < 3; i++) f.run("scrap");
  f.state.locations.habitat.infrastructure.installedAntenna.enabled = false;
  assert.throws(() => f.run("scrap"), /no new evidence/);
  f.state.locations.habitat.infrastructure.installedAntenna.enabled = true;
  assert.throws(() => f.run("scrap"), /no new evidence/);
  assert.equal(f.state.research.insight.testKnowledge, 4500);
});

test("distinct sample requirements allocate physical units rather than counting tags twice", () => {
  const profile = ids => buildResearchProfile(ids.map(id => content.items[id]), []);
  assert.equal(matchesSamples(profile(["siliconMinerals"]), { allTags: ["mineral", "silicon"] }), true);
  assert.equal(matchesSamples(profile(["siliconMinerals"]), { distinct: [{ allTags: ["mineral"] }, { allTags: ["silicon"] }] }), false);
  assert.equal(matchesSamples(profile(["scrap", "iron"]), { distinct: [{ allTags: ["metal"] }, { items: ["scrap"] }] }), true);
  assert.equal(matchesSamples(profile(["scrap", "electronicSalvage"]), { allTags: ["metal"], maxSamples: 1 }), false);
});

test("clues learned before eligibility award once, and external discovery grants stay authoritative", () => {
  const f = fixture(noLuck()); f.stock({ electronicSalvage: 5 }); f.state.npcs.mira.flags.benchAdvice = true;
  f.run("electronicSalvage");
  assert.equal(f.state.research.credits["circuitAssembly/advice/base"], undefined);
  f.run("electronicSalvage");
  assert.equal(f.state.research.credits["circuitAssembly/advice/base"], 1);
  assert.equal(f.state.knowledge.discoveries.circuitAssembly, true);
  assert.equal(grantDiscovery(f.state, "radioAssembly"), true);
  assert.equal(grantDiscovery(f.state, "radioAssembly"), false);
  assert.equal(f.state.research.insight.radioAssembly, undefined);
  assert.throws(() => grantDiscovery(f.state, "__proto__"), /Invalid discovery/);
  validateState(f.state, content, defaultWorld, people, f.system);
});

test("payload validation and preview never consume resources, progress or randomness", () => {
  const f = fixture(noLuck()); f.stock({ scrap: 2 });
  const before = structuredClone(f.state);
  for (const payload of [undefined, { methodId: "missing", items: ["scrap"] }, { methodId: "bench", items: [] },
    { methodId: "bench", items: ["scrap", "scrap"] }, { methodId: "bench", items: ["power"] },
    { methodId: "bench", items: ["fabricator"] }, { methodId: "bench", items: ["constructor"] },
    { methodId: "bench", items: [{ id: "scrap", quantity: -1 }] }, { methodId: "bench", items: ["scrap"], quantity: 0.5 }]) {
    assert.ok(previewExperiment(f.state, f.system, payload).reason);
    assert.throws(() => f.transact(s => executeExperiment(s, f.system, payload)));
  }
  for (let i = 0; i < 5; i++) assert.equal(previewExperiment(f.state, f.system, { methodId: "bench", items: ["scrap"] }).reason, "");
  assert.deepEqual(f.state, before);
  f.stock({ scrap: 0 });
  assert.throws(() => f.run("scrap"), /more local/);
});

test("research is local, respects ownership and operational equipment, and supports equipped ships", () => {
  const source = structuredClone(locationDefinitions);
  source.locations.labShip = { name: "Laboratory ship", type: "ship", areaId: "vicinity", initialOwnerId: "player", description: "Test laboratory.", remoteDescription: "Test laboratory.", initialResources: { scrap: 0.03 }, initialInfrastructure: { fabricator: { quantity: 1 } } };
  const world = buildLocationCatalog(source, content, createItemActions(content));
  const f = fixture(noLuck(), content, world); f.stock({ scrap: 8 });
  f.state.locationId = "supplyPlatform"; f.stock({ scrap: 2 }); assert.throws(() => f.run("scrap"), /operational bench/);
  f.state.locationId = "labShip";
  f.run("scrap"); assert.equal(f.state.locations.labShip.resources.scrap, 20000); assert.equal(f.state.locations.habitat.resources.scrap, 80000);
  f.state.entities.labShip.ownerId = null; assert.throws(() => f.run("scrap"), /ownership/);
  f.state.entities.labShip.ownerId = "player";
  const machine = f.state.locations.labShip.infrastructure.fabricator;
  for (const patch of [{ enabled: false }, { health: 0 }, { quantity: 0 }]) {
    Object.assign(machine, { quantity: 1, health: 1, enabled: true }, patch); assert.throws(() => f.run("scrap"), /operational bench/);
  }
});

test("method power costs are checked separately from sample consumption", () => {
  const source = singleSource(); source.methods.bench.cost = { power: 2 };
  const f = fixture(source); f.stock({ scrap: 2, power: 1 }); assert.throws(() => f.run("scrap"), /more local/);
  f.stock({ power: 2 }); f.run("scrap");
  assert.equal(f.state.locations.habitat.resources.power, 0); assert.equal(f.state.locations.habitat.resources.scrap, 10000);
});

test("failed saves roll back payment, discoveries, journal, evidence and the random stream", () => {
  const f = fixture(); f.stock({ scrap: 2 }); f.action("inspect:habitat:fitting");
  const before = structuredClone(f.state); f.setFail(true);
  assert.throws(() => f.run("scrap"), /Save failed/); assert.deepEqual(f.state, before);
  f.setFail(false); f.run("scrap");
  const other = fixture(); other.stock({ scrap: 2 }); other.action("inspect:habitat:fitting"); other.run("scrap");
  assert.deepEqual(f.state, other.state);
});

test("all opening recipes and recovery are reachable with zero power and no lucky bonuses", t => {
  const f = fixture(noLuck()); f.stock({ power: 0 });
  assert.match(previewRecipe(getLocationContext(f.state, content, defaultWorld).actionState, "iron:refine", {}, content).reason, /discovery/);
  // No inspections or NPC shortcuts: renewable local salvage supplies the entire route.
  for (let i = 0; i < 2; i++) { f.action("salvage"); f.run("scrap"); }
  for (let i = 0; i < 8; i++) f.action("salvage");
  f.action("refineScrap"); f.action("refineScrap"); f.action("repairSolar");
  assert.equal(f.state.locations.habitat.infrastructure.solar.health, 1);
  for (let i = 0; i < 2; i++) { f.action("salvage"); f.action("gatherElectronics"); f.run("scrap", "electronicSalvage"); }
  f.action("gatherMinerals"); f.action("gatherElectronics"); f.run("siliconMinerals", "electronicSalvage");
  assert.equal(f.state.knowledge.discoveries.semiconductorBehavior, true);
  f.action("gatherMinerals"); f.action("gatherElectronics"); f.run("siliconMinerals", "electronicSalvage");
  f.action("gatherElectronics"); f.action("gatherElectronics"); f.craft("electronicParts:fabricate");
  f.action("gatherMinerals"); f.run("siliconMinerals", "electronicParts");
  assert.equal(f.state.knowledge.discoveries.photovoltaicFabrication, true);
  // Fabricate all remaining experimental and product materials from renewable sources.
  for (let i = 0; i < 18; i++) f.action("salvage");
  for (let i = 0; i < 13; i++) f.action("gatherElectronics");
  for (let i = 0; i < 4; i++) f.action("gatherMinerals");
  for (let i = 0; i < 3; i++) f.craft("iron:refine");
  for (let i = 0; i < 3; i++) f.craft("conductiveParts:fabricate");
  for (let i = 0; i < 5; i++) f.craft("electronicParts:fabricate");
  f.run("electronicParts", "conductiveParts");
  for (let i = 0; i < 2; i++) f.craft("solarCells:fabricate");
  f.craft("solarPanel:assemble"); f.craft("radioAntenna:assemble"); f.action("install:solarPanel"); f.action("install:radioAntenna");
  assert.equal(Object.values(f.state.knowledge.discoveries).filter(Boolean).length, 6);
  assert.equal(f.state.locations.habitat.resources.power, 0);
  f.transact(s => advanceGame(s, 2, content, (state, id) => getLocationContext(state, content, defaultWorld, id)));
  f.action("scanSignal"); assert.equal(f.state.flags.localSignalObserved, true);
  assert.ok(f.peakCargo <= defaultWorld.definitions.habitat.capacityVolumeUnits);
  t.diagnostic(`Opening route peak cargo: ${f.peakCargo / 1000000} m³ of 10 m³.`);
});

test("optional inspection and conversation routes reach photovoltaic knowledge without semiconductor discovery", () => {
  const f = fixture(noLuck()); f.state.npcs.mira.flags.benchAdvice = true;
  f.action("inspect:habitat:solarHardware"); f.stock({ siliconMinerals: 1, electronicSalvage: 1 });
  f.run("siliconMinerals", "electronicSalvage");
  assert.equal(f.state.knowledge.discoveries.photovoltaicFabrication, true);
  // Eligibility was supplied by the clue, even though semiconductor knowledge was absent at submission.
  assert.equal(f.state.research.attemptCount, 1);
  const g = fixture(noLuck()); g.action("inspect:habitat:fitting"); g.stock({ scrap: 1 }); g.run("scrap");
  assert.equal(g.state.knowledge.discoveries.structuralFabrication, true);
});

test("version-five migration preserves assets and gives legacy knowledge exactly once", () => {
  const f = fixture(), old = legacyState(f.state, 5); delete old.research;
  old.knowledge.discoveries.externalFact = true; old.locations.habitat.resources.scrap = 7;
  old.npcs.mira.inventory.scrap = 4;
  const before = structuredClone(old), notices = [];
  const next = migrateState(old, content, defaultWorld, people, notices, f.system);
  assert.deepEqual(old, before);
  const converted = structuredClone(old); converted.locations.habitat.resources.scrap = 70000; converted.npcs.mira.inventory.scrap = 40000;
  assert.deepEqual(next.locations, withoutLocalOwners(converted.locations));
  assert.deepEqual(next.npcs, converted.npcs); assert.deepEqual(next.dialogue, old.dialogue);
  assert.equal(next.saveVersion, 9); assert.equal(next.knowledge.discoveries.externalFact, true);
  assert.equal(next.research.legacyKnowledge, true); assert.equal(next.research.attemptCount, 0);
  assert.equal(Object.values(next.knowledge.discoveries).filter(Boolean).length, 7);
  assert.equal(notices.length, 3); assert.deepEqual(migrateState(next, content, defaultWorld, people, [], f.system), next);
  assert.deepEqual(f.state.knowledge.discoveries, {});
});

test("content additions and text edits preserve progress; removed or rebalanced evidence fails safely", () => {
  const f = fixture(singleSource()); f.stock({ scrap: 2 }); f.run("scrap");
  const source = singleSource(); source.discoveries.testKnowledge.name = "A revised title";
  source.discoveries.testKnowledge.evidence[0].observation = "Revised wording.";
  source.discoveries.another = { ...structuredClone(source.discoveries.testKnowledge), name: "Another discovery" };
  const nextSystem = buildResearchSystem(content, defaultWorld, people, source);
  assert.deepEqual(migrateState(f.state, content, defaultWorld, people, [], nextSystem), f.state);
  source.discoveries.testKnowledge.threshold = 150;
  assert.throws(() => migrateState(f.state, content, defaultWorld, people, [], buildResearchSystem(content, defaultWorld, people, source)), /migration/);
  delete source.discoveries.testKnowledge;
  assert.throws(() => migrateState(f.state, content, defaultWorld, people, [], buildResearchSystem(content, defaultWorld, people, source)), /insight/);
  const retired = singleSource(); retired.discoveries.testKnowledge.retired = true;
  assert.deepEqual(migrateState(f.state, content, defaultWorld, people, [], buildResearchSystem(content, defaultWorld, people, retired)), f.state);
});

test("journal compaction keeps lifetime evidence and validates malformed saves without mutating them", () => {
  const source = singleSource(); source.discoveries = {};
  for (let i = 0; i < 35; i++) source.discoveries[`entry${i}`] = { name: `Entry ${i}`, description: "Sequential test evidence.", families: ["materials"], threshold: 15,
    eligibility: i ? { discoveries: [`entry${i - 1}`] } : {},
    evidence: [{ id: "metal", samples: { allTags: ["metal"] }, insight: 10, observation: "Recorded." }] };
  const f = fixture(source);
  for (let i = 0; i < 105; i++) { f.stock({ scrap: 1 }); f.run("scrap"); }
  assert.equal(f.state.research.attemptCount, 105); assert.equal(f.state.research.attempts.length, 100);
  assert.equal(f.state.research.attempts[0].id, 6); assert.equal(f.state.research.credits["entry0/metal/base"], 3);
  assert.equal(f.state.research.exposure.materials, 100);
  assert.deepEqual(migrateState(f.state, content, defaultWorld, people, [], f.system), f.state);
  for (const mutate of [s => { s.research.rng = -1; }, s => { s.research.insight.entry0 = NaN; }, s => { s.research.credits["entry0/metal/base"] = 4; },
    s => { s.research.attempts[0].id = 0; }, s => { s.research.attempts[0].inputs = ["power"]; }]) {
    const malformed = structuredClone(f.state); mutate(malformed); const before = structuredClone(malformed);
    assert.throws(() => migrateState(malformed, content, defaultWorld, people, [], f.system), /Invalid research/); assert.deepEqual(malformed, before);
  }
});

test("adding evidence, methods and instrument variants preserves old credit without migration code", () => {
  const f = fixture(singleSource()); f.stock({ scrap: 4 });
  for (let i = 0; i < 3; i++) f.run("scrap");
  const source = singleSource();
  source.methods.secondBench = { ...source.methods.bench, name: "Second bench method" };
  source.discoveries.testKnowledge.evidence.push({ id: "electrical", samples: { allTags: ["electrical"] }, insight: 10, observation: "New electrical evidence." });
  source.discoveries.testKnowledge.evidence[0].variants = [
    { id: "base", priority: 0 },
    { id: "radio", priority: 10, conditions: { capabilities: ["radio"] }, insight: 20 }
  ];
  const nextSystem = buildResearchSystem(content, defaultWorld, people, source);
  const before = structuredClone(f.state);
  const next = migrateState(f.state, content, defaultWorld, people, [], nextSystem);
  assert.deepEqual(f.state, before);
  assert.deepEqual(next.research.credits, before.research.credits);
  assert.deepEqual(next.research.insight, before.research.insight);
  assert.deepEqual(next.research.attempts, before.research.attempts);
  assert.notEqual(next.research.contracts.testKnowledge, before.research.contracts.testKnowledge);
  assert.throws(() => executeExperiment(next, nextSystem, { methodId: "secondBench", items: ["scrap"] }), /no new evidence/);
  next.locations.habitat.infrastructure.installedAntenna.quantity = 1;
  executeExperiment(next, nextSystem, { methodId: "bench", items: ["scrap"] });
  assert.equal(next.research.credits["testKnowledge/metal/base"], 3);
  assert.equal(next.research.credits["testKnowledge/metal/radio"], 1);
  const removed = structuredClone(source); removed.discoveries.testKnowledge.evidence[0].variants.shift();
  assert.throws(() => migrateState(next, content, defaultWorld, people, [], buildResearchSystem(content, defaultWorld, people, removed)), /migration/);
});

test("definition-only additions can grant an alternative crafting role and use a new equipment capability", () => {
  const source = structuredClone(definitions);
  source.infrastructure.analyzer = { name: "Analyzer", capabilities: ["spectroscopy"] };
  source.items.shieldedHousing = { name: "Shielded housing", category: "component", unitVolumeM3: 0.005, tags: ["metal"],
    roles: { structure: { conditions: { discoveries: ["shielding"] } } }, recipes: [{ id: "make", name: "Make housing", conditions: { discoveries: ["shielding"] }, inputs: [{ id: "metal", item: "scrap", quantity: 0.01 }] }] };
  const items = buildCatalog(source), world = buildLocationCatalog(locationDefinitions, items, createItemActions(items));
  const research = singleSource(); research.discoveries = { shielding: { name: "Shielding", description: "New authored knowledge.", families: ["materials"], threshold: 5,
    evidence: [{ id: "metal", samples: { allTags: ["metal"] }, conditions: { capabilities: ["spectroscopy"] }, insight: 5, observation: "The analyzer reveals a useful property." }] } };
  const f = fixture(research, items, world); f.stock({ scrap: 2 });
  assert.throws(() => f.run("scrap"), /no new evidence/);
  f.state.locations.habitat.infrastructure.analyzer.quantity = 1; f.run("scrap"); f.craft("shieldedHousing:make");
  assert.equal(f.state.locations.habitat.resources.shieldedHousing, 1);
  grantDiscovery(f.state, "radioAssembly"); f.stock({ conductiveParts: 1, electronicParts: 1 });
  f.transact(s => craft(getLocationContext(s, items, world).actionState, "radioAntenna:assemble", { frame: "shieldedHousing" }, items));
  assert.equal(f.state.locations.habitat.resources.radioAntenna, 1);
});
