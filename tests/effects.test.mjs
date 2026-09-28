import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture, shipSpec } from "./entityFixtures.mjs";
import { content, definitions } from "../js/content.js";
import { buildCatalog } from "../js/itemCatalog.js";
import { buildGameSystems } from "../js/bootstrap.js";
import { compileEffects, describeEffects, applyEffects, effectRegistry } from "../js/effects.js";
import { grantItemsChecked } from "../js/resources.js";
import { getLocationContext } from "../js/locations.js";
import { dialogueDefinitions } from "../js/dialogueContent.js";
import { isCompleted } from "../js/dialogue.js";
import { legacyState } from "./legacyState.mjs";
import { locationDefinitions } from "../js/locationContent.js";
import { npcDefinitions } from "../js/npcContent.js";
import { researchDefinitions } from "../js/research/researchContent.js";
import { previewExperiment } from "../js/research/researchActions.js";
import { graphView, startupMessages } from "../js/locations.js";
import { npcVisible } from "../js/npcs.js";
import { contentReferenceCollector } from "../js/entityComposition.js";

const flag = name => ({ type: "setFlag", scope: "global", flag: name, value: true });
const compile = (effects, f, kind = "item") => compileEffects(effects,
  f ? { content: f.content, world: f.world, npcs: f.people.npcs, complete: true } : { content }, { kind });
function operationFixture(effects, options = {}) {
  const source = structuredClone(definitions);
  source.items.radioAntenna.operations = [{ id: "scanSignal", name: "Scan local frequencies", cost: { power: 1 },
    effects, ...options }];
  return prepare(fixture({ content: buildCatalog(source) }));
}
function prepare(f) {
  f.runtime.applyAction(s => { s.locations.habitat.infrastructure.installedAntenna.quantity = 1; });
  return f;
}
function choose(f, id = "shutdown") {
  f.registry.executeAction("dialogue:start", { npcId: "mira" });
  f.registry.executeAction("dialogue:topics", { ...token(f) });
  f.registry.executeAction("dialogue:topic", { ...token(f), id: "miraIntroduction" });
  return () => f.registry.executeAction("dialogue:choice", { ...token(f), id });
}
const token = f => ({ sessionId: f.state.dialogue.active.sessionId, revision: f.state.dialogue.active.revision });
function dialogueFixture(effects, terminal = false) {
  const dialogueSource = structuredClone(dialogueDefinitions);
  const choice = dialogueSource.conversations.miraIntroduction.nodes.intro.choices[0];
  choice.effects = effects;
  if (terminal) { delete choice.destinationNode; Object.assign(choice, { terminal: true, complete: true, closingText: "Farewell." }); }
  return fixture({ dialogueSource });
}

test("registry exposes the immutable Round 1 and Round 2 descriptors", () => {
  assert.deepEqual(Object.keys(effectRegistry), ["setFlag", "discover", "relocate", "grantItem", "deactivateEntity", "spawnEntity", "activateEntity", "activateLocation"]);
  assert.ok(Object.isFrozen(effectRegistry));
  Object.values(effectRegistry).forEach(d => assert.ok(Object.isFrozen(d)));
  for (const type of ["unknown", "bindResult", "onArrival"])
    assert.throws(() => compile([{ type }]), /unknown effect/);
});

test("all five descriptors reject malformed payloads and unsupported fields", () => {
  const f = fixture();
  for (const effect of [
    { ...flag("ok"), value: "true" }, { ...flag("constructor") }, { ...flag("ok"), scope: "local" },
    { ...flag("ok"), target: "current" }, { type: "discover", id: "__proto__" },
    { type: "relocate", npcId: "mira", destinationId: "vicinity" },
    { type: "relocate", npcId: "habitat", destinationId: "derelict" },
    { type: "grantItem", itemId: "power", amount: 1 }, { type: "grantItem", itemId: "iron", amount: 0.5 },
    { type: "grantItem", itemId: "iron", amount: 0 }, { type: "grantItem", itemId: "scrap", amount: 0.0000001 },
    { type: "grantItem", itemId: "iron", amount: 1, destinationId: "mira" },
    { type: "grantItem", itemId: "iron", amount: 1, destinationId: null },
    { type: "deactivateEntity", targetId: "missing" }, { type: "deactivateEntity", targetId: "mira", reason: 1 },
    { type: "deactivateEntity", targetId: "mira", actorId: "player" }
  ]) assert.throws(() => compile([effect], f));
});

test("context aliases are validated during compilation and execution", () => {
  for (const effect of [{ type: "setFlag", scope: "npc", target: "speaker", flag: "seen", value: true },
    { type: "relocate", npcId: "speaker", destinationId: "current" },
    { type: "deactivateEntity", targetId: "speaker" }]) assert.throws(() => compile([effect]), /speaker requires dialogue/);
  assert.throws(() => compile([{ type: "relocate", npcId: "current", destinationId: "habitat" }]), /current requires a location/);
  const effects = compile([{ type: "setFlag", scope: "location", target: "current", flag: "seen", value: true }]);
  const f = fixture(), before = structuredClone(f.state);
  assert.throws(() => f.runtime.applyAction(s => applyEffects(s, effects, f.effectServices)), /current location/);
  assert.deepEqual(f.state, before);
  const dialogueEffects = compile([{ type: "deactivateEntity", targetId: "speaker" }], f, "dialogue");
  assert.throws(() => applyEffects({}, dialogueEffects, f.effectServices, { kind: "item", npcId: "mira" }), /speaker/);
});

