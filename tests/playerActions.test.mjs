import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import initializePlayerActions, { registerAction, getActions, getActionStatus, resolveAction, executeAction } from "../js/playerActions.js";
import { registerItemActions } from "../js/itemActions.js";
import { content } from "../js/content.js";
import { createInitialState, validateState, defaultWorld } from "../js/state.js";
import { buildGameSystems } from '../js/bootstrap.js';
import { createProcessingActions } from '../js/processingActions.js';
import { grantOpeningKnowledge } from "./researchFixtures.mjs";
import { effectServicesFor as createEffectServices } from "./worldLedgerFixtures.mjs";

import { getLocationContext, validateActionScopes, createLocationActions } from "../js/locations.js";
let state;
let saved;
let failSave;
registerItemActions(content, createEffectServices({ content, world: defaultWorld }));
createLocationActions(defaultWorld, content).forEach(registerAction);
createProcessingActions(buildGameSystems().processing).forEach(registerAction);

test("definitions register before initialization, but cannot execute yet", () => {
  assert.equal(resolveAction("salvage"), "salvage");
  assert.throws(() => executeAction("salvage"), /not been initialized/);
  initializePlayerActions({ getState: () => state, getContext: s => getLocationContext(s, content, defaultWorld), validateActions: actions => validateActionScopes(actions, defaultWorld), applyAction(execute) {
    const candidate = structuredClone(state);
    const message = execute(candidate);
    validateState(candidate, content);
    if (failSave) throw new Error("Save failed");
    saved = JSON.stringify(candidate);
    state = candidate;
    return message;
  } });
});
beforeEach(() => { state = grantOpeningKnowledge(createInitialState()); saved = JSON.stringify(state); failSave = false; });

test("starting directives preserve shortcuts and include generated gathering", () => {
  assert.deepEqual(getActions().filter(action => action.visible && action.group === "directives").map(action => action.id),
    ["inspect:habitat:reactionWreckage", "inspect:habitat:collectors", "inspect:habitat:fitting", "inspect:habitat:solarHardware", "salvage", "refineScrap", "repairSolar", "gatherElectronics", "gatherMinerals"]);
  assert.equal(getActionStatus("salvage").available, true);
  assert.match(getActionStatus("refineScrap").reason, /Requires 0.04 m³ metal scrap/);
  assert.match(getActionStatus("repairSolar").reason, /Requires 2 iron structural parts/);
});

test("registered IDs, names, aliases, and fixed shortcuts resolve", () => {
  for (const command of ["refineScrap", "REFINE SCRAP", " refine ", "[2]", "2"]) assert.equal(resolveAction(command), "refineScrap");
  assert.equal(resolveAction("unknown"), null);
  assert.throws(() => executeAction("unknown"), /Unknown action/);
});

test("a fresh opening preserves refine and repair commands but explains their knowledge gates", () => {
  state = createInitialState();
  for (const id of ["refineScrap", "repairSolar"]) {
    assert.equal(getActionStatus(id).visible, true);
    assert.equal(getActionStatus(id).available, false);
    assert.match(getActionStatus(id).reason, /Research/);
    assert.throws(() => executeAction(id), /Research/);
  }
  assert.equal(resolveAction("2"), "refineScrap");
  assert.equal(resolveAction("3"), "repairSolar");
});

test("salvage and refine update current state after replacement", () => {
  const original = state;
  for (let i = 0; i < 4; i++) executeAction("salvage");
  assert.notEqual(state, original);
  assert.equal(original.locations.habitat.resources.scrap, 0);
  assert.equal(getActionStatus("refineScrap").available, true);
  assert.match(executeAction("refineScrap"), /Created 1 iron structural parts/);
  assert.equal(state.locations.habitat.resources.scrap, 0);
  assert.equal(state.locations.habitat.resources.iron, 1);
  assert.equal(getActionStatus("refineScrap").available, false);
  assert.deepEqual(JSON.parse(saved), state);
});

test("requirements are rechecked against current state", () => {
  state.locations.habitat.resources.iron = 2;
  assert.equal(getActionStatus("repairSolar").available, true);
  state.locations.habitat.resources.iron = 1;
  const before = JSON.stringify(state);
  assert.throws(() => executeAction("repairSolar"), /Requires 2 iron structural parts/);
  assert.equal(JSON.stringify(state), before);
});

