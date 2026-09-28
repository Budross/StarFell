import { legacyState, withoutLocalOwners } from "./legacyState.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { content } from "../js/content.js";
import { defaultWorld, createInitialState, migrateState, validateState } from "../js/state.js";
import { npcDefinitions } from "../js/npcContent.js";
import { dialogueDefinitions } from "../js/dialogueContent.js";
import { buildPeopleSystem } from "../js/peopleSystem.js";
import { performDialogue, dialogueView, resolveTopics, isCompleted, reconcileContact, explainTopics } from "../js/dialogue.js";
import { npcVisible, contactReason } from "../js/npcs.js";
import { conditionReason, validateConditions } from "../js/conditions.js";
import { locationDefinitions } from "../js/locationContent.js";
import { buildLocationCatalog } from "../js/locations.js";
import { createItemActions } from "../js/itemActions.js";
import { navigate, advanceJourneys } from "../js/ships.js";
import { effectServicesFor as createEffectServices } from "./worldLedgerFixtures.mjs";

function fixture(edit = () => {}, world = defaultWorld) {
  const npcs = structuredClone(npcDefinitions), dialogue = structuredClone(dialogueDefinitions);
  edit(npcs, dialogue);
  const system = buildPeopleSystem(content, world, npcs, dialogue);
  const effectServices = createEffectServices({ content, world, people: system });
  let state = createInitialState(content, world, system), failSave = false;
  return { system, get state() { return state; }, set state(value) { state = value; },
    set failSave(value) { failSave = value; },
    act(operation, payload = {}) {
      const draft = structuredClone(state);
      const token = state.dialogue.active ? { sessionId: state.dialogue.active.sessionId, revision: state.dialogue.active.revision } : {};
      const result = performDialogue(draft, operation, { ...token, ...payload }, system, effectServices);
      reconcileContact(draft, system); validateState(draft, content, world, system);
      if (failSave) throw new Error("Save failure");
      state = draft; return result;
    },
    start(npcId = "mira") { this.act("start", { npcId }); this.act("topics"); }
  };
}

test("new NPC content supplies groups without engine registration and has private independent inventory", () => {
  const f = fixture(npcs => { npcs.tess = { ...structuredClone(npcs.mira), name: "Tess", dialogueGroups: ["habitatCrew"] }; });
  assert.equal(npcVisible(f.state, "tess", f.system), true);
  f.state.npcs.tess.inventory.scrap = 10000;
  assert.equal(f.state.npcs.mira.inventory.scrap, 40000);
  assert.equal(f.state.locations.habitat.resources.scrap, 0);
  f.start("tess"); assert.equal(dialogueView(f.state, f.system).choices.length, 1);
});

test("local contact requires exact site and no site ownership", () => {
  const f = fixture(); f.state.entities.habitat.ownerId = null;
  assert.equal(contactReason(f.state, "mira", f.system), "");
  f.state.locationId = "supplyPlatform";
  assert.match(contactReason(f.state, "mira", f.system), /no longer/);
  assert.throws(() => f.act("start", { npcId: "mira" }), /no longer/);
});

test("shared greetings remember each NPC separately and groups deduplicate", () => {
  const f = fixture((n, d) => { d.groups.extra = { conversations: ["crewGreeting", "habitatLife"] }; n.mira.dialogueGroups.push("extra"); });
  f.start(); assert.equal(isCompleted(f.state, f.system, "crewGreeting", "mira"), true);
  assert.equal(resolveTopics(f.state, "mira", f.system).filter(c => c.id === "habitatLife").length, 1);
  f.act("leave"); f.act("start", { npcId: "oren" });
  assert.equal(f.state.dialogue.active.conversationId, "crewGreeting");
  f.act("leave"); f.act("start", { npcId: "mira" });
  assert.equal(f.state.dialogue.active.phase, "topics");
});

test("acceptance does not invalidate active branch; remote generated flag unlocks report and lasting outcomes", () => {
  const f = fixture(); f.start(); f.act("topic", { id: "miraRequest" }); f.act("choice", { id: "accept" });
  assert.equal(f.state.dialogue.active.nodeId, "accepted");
  const saved = structuredClone(f.state);
  f.state = migrateState(saved, content, defaultWorld, f.system);
  assert.equal(f.state.dialogue.active.nodeId, "accepted");
  f.act("topics");
  f.state.locations.habitat.flags["examined:manifest"] = true;
  assert.throws(() => f.act("topic", { id: "miraFollowup" }), /Inspect/);
  f.state.locations.derelict.flags["examined:manifest"] = true;
  f.act("topic", { id: "miraFollowup" }); f.act("choice", { id: "report" });
  assert.equal(f.state.flags.relayMysteryKnown, true);
  assert.equal(f.state.npcs.mira.flags.requestCompleted, true);
  assert.equal(f.state.npcs.oren.flags.requestCompleted, undefined);
  assert.equal(f.state.npcs.mira.inventory.scrap, 40000);
});