test("captured current and speaker remain stable after an earlier relocation", () => {
  const effects = compile([
    { type: "relocate", npcId: "speaker", destinationId: "derelict" },
    { type: "setFlag", scope: "location", target: "current", flag: "oldConsole", value: true },
    { type: "setFlag", scope: "npc", target: "speaker", flag: "departed", value: true }
  ], undefined, "dialogue");
  const trigger = { kind: "dialogue", locationId: "habitat", npcId: "mira" }, calls = [];
  applyEffects({}, effects, {
    relocate(_state, npc, destination) { calls.push([npc, destination]); trigger.locationId = "derelict"; trigger.npcId = "oren"; },
    setFlag(_state, scope, target) { calls.push([scope, target]); }
  }, trigger);
  assert.deepEqual(calls, [["mira", "derelict"], ["location", "habitat"], ["npc", "mira"]]);
});

test("descriptor metadata separates produced discoveries, retained references, and contact impact", () => {
  const metadata = describeEffects(compile([{ type: "discover", id: "earned" },
    { type: "relocate", npcId: "mira", destinationId: "derelict" }]));
  assert.deepEqual(metadata.filter(m => m.kind === "discovery"), [{ kind: "discovery", id: "earned", access: "produce" }]);
  assert.deepEqual(metadata.filter(m => m.kind === "entity").map(m => [m.targetId, m.policy]), [["mira", "retain"], ["derelict", "retain"]]);
  assert.deepEqual(metadata.filter(m => m.kind === "contact"), [{ kind: "contact", targetId: "mira" }]);
});

test("composition links item target references and reports producers without treating conditions as grants", () => {
  const source = structuredClone(definitions);
  source.items.radioAntenna.operations = [{ id: "scanSignal", name: "Scan", conditions: { discoveries: ["needed"] },
    effects: [{ type: "discover", id: "earned" }, { type: "deactivateEntity", targetId: "mira" }] }];
  const catalog = buildCatalog(source);
  assert.ok(catalog.discoveryReferences.required.includes("needed"));
  assert.deepEqual(catalog.discoveryReferences.granted, ["earned"]);
  assert.ok(!catalog.discoveryReferences.granted.includes("needed"));
  assert.ok(buildGameSystems({ content: catalog }).content.entityReferences.some(r => r.targetId === "mira"));
  source.items.radioAntenna.operations[0].effects[1].targetId = "missing";
  assert.throws(() => buildGameSystems({ content: buildCatalog(source) }), /unknown or incompatible target missing/);
});

test("successful heterogeneous item effects execute in order and survive reload", () => {
  const f = operationFixture([
    { type: "grantItem", itemId: "iron", amount: 1 }, flag("awarded"),
    { type: "discover", id: "externalKnowledge" },
    { type: "relocate", npcId: "oren", destinationId: "derelict" },
    { type: "deactivateEntity", targetId: "oren", reason: "Resting" }
  ], { once: true, completion: { scope: "global", flag: "scanCompleted" } });
  f.registry.executeAction("scanSignal");
  assert.equal(f.state.locations.habitat.resources.iron, 1);
  assert.equal(f.state.flags.awarded, true);
  assert.equal(f.state.flags.scanCompleted, true);
  assert.equal(f.state.knowledge.discoveries.externalKnowledge, true);
  assert.equal(f.state.npcs.oren.locationId, "derelict");
  assert.equal(f.state.entities.oren.lifecycle, "inactive");
  assert.equal(f.state.entities.oren.lifecycleReason, "Resting");
  assert.deepEqual(f.reload(f.saved), f.state);
  assert.equal(f.registry.getActionStatus("scanSignal").visible, false);
});

test("grant, flag, and blocked deactivation roll back the entire item action", () => {
  const f = operationFixture([{ type: "grantItem", itemId: "iron", amount: 1 }, flag("partial"),
    { type: "deactivateEntity", targetId: "habitat" }], { once: true, completion: { scope: "global", flag: "completed" } });
  const before = structuredClone(f.state), saved = structuredClone(f.saved), live = f.state;
  assert.throws(() => f.registry.executeAction("scanSignal"), /must be resolved/);
  assert.equal(f.state, live);
  assert.deepEqual(f.state, before);
  assert.deepEqual(f.saved, saved);
  assert.equal(f.state.flags.partial, undefined);
  assert.equal(f.state.flags.completed, undefined);
});

test("save failure rolls back successful mixed effects and operation completion", () => {
  const f = operationFixture([{ type: "grantItem", itemId: "iron", amount: 1 }, flag("rewarded"),
    { type: "deactivateEntity", targetId: "oren" }], { once: true, completion: { scope: "global", flag: "completed" } });
  const before = structuredClone(f.state), saved = structuredClone(f.saved);
  f.failSave(true);
  assert.throws(() => f.registry.executeAction("scanSignal"), /Save failed/);
  assert.deepEqual(f.state, before); assert.deepEqual(f.saved, saved);
  f.failSave(false); f.registry.executeAction("scanSignal");
  assert.equal(f.state.flags.completed, true);
});