test("repair uses components and completed commands cannot run again", () => {
  state.locations.habitat.resources.iron = 3;
  assert.match(executeAction("repairSolar"), /fully operational/);
  assert.equal(state.locations.habitat.resources.iron, 1);
  assert.equal(state.locations.habitat.infrastructure.solar.health, 1);
  assert.equal(getActionStatus("repairSolar").visible, false);
  assert.throws(() => executeAction("repairSolar"), /not available/);
  assert.equal(getActionStatus("refineScrap").shortcut, "2");
});

test("full storage blocks transfers without losing resources", () => {
  state.locations.habitat.resources.scrap = 10000000;
  assert.throws(() => executeAction("salvage"), /Make room/);
  state.locations.habitat.resources.scrap = 40000;
  state.locations.habitat.resources.iron = 30;
  executeAction("refineScrap"); // Cross-item consumption frees room even in a full/overloaded hold.
  assert.equal(state.locations.habitat.resources.scrap, 0);
});

test("save failure rolls back crafting, installation, operations, and selections", () => {
  state.locations.habitat.resources.scrap = 40000;
  state.locations.habitat.resources.solarPanel = 1;
  state.locations.habitat.infrastructure.installedAntenna.quantity = 1;
  const original = state;
  const before = JSON.stringify(state);
  failSave = true;
  for (const id of ["refineScrap", "install:solarPanel", "scanSignal", "selectRecipe:solarPanel:assemble"]) {
    assert.throws(() => executeAction(id), /Save failed/);
    assert.equal(state, original);
    assert.equal(JSON.stringify(state), before);
  }
});

test("draft selection and crafting share the registry transaction", () => {
  state.locations.habitat.resources.iron = 1;
  state.locations.habitat.resources.conductiveParts = 1;
  state.locations.habitat.resources.electronicParts = 1;
  executeAction("selectRecipe:radioAntenna:assemble");
  executeAction("selectIngredient:radioAntenna:assemble:wiring:conductiveParts");
  assert.equal(resolveAction("craft"), "craftSelected");
  executeAction("craftSelected");
  executeAction("install:radioAntenna");
  executeAction("scanSignal");
  assert.equal(state.locations.habitat.resources.radioAntenna, 0);
  assert.equal(state.locations.habitat.infrastructure.installedAntenna.quantity, 1);
  assert.equal(state.flags.localSignalObserved, true);
  assert.equal(state.locations.habitat.resources.power, 7);
  assert.throws(() => executeAction("scanSignal"), /not available/);
});

test("a later action can use saved flags", () => {
  registerAction({ id: "testExplore", name: "Explore test wreck", scope: "global", order: 5,
    visible: state => state.flags.wreckDiscovered === true,
    execute(state) { state.locationId = "derelict"; return "Entered wreck."; } });
  assert.equal(getActionStatus("testExplore").visible, false);
  state.flags.wreckDiscovered = true;
  executeAction("testExplore");
  assert.equal(state.locationId, "derelict");
  assert.equal(getActionStatus("salvage").visible, false);
});

test("duplicate IDs and conflicting commands are rejected", () => {
  assert.throws(() => registerAction({ id: "salvage", name: "Duplicate", execute() {} }), /already registered/);
  assert.throws(() => registerAction({ id: "collision", name: "Collision", scope: "global", aliases: ["refine"], execute() {} }), /conflicting command/);
  assert.equal(resolveAction("collision"), null);
});

test("failed or invalid action effects never reach current state", () => {
  registerAction({ id: "throws", name: "Throws", scope: "global", execute(state) { state.locations.habitat.resources.scrap = 100000; throw new Error("Effect failed"); } });
  registerAction({ id: "invalidState", name: "Invalid state", scope: "global", execute(state) { state.locations.habitat.resources.scrap = -1; } });
  const original = state;
  assert.throws(() => executeAction("throws"), /Effect failed/);
  assert.throws(() => executeAction("invalidState"), /Invalid scrap/);
  assert.equal(state, original);
});