test("declining has lasting consequences without accepting or granting items", () => {
  const f = fixture(); f.start("oren"); f.act("topic", { id: "orenRequest" }); f.act("choice", { id: "decline" }); f.act("topics");
  assert.equal(f.state.npcs.oren.flags.requestDeclined, true);
  assert.equal(resolveTopics(f.state, "oren", f.system).some(c => c.topicId === "collectorRequest"), false);
});

test("terminal relocation has a visible farewell, no lost next node and complete rollback on failed save", () => {
  const f = fixture(); f.state.npcs.mira.flags.requestCompleted = true;
  f.start(); f.act("topic", { id: "miraDeparture" });
  const before = structuredClone(f.state); f.failSave = true;
  assert.throws(() => f.act("choice", { id: "agree" }), /Save failure/); assert.deepEqual(f.state, before);
  f.failSave = false;
  assert.match(f.act("choice", { id: "agree" }), /Mira:.*meet you/);
  assert.equal(f.state.npcs.mira.locationId, "derelict"); assert.equal(f.state.dialogue.active, null);
  assert.equal(isCompleted(f.state, f.system, "miraDeparture", "mira"), true);
});

test("relocating speaker through shared or explicit binding cannot have a destination node", () => {
  for (const target of ["speaker", "mira"]) assert.throws(() => fixture((n, d) => {
    const c = d.conversations.miraIntroduction.nodes.intro.choices[0];
    c.effects = [{ type: "relocate", npcId: target, destinationId: "derelict" }];
  }), /contact change must be terminal/);
});

test("presence derives from flags; indirect disappearance closes without showing the next passage", () => {
  const f = fixture((n, d) => {
    n.mira.presenceConditions = { not: { npcFlags: { speaker: ["hiding"] } } };
    d.conversations.miraIntroduction.nodes.intro.choices[0].effects = [{ type: "setFlag", scope: "npc", target: "speaker", flag: "hiding", value: true }];
  });
  f.start(); f.act("topic", { id: "miraIntroduction" });
  assert.match(f.act("choice", { id: "shutdown" }), /contact was lost/);
  assert.equal(f.state.dialogue.active, null); assert.equal(npcVisible(f.state, "mira", f.system), false);
  f.state.npcs.mira.flags.hiding = false; assert.equal(npcVisible(f.state, "mira", f.system), true);
});

test("stale choice token including a loop to the same node cannot execute twice", () => {
  const f = fixture((n, d) => { d.conversations.miraIntroduction.nodes.intro.choices[0].destinationNode = "intro"; });
  f.start(); f.act("topic", { id: "miraIntroduction" });
  const token = dialogueView(f.state, f.system).token;
  f.act("choice", { ...token, id: "shutdown" });
  const before = structuredClone(f.state);
  assert.throws(() => f.act("choice", { ...token, id: "shutdown" }), /has changed/);
  assert.deepEqual(f.state, before);
});

test("live hidden and blocked choices reject direct execution; empty nodes still allow leave", () => {
  const f = fixture((n, d) => {
    const choices = d.conversations.miraIntroduction.nodes.intro.choices;
    choices[0].visibilityConditions = { flags: ["secret"] };
    choices[1].requirements = { not: { flags: ["finished"] } }; choices[1].blockedReason = "Already finished.";
  });
  f.start(); f.act("topic", { id: "miraIntroduction" }); f.state.flags.finished = true;
  assert.throws(() => f.act("choice", { id: "shutdown" }), /no longer/);
  assert.throws(() => f.act("choice", { id: "thanks" }), /Already finished/);
  f.act("topics"); assert.equal(isCompleted(f.state, f.system, "miraIntroduction", "mira"), false);
  f.act("leave"); assert.equal(f.state.dialogue.active, null);
});

test("compound checks, colon keys, targeting, and blocked explanations validate", () => {
  const f = fixture(); const ctx = f.system.context(f.state, "mira");
  validateConditions({ locationFlags: { derelict: ["examined:manifest"] } }, { world: defaultWorld });
  assert.throws(() => validateConditions({ locationFlags: { missing: ["examined:manifest"] } }, { world: defaultWorld }), /unknown target/);
  assert.throws(() => validateConditions({ all: [] }), /needs children/);
  assert.throws(() => validateConditions({ flags: ["__proto__"] }), /invalid/);
  assert.equal(conditionReason(ctx.local, { not: { flags: ["missing"] } }, content, ctx), "");
  assert.equal(conditionReason(ctx.local, { any: [{ flags: ["missing"] }, {}] }, content, ctx), "");
  assert.throws(() => fixture((n, d) => { d.conversations.miraIntroduction.requirements = { not: { flags: ["done"] } }; }), /blockedReason/);
});

test("priority only competes within topic; blocked winner does not fall through; explanation remains available to authors", () => {
  const f = fixture((n, d) => {
    d.conversations.high = { ...structuredClone(d.conversations.habitatLife), priority: 20, requirements: { flags: ["ready"] }, blockedReason: "Not ready." };
    d.groups.habitatCrew.conversations.push("high");
  });
  const topics = resolveTopics(f.state, "mira", f.system);
  assert.equal(topics.find(c => c.topicId === "habitatLife").id, "high");
  assert.equal(topics.find(c => c.id === "high").reason, "Not ready.");
  assert.ok(topics.some(c => c.id === "miraIntroduction"));
  assert.match(explainTopics(f.state, "mira", f.system).find(c => c.id === "habitatLife").reason, /priority/);
});