test("cargo capacity failure is atomic and grants never clamp", () => {
  const f = operationFixture([flag("partial"), { type: "grantItem", itemId: "scrap", amount: 10.000001 }]);
  const before = structuredClone(f.state);
  assert.throws(() => f.registry.executeAction("scanSignal"), /cargo capacity/);
  assert.deepEqual(f.state, before);
  const store = getLocationContext(structuredClone(f.state), f.content, f.world).store;
  const resources = structuredClone(store.resources);
  assert.throws(() => grantItemsChecked(store, { scrap: 10_000_001 }, f.content), /cargo capacity/);
  assert.deepEqual(store.resources, resources);
  for (const rewards of [{ power: 1 }, { iron: 0.5 }, { iron: 0 }, { iron: Number.MAX_SAFE_INTEGER + 1 }])
    assert.throws(() => grantItemsChecked(store, rewards, f.content), /Invalid item grant/);
});

test("grant arithmetic overflow rolls back without changing existing inventory", () => {
  const f = operationFixture([flag("partial"), { type: "grantItem", itemId: "iron", amount: Number.MAX_SAFE_INTEGER }]);
  f.runtime.applyAction(s => { s.locations.habitat.resources.iron = 1; });
  const before = structuredClone(f.state);
  assert.throws(() => f.registry.executeAction("scanSignal"), /overflow/);
  assert.deepEqual(f.state, before);
});

test("bulk amounts compile once and product grants remain stored cargo", () => {
  const f = operationFixture([{ type: "grantItem", itemId: "scrap", amount: 0.000001 },
    { type: "grantItem", itemId: "solarPanel", amount: 1 }]);
  assert.equal(f.content.items.radioAntenna.operations[0].effects[0].amount, 1);
  const installed = f.state.locations.habitat.infrastructure.installedPanels.quantity;
  f.registry.executeAction("scanSignal");
  assert.equal(f.state.locations.habitat.resources.scrap, 1);
  assert.equal(f.state.locations.habitat.resources.solarPanel, 1);
  assert.equal(f.state.locations.habitat.infrastructure.installedPanels.quantity, installed);
});

test("grants support ship cargo and reject inactive destinations", () => {
  const f = fixture(), ship = f.spawn(shipSpec());
  const effects = compile([{ type: "grantItem", itemId: "iron", amount: 2, destinationId: ship }]);
  f.runtime.applyAction(s => applyEffects(s, effects, f.effectServices, { kind: "item", locationId: "habitat" }));
  assert.equal(f.state.locations[ship].resources.iron, 2);
  f.runtime.applyAction(s => f.effectServices.deactivateEntity(s, ship, {}));
  const before = structuredClone(f.state);
  assert.throws(() => f.runtime.applyAction(s => applyEffects(s, effects, f.effectServices)), /unavailable/);
  assert.deepEqual(f.state, before);
});

test("legacy singular operations normalize with original global or local completion identity", () => {
  for (const scope of [undefined, "local"]) {
    const source = structuredClone(definitions);
    const op = source.items.radioAntenna.operations[0];
    delete op.effects; delete op.completion;
    op.effect = { type: "setFlag", flag: "legacyDone", ...(scope ? { scope } : {}) };
    const f = prepare(fixture({ content: buildCatalog(source) }));
    const normalized = f.content.items.radioAntenna.operations[0];
    assert.equal(normalized.effect, undefined);
    assert.equal(normalized.effects.length, 1);
    assert.deepEqual(normalized.completion, { scope: scope ? "location" : "global", flag: "legacyDone" });
    f.registry.executeAction("scanSignal");
    assert.equal((scope ? f.state.locations.habitat.flags : f.state.flags).legacyDone, true);
    const restored = f.reload(f.saved);
    assert.deepEqual(restored, f.state);
    assert.equal(f.registry.getActionStatus("scanSignal").visible, false);
    // A legacy-version save uses the same flag maps and retains completion through migration.
    const old = legacyState(f.saved, 7), migrated = f.reload(old);
    assert.equal((scope ? migrated.locations.habitat.flags : migrated.flags).legacyDone, true);
  }
});

test("reward edits do not redefine completed operations or replay rewards during reload", () => {
  const completion = { scope: "global", flag: "stableCompletion" };
  const f = operationFixture([flag("oldReward")], { once: true, completion });
  f.registry.executeAction("scanSignal");
  const changed = operationFixture([flag("newReward"), { type: "grantItem", itemId: "iron", amount: 1 }], { once: true, completion });
  const restored = changed.reload(f.saved);
  changed.runtime.applyAction(s => Object.assign(s, restored));
  assert.equal(changed.registry.getActionStatus("scanSignal").visible, false);
  assert.equal(changed.state.flags.newReward, undefined);
  assert.equal(changed.state.locations.habitat.resources.iron, 0);
});

test("new one-time operations require independent valid completion metadata", () => {
  for (const options of [{ once: true }, { once: true, completion: { scope: "npc", flag: "done" } },
    { once: true, completion: { scope: "global", flag: "constructor" } },
    { completion: { scope: "global", flag: "done" } }]) assert.throws(() => operationFixture([flag("reward")], options), /completion/);
  assert.throws(() => operationFixture([{ ...flag("done"), value: false }],
    { once: true, completion: { scope: "global", flag: "done" } }), /conflicting completion/);
  const source = structuredClone(definitions);
  source.items.radioAntenna.operations[0].effect = { type: "setFlag", flag: "done" };
  assert.throws(() => buildCatalog(source), /both effect and effects/);
});

test("unknown effects fail in item and dialogue content compilation", () => {
  assert.throws(() => operationFixture([{ type: "teleport" }]), /unknown effect/);
  assert.throws(() => dialogueFixture([{ type: "teleport" }]), /unknown effect/);
});

test("dialogue can grant cargo and generic knowledge without experimental progress", () => {
  const f = dialogueFixture([{ type: "grantItem", itemId: "iron", amount: 1 },
    { type: "discover", id: "radioAssembly" }, flag("briefed")]);
  const research = structuredClone(f.state.research);
  choose(f)();
  assert.equal(f.state.locations.habitat.resources.iron, 1);
  assert.equal(f.state.knowledge.discoveries.radioAssembly, true);
  assert.equal(f.state.flags.briefed, true);
  assert.deepEqual(f.state.research, research);
});

test("dialogue speaker deactivation closes contact safely and retains completion history", () => {
  const f = dialogueFixture([flag("farewell"), { type: "deactivateEntity", targetId: "speaker" }], true);
  const execute = choose(f);
  assert.match(execute().message, /Mira: Farewell/);
  assert.equal(f.state.dialogue.active, null);
  assert.equal(f.state.entities.mira.lifecycle, "inactive");
  assert.equal(isCompleted(f.state, f.people, "miraIntroduction", "mira"), true);
  assert.deepEqual(f.reload(f.saved), f.state);
  assert.throws(() => dialogueFixture([{ type: "deactivateEntity", targetId: "speaker" }]), /must be terminal/);
});

test("dialogue relocation preserves source-location aliases for later effects", () => {
  const f = dialogueFixture([{ type: "relocate", npcId: "speaker", destinationId: "derelict" },
    { type: "setFlag", scope: "location", target: "current", flag: "farewell", value: true }], true);
  choose(f)();
  assert.equal(f.state.npcs.mira.locationId, "derelict");
  assert.equal(f.state.locations.habitat.flags.farewell, true);
  assert.equal(f.state.locations.derelict.flags.farewell, undefined);
  assert.equal(f.state.dialogue.active, null);
});

test("heterogeneous dialogue failure rolls back cargo, flags, choice progress, and revision", () => {
  const f = dialogueFixture([{ type: "grantItem", itemId: "iron", amount: 1 }, flag("partial"),
    { type: "deactivateEntity", targetId: "current" }]);
  const execute = choose(f), before = structuredClone(f.state), saved = structuredClone(f.saved);
  assert.throws(execute, /must be resolved/);
  assert.deepEqual(f.state, before); assert.deepEqual(f.saved, saved);
});

test("missing services are explicit and asynchronous effects cannot commit", () => {
  const f = fixture(), effects = compile([flag("partial"), { type: "discover", id: "earned" }]);
  const before = structuredClone(f.state);
  assert.throws(() => f.runtime.applyAction(s => applyEffects(s, effects, { setFlag: f.effectServices.setFlag })), /Missing effect service: discover/);
  assert.deepEqual(f.state, before);
  assert.throws(() => f.runtime.applyAction(s => applyEffects(s, compile([flag("partial")]),
    { setFlag: () => Promise.resolve() })), /synchronously/);
  assert.deepEqual(f.state, before);
});

const spawnShip = overrides => ({ type: "spawnEntity", spec: shipSpec(overrides) });
function runEffects(f, effects, trigger = { kind: "item", locationId: "habitat" }) {
  const compiled = compile(effects, effects.some(e => e.targetId?.startsWith("gen_")) ? undefined : f, trigger.kind);
  return f.runtime.applyAction(s => applyEffects(s, compiled, f.effectServices, trigger));
}

test("Round 2 descriptors reject malformed specifications, aliases, definitions, and bindings", () => {
  const f = fixture();
  for (const effect of [
    { type: "spawnEntity" }, spawnShip({ definitionId: "missing" }), spawnShip({ definitionId: "depot" }),
    spawnShip({ type: "area" }), spawnShip({ key: "newShip" }), spawnShip({ dockedAtId: { ref: "newShip" } }),
    spawnShip({ areaId: "current" }), spawnShip({ ownerId: "habitat" }), spawnShip({ lifecycle: "destroyed" }),
    spawnShip({ resources: { scrap: 0.0000001 } }), spawnShip({ resources: { iron: 0.5 } }),
    spawnShip({ infrastructure: { engine: { quantity: -1 } } }), spawnShip({ infrastructure: { engine: { other: true } } }),
    { type: "spawnEntity", spec: { type: "npc", definitionId: "mira", locationId: "current" } },
    { type: "spawnEntity", spec: { type: "npc", definitionId: "merchant", locationId: "current", inventory: { scrap: 1 } } },
    { type: "spawnEntity", spec: { type: "principal", displayName: " " } },
    { type: "activateLocation", targetId: "mira" }, { type: "activateLocation", targetId: "speaker" },
    { type: "activateEntity", targetId: "missing" }, { type: "activateEntity", targetId: "oren", reason: false }
  ]) assert.throws(() => compile([effect], f));
  assert.throws(() => operationFixture([spawnShip({ definitionId: "missing" })]), /definition/);
  assert.throws(() => compileEffects([spawnShip({ resources: { scrap: 0.01 } })]), /content catalog/);
});