test("global and NPC-location histories use the declared scope", () => {
  const f = fixture((n, d) => { d.conversations.crewGreeting.scope = "global"; d.conversations.habitatLife.scope = "npcLocation"; d.conversations.habitatLife.repeat = "once"; });
  f.start(); f.act("topic", { id: "habitatLife" }); f.act("leave");
  f.act("start", { npcId: "oren" }); assert.equal(f.state.dialogue.active.phase, "topics"); f.act("leave");
  f.state.locationId = "derelict"; f.state.npcs.mira.locationId = "derelict"; f.start();
  assert.ok(resolveTopics(f.state, "mira", f.system).some(c => c.id === "habitatLife"));
});

test("version-four migration and current-version NPC additions initialize once and preserve inventory", () => {
  const f = fixture(); const old = legacyState(f.state, 4); delete old.npcs; delete old.dialogue;
  const migrated = migrateState(old, content, defaultWorld, f.system);
  assert.equal(migrated.saveVersion, 9); assert.deepEqual(migrated.locations, withoutLocalOwners(old.locations));
  migrated.npcs.mira.inventory.scrap = 10000;
  const updated = fixture(n => { n.mira.initialInventory.scrap = 0.08; n.newcomer = { ...structuredClone(n.oren), name: "Newcomer" }; });
  const next = migrateState(migrated, content, defaultWorld, updated.system);
  assert.equal(next.npcs.mira.inventory.scrap, 10000); assert.ok(next.npcs.newcomer);
  assert.deepEqual(migrateState(next, content, defaultWorld, updated.system), next);
});

test("retired active nodes or assignments recover every load without wiping history; malformed records do not", () => {
  const f = fixture(); f.start(); f.act("topic", { id: "miraIntroduction" }); f.act("choice", { id: "shutdown" });
  const saved = structuredClone(f.state);
  const updated = fixture((n, d) => { n.mira.excludeConversations = ["miraIntroduction"]; });
  const notices = [], recovered = migrateState(saved, content, defaultWorld, updated.system, notices);
  assert.equal(recovered.dialogue.active, null); assert.deepEqual(recovered.dialogue.history, saved.dialogue.history); assert.equal(notices.length, 1);
  const retiredNode = fixture((n, d) => {
    d.conversations.miraIntroduction.nodes.intro.choices[0].destinationNode = "thanks";
    delete d.conversations.miraIntroduction.nodes.shutdown;
  });
  const restored = migrateState(saved, content, defaultWorld, retiredNode.system);
  assert.equal(restored.dialogue.active, null); assert.deepEqual(restored.dialogue.history, saved.dialogue.history);
  const bad = structuredClone(saved); bad.dialogue.active.revision = -1;
  assert.throws(() => migrateState(bad, content, defaultWorld, updated.system), /active session/);
  bad.dialogue.active = null; bad.npcs.mira.inventory.scrap = -1;
  assert.throws(() => migrateState(bad, content, defaultWorld, updated.system), /inventory/);
});

test("ship passengers retain local dialogue through arrival, then disembarking breaks contact", () => {
  const locations = structuredClone(locationDefinitions);
  locations.locations.courier = { name: "Courier", type: "ship", areaId: "vicinity", initialDockedAtId: "habitat", description: "Ship", remoteDescription: "Ship", initialResources: { power: 10 }, initialInfrastructure: { engine: { quantity: 1 } } };
  const world = buildLocationCatalog(locations, content, createItemActions(content));
  const f = fixture(n => { n.mira.initialLocationId = "courier"; }, world);
  assert.match(contactReason(f.state, "mira", f.system), /no longer/);
  navigate(f.state, "board", "courier", world, content); f.start();
  navigate(f.state, "undock", undefined, world, content); navigate(f.state, "dock", "supplyPlatform", world, content);
  advanceJourneys(f.state, 100, world); assert.equal(reconcileContact(f.state, f.system), "");
  validateState(f.state, content, world, f.system);
  navigate(f.state, "disembark", "supplyPlatform", world, content);
  assert.match(reconcileContact(f.state, f.system), /contact was lost/);
  assert.equal(f.state.npcs.mira.locationId, "courier");
});

test("catalog rejects broken references, effects, inventory and unsupported authoring", () => {
  for (const edit of [
    n => { n.mira.initialLocationId = "vicinity"; },
    n => { n.mira.dialogueGroups.push("missing"); },
    n => { n.mira.initialInventory.scrap = 99; },
    (n, d) => { d.conversations.miraIntroduction.nodes.intro.choices[0].destinationNode = "missing"; },
    (n, d) => { d.conversations.miraIntroduction.nodes.intro.choices[0].effects = [{ type: "giveItems" }]; },
    (n, d) => { d.conversations.miraIntroduction.topicId = undefined; }
  ]) assert.throws(() => fixture(edit), /Invalid/);
});