test("spawn descriptors distinguish templates from persistent references and protect catalog data", () => {
  const f = fixture(), authored = spawnShip({ resources: { scrap: 0.000001 }, infrastructure: { engine: { health: 0.5 } } });
  const effects = compile([authored], f), metadata = describeEffects(effects);
  assert.deepEqual(metadata.filter(r => r.kind === "definition").map(r => [r.catalog, r.id, r.type]), [["locations", "freighter", "ship"]]);
  assert.ok(!metadata.some(r => r.kind === "entity" && r.targetId === "freighter"));
  assert.ok(Object.isFrozen(effects[0].spec.resources));
  authored.spec.resources.scrap = 1;
  f.runtime.applyAction(s => applyEffects(s, effects, f.effectServices));
  f.runtime.applyAction(s => applyEffects(s, effects, f.effectServices));
  for (const id of ["gen_ship_1", "gen_ship_2"]) {
    assert.equal(f.state.locations[id].resources.scrap, 1);
    assert.equal(f.state.locations[id].infrastructure.engine.health, 0.5);
  }
  assert.equal(effects[0].spec.resources.scrap, 1);
  assert.equal(f.world.definitions.freighter.initialResources.scrap, 30000);
});

test("item effects create all supported entities, preserve initialization, and join runtime rosters", () => {
  const f = operationFixture([spawnShip({ controllerId: "corporation", displayName: "Carina", resources: { scrap: 0.000001 } }),
    { type: "spawnEntity", spec: { type: "site", definitionId: "depot", areaId: "vicinity", ownerId: "player" } },
    { type: "spawnEntity", spec: { type: "npc", definitionId: "merchant", locationId: "current", inventory: { scrap: 0.000002 }, displayName: "Edda" } },
    { type: "spawnEntity", spec: { type: "principal", displayName: "New organization" } }
  ], { once: true, completion: { scope: "global", flag: "spawnComplete" } });
  f.registry.executeAction("scanSignal");
  assert.equal(f.state.entityIds.next, 5);
  assert.equal(f.state.entities.gen_ship_1.ownerId, "player");
  assert.equal(f.state.entities.gen_ship_1.controllerId, "corporation");
  assert.equal(f.state.locations.gen_ship_1.resources.scrap, 1);
  assert.equal(f.state.npcs.gen_npc_3.inventory.scrap, 2);
  assert.equal(npcVisible(f.state, "gen_npc_3", f.people), true);
  assert.ok(graphView(f.state, f.world, f.content, "vicinity").nodes.some(n => n.id === "gen_ship_1" && n.name === "Carina"));
  assert.equal(f.registry.getActionStatus("board:gen_ship_1").available, true);
  assert.ok(!contentReferenceCollector(f)().some(r => ["freighter", "depot", "merchant"].includes(r.targetId)));
  assert.deepEqual(f.reload(f.saved), f.state);
  assert.equal(f.registry.getActionStatus("scanSignal").visible, false);
  f.registry.executeAction("board:gen_ship_1");
  assert.ok(f.registry.getActionStatus("inspect:gen_ship_1:bridge").available);
});

test("spawn failures restore identifiers, cargo, costs, and completion together", () => {
  for (const last of [{ type: "deactivateEntity", targetId: "habitat" }, spawnShip({ resources: { scrap: 3 } })]) {
    const f = operationFixture([spawnShip(), { type: "grantItem", itemId: "iron", amount: 1 }, flag("partialSpawn"), last],
      { once: true, completion: { scope: "global", flag: "spawnComplete" } });
    const before = structuredClone(f.state), saved = structuredClone(f.saved);
    assert.throws(() => f.registry.executeAction("scanSignal"), /must be resolved|capacity/);
    assert.deepEqual(f.state, before); assert.deepEqual(f.saved, saved);
    assert.equal(f.state.entityIds.next, 1);
  }
  const f = operationFixture([spawnShip()]);
  const before = structuredClone(f.state); f.failSave(true);
  assert.throws(() => f.registry.executeAction("scanSignal"), /Save failed/);
  assert.deepEqual(f.state, before);
});

test("spawning honors active placement and cargo limits without accepting player spawn payloads", () => {
  const f = fixture();
  runEffects(f, [{ type: "deactivateEntity", targetId: "supplyPlatform" }]);
  const before = structuredClone(f.state);
  assert.throws(() => runEffects(f, [spawnShip({ dockedAtId: "supplyPlatform" })]), /unavailable/);
  assert.deepEqual(f.state, before);
  assert.throws(() => runEffects(f, [spawnShip({ resources: { power: Number.MAX_SAFE_INTEGER } })]), /quantity/);
  assert.deepEqual(f.state, before);
  const op = operationFixture([spawnShip()]);
  op.registry.executeAction("scanSignal", { spec: shipSpec({ displayName: "Injected" }) });
  assert.equal(op.state.entities.gen_ship_1.displayName, null);
});

test("dialogue spawn aliases use the captured source and speaker after relocation", () => {
  const f = dialogueFixture([{ type: "relocate", npcId: "speaker", destinationId: "derelict" },
    { type: "spawnEntity", spec: { type: "npc", definitionId: "merchant", locationId: "current" } },
    spawnShip({ ownerId: "speaker", dockedAtId: "current" })], true);
  choose(f)();
  assert.equal(f.state.npcs.gen_npc_1.locationId, "habitat");
  assert.equal(f.state.entities.gen_ship_2.ownerId, "mira");
  assert.equal(f.state.locations.gen_ship_2.dockedAtId, "habitat");
  assert.equal(f.state.dialogue.active, null);
});

test("activation preserves identity and assets, enforces placement blockers, and rejects terminal entities", () => {
  const f = fixture(), ship = f.spawn(shipSpec({ lifecycle: "inactive", dockedAtId: "supplyPlatform" }));
  const entity = structuredClone(f.state.entities[ship]), cargo = structuredClone(f.state.locations[ship]);
  runEffects(f, [{ type: "activateLocation", targetId: ship, reason: "Commissioned" }]);
  assert.equal(f.state.entities[ship].lifecycle, "active");
  assert.equal(f.state.entities[ship].lifecycleReason, "Commissioned");
  assert.equal(f.state.entities[ship].createdAt, entity.createdAt);
  assert.deepEqual(f.state.locations[ship], cargo);
  assert.throws(() => runEffects(f, [{ type: "activateEntity", targetId: ship }]), /Unsupported/);
  runEffects(f, [{ type: "deactivateEntity", targetId: "oren" }, { type: "activateEntity", targetId: "oren" }]);
  assert.equal(f.state.entities.oren.lifecycle, "active");
  assert.throws(() => runEffects(f, [{ type: "activateEntity", targetId: "player" }]), /Player lifecycle/);
  // Inactive placement targets are rejected even if the saved identity remains valid.
  const effects = compile([{ type: "activateLocation", targetId: ship }]);
  const before = structuredClone(f.state);
  assert.throws(() => f.runtime.applyAction(s => {
    s.entities[ship].lifecycle = "inactive"; s.entities.supplyPlatform.lifecycle = "inactive";
    applyEffects(s, effects, f.effectServices);
  }), /Placement target/);
  assert.deepEqual(f.state, before);
  assert.throws(() => f.runtime.applyAction(s => { s.entities[ship].lifecycle = "retired"; applyEffects(s, effects, f.effectServices); }), /Unsupported/);
});

test("authored inactive defaults apply once to new instances and never reset existing saves", () => {
  const locationSource = structuredClone(locationDefinitions), npcSource = structuredClone(npcDefinitions);
  locationSource.locations.supplyPlatform.initialLifecycle = "inactive";
  npcSource.oren.initialLifecycle = "inactive";
  const f = fixture({ locationSource, npcSource });
  assert.equal(f.state.entities.supplyPlatform.lifecycle, "inactive");
  assert.equal(f.state.entities.oren.lifecycle, "inactive");
  runEffects(f, [{ type: "activateLocation", targetId: "supplyPlatform" }, { type: "activateEntity", targetId: "oren" }]);
  assert.deepEqual(f.reload(f.saved), f.state);
  const legacy = legacyState(f.saved, 7);
  assert.equal(f.reload(legacy).entities.supplyPlatform.lifecycle, "active");
  const existing = fixture(), saved = structuredClone(existing.state);
  assert.equal(f.reload(saved).entities.oren.lifecycle, "active");
  delete saved.entities.oren; delete saved.npcs.oren;
  assert.equal(f.reload(saved).entities.oren.lifecycle, "inactive");
  locationSource.locations.habitat.initialLifecycle = "inactive";
  assert.throws(() => fixture({ locationSource }), /starting site/);
  locationSource.locations.habitat.initialLifecycle = "active"; locationSource.locations.vicinity.initialLifecycle = "inactive";
  assert.throws(() => fixture({ locationSource }), /initial lifecycle/);
  locationSource.locations.vicinity.initialLifecycle = "active"; locationSource.locations.supplyPlatform.initialLifecycle = null;
  assert.throws(() => fixture({ locationSource }), /initial lifecycle/);
  npcSource.oren.initialLifecycle = null;
  assert.throws(() => fixture({ npcSource }), /initial lifecycle/);
});

function rewardSource(rewards = []) {
  const source = structuredClone(researchDefinitions);
  source.hints = []; source.bonusChance = 1; source.methods.bench.cost = { power: 1 };
  source.discoveries = { alpha: { name: "Alpha", description: "A discovery.", families: ["materials"], threshold: 1,
    evidence: [{ id: "metal", samples: { items: ["iron"] }, insight: 1, observation: "An observation.", once: true }], effects: rewards } };
  return source;
}
const experiment = f => f.registry.executeAction("research:experiment", { methodId: "bench", items: ["iron"] });
const stockResearch = f => f.runtime.applyAction(s => { s.locations.habitat.resources.iron = 5; });

test("experimental rewards execute once; generic discovery and reconciliation never replay them", () => {
  const researchSource = rewardSource([spawnShip(), { type: "grantItem", itemId: "electronicParts", amount: 1 }, flag("experimentalReward")]);
  const f = fixture({ researchSource }); stockResearch(f);
  const previewBefore = structuredClone(f.state);
  assert.equal(previewExperiment(f.state, f.research, { methodId: "bench", items: ["iron"] }).reason, "");
  assert.deepEqual(f.state, previewBefore);
  experiment(f);
  assert.equal(f.state.flags.experimentalReward, true);
  assert.equal(f.state.locations.habitat.resources.electronicParts, 1);
  assert.equal(f.state.entityIds.next, 2);
  assert.deepEqual(f.reload(f.saved), f.state);
  const before = structuredClone(f.state);
  assert.throws(() => experiment(f), /no new evidence/); assert.deepEqual(f.state, before);
  const generic = fixture({ researchSource }); stockResearch(generic);
  runEffects(generic, [{ type: "discover", id: "alpha" }]);
  assert.equal(generic.state.flags.experimentalReward, undefined);
  assert.equal(generic.state.entityIds.next, 1);
  assert.equal(generic.state.research.attemptCount, 0);
  assert.deepEqual(generic.reload(generic.saved), generic.state);
});

test("all experiment completions earn rewards in stable ID order without reward cascades", () => {
  const researchSource = rewardSource([{ type: "discover", id: "beta" }, flag("rewardOrder")]);
  const beta = structuredClone(researchSource.discoveries.alpha);
  beta.name = "Beta"; beta.effects = [{ ...flag("rewardOrder"), value: false }, { type: "grantItem", itemId: "electronicParts", amount: 1 }];
  researchSource.discoveries = { beta, alpha: researchSource.discoveries.alpha };
  const f = fixture({ researchSource }); stockResearch(f); experiment(f);
  assert.deepEqual(f.state.research.attempts[0].discoveries, ["alpha", "beta"]);
  assert.equal(f.state.locations.habitat.resources.electronicParts, 1);
  assert.equal(f.state.flags.rewardOrder, false);
  beta.eligibility = { discoveries: ["alpha"] };
  const other = fixture({ researchSource }); stockResearch(other); experiment(other);
  assert.equal(other.state.knowledge.discoveries.beta, true);
  assert.equal(other.state.locations.habitat.resources.electronicParts, 0);
  assert.equal(other.state.flags.rewardOrder, true);
});

test("research reward failures roll back samples, RNG, knowledge, journal, spawns, and progress", () => {
  for (const failure of [{ type: "deactivateEntity", targetId: "habitat" }, { type: "grantItem", itemId: "scrap", amount: 11 }]) {
    const f = fixture({ researchSource: rewardSource([spawnShip(), { type: "grantItem", itemId: "electronicParts", amount: 1 }, flag("partialResearch"), failure]) });
    stockResearch(f); const before = structuredClone(f.state), saved = structuredClone(f.saved);
    assert.throws(() => experiment(f), /Nothing was spent/);
    assert.deepEqual(f.state, before); assert.deepEqual(f.saved, saved);
  }
  const f = fixture({ researchSource: rewardSource([spawnShip(), flag("researchReward")]) }); stockResearch(f);
  const before = structuredClone(f.state); f.failSave(true);
  assert.throws(() => experiment(f), /Save failed/); assert.deepEqual(f.state, before);
});

test("research reward contracts normalize legacy empty rewards and reject mechanical edits", () => {
  const source = rewardSource(), f = fixture({ researchSource: source }); stockResearch(f); experiment(f);
  const saved = structuredClone(f.saved), old = JSON.parse(saved.research.contracts.alpha); delete old.effects;
  saved.research.contracts.alpha = JSON.stringify(old);
  assert.deepEqual(f.reload(saved), f.state);
  const original = structuredClone(saved);
  source.discoveries.alpha.effects = [flag("retroactive")];
  const changed = fixture({ researchSource: source });
  assert.throws(() => changed.reload(saved), /migration/); assert.deepEqual(saved, original);
  const rewarded = fixture({ researchSource: source }); stockResearch(rewarded); experiment(rewarded);
  source.discoveries.alpha.effects = [flag("retroactive"), flag("newReward")];
  const edited = fixture({ researchSource: source });
  assert.throws(() => edited.reload(rewarded.saved), /migration/);
});

test("research effect compilation links references and audits conditional discovery producers", () => {
  assert.throws(() => fixture({ researchSource: rewardSource([{ type: "activateEntity", targetId: "speaker" }]) }), /speaker requires dialogue/);
  assert.throws(() => fixture({ researchSource: rewardSource([{ type: "unknown" }]) }), /unknown effect/);
  assert.throws(() => fixture({ researchSource: rewardSource([spawnShip({ definitionId: "missing" })]) }), /definition/);
  const source = rewardSource([{ type: "discover", id: "rewardClue" }]);
  source.discoveries.alpha.eligibility = { discoveries: ["rewardClue"] };
  const f = fixture({ researchSource: source });
  assert.ok(f.research.catalog.warnings.some(w => w.includes("missing entry route")));
  assert.ok(!f.world.discoveryReferences.granted.includes("rewardClue"));
  delete source.discoveries.alpha.eligibility;
  const beta = structuredClone(source.discoveries.alpha); beta.eligibility = { discoveries: ["rewardClue"] }; beta.effects = [];
  source.discoveries.beta = beta;
  assert.ok(!fixture({ researchSource: source }).research.catalog.warnings.some(w => w.includes("missing entry route")));
});

function inspectionSource(effects = []) {
  const source = structuredClone(locationDefinitions);
  source.locations.habitat.actions.push("inspectSite");
  source.locations.habitat.inspectionEffects = effects;
  source.templates = { freighter: { type: "ship", name: "Freighter", description: "A freighter.", remoteDescription: "A freighter.",
    initialResources: { power: 30 }, initialInfrastructure: { engine: { quantity: 1 }, fabricator: { quantity: 1 } },
    sceneObjects: [{ id: "bridge", name: "Bridge", description: "A bridge.", effects: [{ type: "grantItem", itemId: "iron", amount: 1 }] }] } };
  return source;
}

test("console and scene inspection rewards complete independently and persist without replay", () => {
  const locationSource = inspectionSource([spawnShip(), flag("consoleReward")]);
  locationSource.locations.habitat.sceneObjects.find(object => object.id === "collectors").effects = [{ type: "grantItem", itemId: "iron", amount: 1 }];
  const f = fixture({ locationSource });
  assert.match(f.registry.executeAction("inspectSite").message, /compact industrial habitat/);
  f.registry.executeAction("inspect:habitat:collectors");
  assert.equal(f.state.locations.habitat.flags.consoleExamined, true);
  assert.equal(f.state.locations.habitat.flags["examined:collectors"], true);
  assert.equal(f.state.locations.habitat.resources.iron, 1);
  assert.deepEqual(f.reload(f.saved), f.state);
  assert.equal(f.registry.getActionStatus("inspectSite").visible, false);
  assert.equal(f.registry.getActionStatus("inspect:habitat:collectors").visible, false);
  const before = structuredClone(f.state); startupMessages(f.state, f.world, f.content); assert.deepEqual(f.state, before);
  locationSource.locations.habitat.inspectionEffects = [flag("newConsoleReward")];
  const edited = fixture({ locationSource }), loaded = edited.reload(f.saved);
  assert.equal(loaded.flags.newConsoleReward, undefined); assert.equal(loaded.entityIds.next, f.state.entityIds.next);
});

test("inspection rewards use per-instance completion and inherited arrays replace rather than concatenate", () => {
  const source = inspectionSource();
  source.types.ship.sceneObjects = [{ id: "bridge", name: "Old bridge", description: "An old bridge.", effects: [flag("inherited")] }];
  source.types.ship.inspectionEffects = [flag("oldConsole")];
  source.templates.freighter.inspectionEffects = [flag("newConsole")];
  const f = fixture({ locationSource: source });
  const first = f.spawn(shipSpec()), second = f.spawn(shipSpec());
  f.registry.executeAction(`board:${first}`); f.registry.executeAction(`inspect:${first}:bridge`);
  assert.equal(f.state.locations[first].resources.iron, 1);
  assert.equal(f.state.locations[second].resources.iron, 0);
  assert.equal(f.state.flags.inherited, undefined);
  assert.equal(f.world.definitions.freighter.inspectionEffects.length, 1);
  assert.equal(f.world.definitions.freighter.inspectionEffects[0].flag, "newConsole");
  f.registry.executeAction("disembark:habitat"); f.registry.executeAction(`board:${second}`);
  assert.equal(f.registry.getActionStatus(`inspect:${second}:bridge`).available, true);
  f.registry.executeAction(`inspect:${second}:bridge`);
  assert.deepEqual(f.reload(f.saved), f.state);
});

test("inspection failure rolls back spawns, rewards, and completion flags", () => {
  for (const scene of [false, true]) {
    const effects = [spawnShip(), { type: "grantItem", itemId: "iron", amount: 1 }, flag("partialInspection"), { type: "deactivateEntity", targetId: "current" }];
    const locationSource = inspectionSource(scene ? [] : effects);
    if (scene) locationSource.locations.habitat.sceneObjects.find(object => object.id === "collectors").effects = effects;
    const f = fixture({ locationSource }), before = structuredClone(f.state);
    assert.throws(() => f.registry.executeAction(scene ? "inspect:habitat:collectors" : "inspectSite"), /must be resolved/);
    assert.deepEqual(f.state, before);
    assert.equal(f.saved, undefined);
  }
  const f = fixture({ locationSource: inspectionSource([flag("inspectionReward")]) }); f.failSave(true);
  const before = structuredClone(f.state);
  assert.throws(() => f.registry.executeAction("inspectSite"), /Save failed/); assert.deepEqual(f.state, before);
});

test("location effect sources compile unknown types, inappropriate aliases, and late NPC references", () => {
  for (const effect of [{ type: "unknown" }, { type: "deactivateEntity", targetId: "speaker" }, { type: "activateEntity", targetId: "missingNpc" }])
    assert.throws(() => fixture({ locationSource: inspectionSource([effect]) }));
  const f = fixture({ locationSource: inspectionSource([{ type: "discover", id: "inspectionClue" }, { type: "deactivateEntity", targetId: "oren" }]) });
  assert.ok(f.world.discoveryReferences.granted.includes("inspectionClue"));
  assert.ok(f.world.entityReferences.some(r => r.targetId === "oren"));
  f.registry.executeAction("inspectSite"); assert.equal(f.state.entities.oren.lifecycle, "inactive");
});
