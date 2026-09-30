import { locationDefinition, getEntityLabel } from "./entityQueries.js";
import { buildGameSystems } from "./bootstrap.js";
import { createGameRuntime } from "./runtime.js";
import { createView } from "./game.js";
import { createActionRegistry } from "./playerActions.js";
import playerActionsDisplay from "./playerActionsDisplay.js";
import { describeAmounts } from "./resources.js";
import craftingDisplay from "./craftingDisplay.js";
import processingDisplay from './processingDisplay.js';
import { clearGame, loadGame, saveGame } from "./save.js";
import cargoDisplay from "./cargoDisplay.js";
import { CircularProgress } from "./CircularProgress.js";
import initializeEventBus, { startEventBus } from "./eventBus.js";
import consoleDisplay from "./consoleDisplay.js?v=narrative-receipts-1";
import terminalTabs from "./terminalTabs.js";
import locationDisplay from "./locationDisplay.js";
import transferDisplay from "./transferDisplay.js";
import { validateActionScopes, startupMessages } from "./locations.js";
import { shipGraphView, shipStatus } from "./ships.js";
import { WattmeterWidget } from "./wattmeter-widget.js";
import dialogueDisplay from "./dialogueDisplay.js";
import researchDisplay from "./research/researchDisplay.js";
import { createNarrativePresentation } from './narrativePresentation.js';
import { equipmentObservationActions } from './narrativeActions.js';
import shipyardDisplay from './shipyardDisplay.js';
import vesselControlsDisplay from './vesselControlsDisplay.js';
import createUiTour from './uiTour.js';
import { firstRunMessages } from './streamContent.js';

const systems = buildGameSystems();
const { content, world, people, research, actions, contextFor } = systems;
const { createInitialState, migrateState, validateState } = systems.stateServices;
const actionRegistry = createActionRegistry();
const { executeAction, resolveAction } = actionRegistry;
export { executeAction };
research.catalog.warnings.forEach(message => console.warn(message));
people.dialogue.warnings.forEach(message => console.warn(message));

const elements = {
  power: document.querySelector("#power"),
  powerCapacity: document.querySelector("#power-capacity"),
  powerRate: document.querySelector("#power-rate"),
  activeTime: document.querySelector("#active-time"),
  solarHealth: document.querySelector("#solar-health"),
  commandInput: document.querySelector("#command-input"),
  commandForm: document.querySelector("#command-form"),
  feedback: document.querySelector("#terminal-feedback"),
  alertState: document.querySelector("#alert-state"),
  alertStatus: document.querySelector("#alert-status"),
  busStatus: document.querySelector("#bus-status"),
  reserveStatus: document.querySelector("#reserve-status"),
  solarMeter: document.querySelector("#solar-meter"),
  solarStatus: document.querySelector("#solar-status")
};


const bus = initializeEventBus({
  author: null,
  type: null,
  text: null
});

// Register initial subscribers before queued messages are released.
const logDisplay = consoleDisplay(bus, "#narrative-stream", (itemId, amount) => describeAmounts({ [itemId]: amount }, content));
const tabs = terminalTabs({
  tabList: document.querySelector("#terminal-tabs"),
  panelContainer: document.querySelector("#terminal-panels")
});
tabs.registerTab({
  id: "operations", label: "Operations", panel: document.querySelector("#operations-panel"),
  onActivate() {
    logDisplay.onActivate();
    const button=document.querySelector('#terminal-tab-operations');
    button.classList.remove('has-updates'); button.setAttribute('aria-label','Operations');
    // The visible log announces results here; avoid duplicate announcements.
    elements.feedback.setAttribute("aria-live", "off");
  },
  onDeactivate() {
    stopRepeating();
    logDisplay.onDeactivate();
    elements.feedback.setAttribute("aria-live", "polite");
  }
});
tabs.registerTab({ id: "workshop", label: "Workshop", panel: document.querySelector("#workshop-panel") });
tabs.registerTab({ id: "locations", label: "Locations", panel: document.querySelector("#locations-panel") });
tabs.registerTab({ id: "people", label: "People", panel: document.querySelector("#people-panel"),
  onActivate() { elements.feedback.setAttribute("aria-live", "off"); },
  onDeactivate() { elements.feedback.setAttribute("aria-live", "polite"); }
});
tabs.registerTab({ id: "research", label: "Research", panel: document.querySelector("#research-panel") });
tabs.registerTab({ id: "knowledge", label: "Knowledge", panel: document.querySelector("#knowledge-panel") });
tabs.registerTab({ id: "shipyard", label: "Shipyard", panel: document.querySelector("#shipyard-panel") });
tabs.activateTab("operations");
createUiTour(tabs);
bus.subscribe({}, message => {
  if (!["system", "error", "narrative"].includes(message.type)) return;
  elements.feedback.textContent = message.text;
  elements.feedback.classList.toggle("error", message.type === "error");
});

startEventBus();

const progressBarPower = new CircularProgress("#progress-holderPower", {
  
  saturation: 27,
  hueStart: 85,
  hueEnd: 105,
  lightness: 63,
  glow: false
  
});

// Let the instrument module size the reserve display, including on mobile.
progressBarPower.el.style.width = "";
progressBarPower.el.style.height = "";
progressBarPower.el.style.display = "";

let wattmeterWidget = null;
let lastWattmeterSample = -Infinity;
let lastPowerRate = null;
let displayedLocationId = null;
let displayedAssetAccess = null;
let migrationNotice = "";
let freshGame = false;
let resettingGame = false;

const runtime = createGameRuntime({ ...systems, initialState: loadOrCreateGame(), save: saveGame });
const narrativePresentation=createNarrativePresentation(systems.narrative);
const openingState = runtime.getState();
const tutorials=freshGame ? firstRunMessages() : startupMessages(openingState,world,content);
if (!freshGame) safeNarrative(()=>systems.narrative.describe(openingState,{surface:'inspect_location',subjectId:openingState.locationId},
  {suppressTopics:tutorials.length?['equipment_condition']:[]}),false);
if (migrationNotice) bus.publish({ author: "SYSTEM", type: "system", text: migrationNotice });
if (locationDefinition(openingState, world, openingState.locationId).mobile) bus.publish({ author: "SYSTEM", type: "system", text: shipStatus(openingState, world) });
for (const text of tutorials) {
  bus.publish({ author: "SYSTEM", type: "narrative", text });
}
if (freshGame) document.querySelector('#narrative-stream').scrollTop = 0;
let previousFrameTime = null;

actions.forEach(actionRegistry.registerAction);
actionRegistry.initialize({ getState: runtime.getState, applyAction, getContext: contextFor, validateActions: actions => {
  validateActionScopes(actions, world);
  if (actions.some(a => [a.id, a.name, ...(a.aliases ?? [])].some(name => ["talk", "people", "research", "look", "observe"].includes(name.trim().toLowerCase())))) throw new Error("talk, people, research, look, and observe are reserved presentation commands.");
} });
let observationActions=[];
const renderActions = playerActionsDisplay(id => handleAction(id, undefined, true), "#player-actions",group=>[
  ...actionRegistry.getActions(group), ...(group==='directives'?observationActions:[])
]);
let selectedGathering = null;
let repeatTimer = null;
let lastGatheringActionId = null;
function stopRepeating(clearSelection = true) {
  if (repeatTimer !== null) clearInterval(repeatTimer);
  repeatTimer = null;
  if (clearSelection) selectedGathering = null;
  renderActions.setRepeatState(selectedGathering, false);
}
function toggleRepeating() {
  if (!selectedGathering) return;
  if (repeatTimer !== null) { stopRepeating(false); return; }
  if (!actionRegistry.getActionStatus(selectedGathering).available) { stopRepeating(); return; }
  renderActions.setRepeatState(selectedGathering, true);
  repeatTimer = setInterval(() => {
    if (document.hidden || document.querySelector('#operations-panel').hidden ||
        !actionRegistry.getActionStatus(selectedGathering).available) { stopRepeating(); return; }
    if (!handleAction(selectedGathering).ok) stopRepeating();
  }, 1000);
}
const renderCrafting = craftingDisplay(content, handleAction, actionRegistry.getActionStatus);
const renderProcessing = processingDisplay(systems.processing,handleAction);
const renderTransfer = transferDisplay(world, content, handleAction);
const renderCargo = cargoDisplay(world, content, handleAction);
const renderLocations = locationDisplay(world, content, handleAction, shipGraphView, shipStatus, actionRegistry.getActionStatus, (state, id) => getEntityLabel(state, systems, id));
const renderPeople = dialogueDisplay(people, handleAction, () => tabs.activateTab("people"));
const renderResearch = researchDisplay(research, handleAction, () => tabs.activateTab("research"));
const renderShipyard = shipyardDisplay(systems, handleAction);
const renderVesselControls = vesselControlsDisplay(systems, handleAction);

function loadOrCreateGame() {
  try {
    const saved = loadGame();
    freshGame = saved === null;
    const notices = [];
    const loaded = saved === null ? createInitialState(crypto.getRandomValues(new Uint32Array(1))[0]) : migrateState(saved, notices);
    validateState(loaded);
    if (saved && saved.saveVersion !== loaded.saveVersion) saveGame(loaded);
    if (saved && saved.locationId !== loaded.locationId) migrationNotice = `Save updated: your former area position is now ${locationDefinition(loaded, world, loaded.locationId).name}. Assets and progress were preserved.`;
    migrationNotice = [migrationNotice, ...notices].filter(Boolean).join(" ");
    return loaded;
  } catch (error) {
    console.error("Could not load the save:", error);
    bus.publish({ author: "SYSTEM", type: "error", text: "Your saved game could not be loaded. It has been preserved. " + error.message });
    elements.commandInput.disabled = true;
    elements.commandForm.querySelector("button").disabled = true;
    throw error;
  }
}

function format(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function capacityPercentage(value, maximum) {
  return maximum > 0 ? (value / maximum) * 100 : 0;
}

function formatCycle(seconds) {
  const whole = Math.floor(seconds);
  return [Math.floor(whole / 3600), Math.floor(whole / 60) % 60, whole % 60]
    .map(value => String(value).padStart(2, "0")).join(":");
}

function showFeedback(text, type = "system", gathering = null) {
  bus.publish({
    author: type === "command" ? "PLAYER" : "SYSTEM",
    type,
    text,
    gathering,
    cycle: formatCycle(runtime.getState().simulationTime)
  });
}

function revealNarrativeReceipt() {
  tabs.activateTab('operations');
  if (typeof logDisplay.revealLatest === 'function') {
    logDisplay.revealLatest();
    return;
  }
  // Older cached displays support tab activation but predate receipt reveal.
  // Keep the requested receipt visible even when frontend versions are mixed.
  const stream=document.querySelector('#narrative-stream');
  const latest=stream?.querySelector('.log-entry:last-of-type');
  if (latest) stream.scrollTop+=latest.getBoundingClientRect().top-stream.getBoundingClientRect().top;
}

// Presentation failures never roll back committed gameplay or pause simulation.
function safeNarrative(describe,reveal=false) {
  try {
    const result=describe();
    if (result?.status==='ok' && result.text) {
      showFeedback(result.text,'narrative');
      if (reveal) revealNarrativeReceipt();
      else if (document.querySelector('#operations-panel').hidden) {
        const button=document.querySelector('#terminal-tab-operations');
        button.classList.add('has-updates'); button.setAttribute('aria-label','Operations, new observations');
      }
    } else if (reveal) {
      showFeedback(result?.status==='unavailable'?'That subject is not available to observe here.':'There is no eligible observation to share.');
      revealNarrativeReceipt();
    }
    return result;
  } catch (error) { console.error('Could not present narrative:',error); if (reveal) showFeedback('The observation could not be displayed.','error'); return null; }
}
function observe(request) { const state=runtime.getState(); return safeNarrative(()=>narrativePresentation.observe(state,request),true); }
function observeLocation() { return observe({surface:'inspect_location',subjectId:runtime.getState().locationId}); }
function render() {
  const state = runtime.getState();
  const context = contextFor(state);
  observationActions=equipmentObservationActions(systems.narrative.buildContext(state,{surface:'inspect_location',subjectId:state.locationId}));
  const view = context.permissions.viewCargo ? createView(context.actionState, content) :
    { power: 0, powerCapacity: 0, powerRate: 0, solarHealth: null, simulationTime: state.simulationTime };
  if (displayedLocationId !== state.locationId || displayedAssetAccess !== context.permissions.viewCargo) {
    displayedLocationId = state.locationId;
    displayedAssetAccess = context.permissions.viewCargo;
    document.querySelector("#current-location").textContent = context.definition.name;
    document.querySelector(".habitat-mark").setAttribute("aria-label", context.definition.name + " operations");
    document.querySelector("#session-location").textContent = "LOCAL SESSION / " + context.definition.name.toUpperCase();
    document.querySelector("#inventory-location").textContent = context.definition.name;
    document.querySelector("#power-location").textContent = context.definition.name;
    document.title = context.definition.name + " — Operations Terminal";
    document.documentElement.style.setProperty("--location-tint", context.definition.color);
    wattmeterWidget?.destroy();
    wattmeterWidget = new WattmeterWidget("#wattmeter-widget", {
      title: "POWER FLOW", unit: "U", rate: "/sec",
      dialTitle: "POWER", dialLegend: "U/SEC", decades: 5
    });
    lastWattmeterSample = -Infinity; lastPowerRate = null;
  }
  const navigation = document.querySelector("#navigation-status");
  navigation.hidden = !context.definition.mobile;
  const navigationText = shipStatus(state, world);
  if (navigation.textContent !== navigationText) navigation.textContent = navigationText;
  document.querySelector("#asset-access").hidden = context.permissions.viewCargo;
  document.querySelector(".power-module").hidden = !context.permissions.viewCargo;
  document.querySelector(".flow-module").hidden = !context.permissions.viewCargo;

  elements.power.textContent = format(view.power);
  elements.powerCapacity.textContent = format(view.powerCapacity);
  elements.powerRate.textContent = `${view.powerRate >= 0 ? "+" : ""}${format(view.powerRate)}/sec`;
  // Sample once per active second, and immediately when an action changes flow.
  // Reuse the visible-page loop so hidden tabs do not collect simulated history.
  if (context.permissions.viewCargo && (view.simulationTime - lastWattmeterSample >= 1 || view.powerRate !== lastPowerRate)) {
    wattmeterWidget.push(view.powerRate);
    lastWattmeterSample = view.simulationTime;
    lastPowerRate = view.powerRate;
  }
  progressBarPower.setProgress(capacityPercentage(view.power, view.powerCapacity));
  elements.activeTime.textContent = formatCycle(view.simulationTime);
  elements.solarHealth.closest("section").hidden = view.solarHealth === null;
  elements.solarHealth.textContent = `${Math.round(view.solarHealth * 100)}%`;
  renderActions();
  renderCrafting(context.actionState);
  renderProcessing(state);
  renderTransfer(state);
  renderCargo(state);
  renderLocations(state);
  renderPeople(state);
  renderResearch(state);
  renderShipyard(state);
  renderVesselControls(state);
  const stable = view.powerRate >= 0;
  elements.alertState.classList.toggle("stable", stable);
  elements.alertStatus.textContent = !context.permissions.viewCargo ? "VISITOR ACCESS" : stable ? "SYSTEMS STABLE" : "ATTENTION REQUIRED";
  elements.busStatus.textContent = !context.permissions.viewCargo ? "PRIVATE" : view.powerRate > 0 ? "LOCAL" : "RESERVE";
  elements.reserveStatus.textContent = view.powerCapacity === 0 ? "NO LOCAL RESERVE" : view.powerRate === 0 ? "RESERVES IDLE" : stable
    ? view.power >= view.powerCapacity ? "RESERVES FULL" : "RESERVES CHARGING"
    : view.power > 0 ? "RESERVES DRAINING" : "RESERVES DEPLETED";
  elements.solarMeter.value = view.solarHealth * 100;
  elements.solarMeter.textContent = `${Math.round(view.solarHealth * 100)}%`;
  elements.solarStatus.textContent = view.solarHealth >= 1 ? "OPERATIONAL" : "DEGRADED";
}

function applyAction(execute, action, payload) {
  if (lastGatheringActionId && lastGatheringActionId !== action.id) logDisplay.breakGathering?.();
  lastGatheringActionId = action.gathering ? action.id : null;
  if (!["selection", "dialogue"].includes(action.group) && !action.gathering) showFeedback(`> ${action.name}`, "command");
  const result=runtime.applyAction(execute);
  const { previous, state, message } = result;
  renderPeople.committed(previous, state, action, payload, message);
  if (action.navigation && !state.dialogue.active) tabs.activateTab("operations");
  render();
  if (message) {
    showFeedback(message, "system", action.gathering ? {
      actionId: action.id, locationId: state.locationId, ...action.gathering
    } : null);
  }
  safeNarrative(()=>narrativePresentation.committed(result,{action,payload}));
  return message;
}

function handleAction(actionId, payload, fromButton = false) {
  if (selectedGathering && selectedGathering !== actionId) stopRepeating();
  try {
    if (actionId.startsWith('observe-equipment:')) {
      const state=runtime.getState();
      const choice=equipmentObservationActions(systems.narrative.buildContext(state,{surface:'inspect_location',subjectId:state.locationId})).find(action=>action.id===actionId);
      if (!choice) throw new Error('That inspection is no longer available here.');
      const result=observe(choice.request);
      return {ok:result?.status==='ok',message:result?.text};
    }
    const message = executeAction(actionId, payload);
    if (fromButton) {
      const status = actionRegistry.getActionStatus(actionId);
      if (status.gathering) {
        selectedGathering = actionId;
        renderActions.setRepeatState(actionId, repeatTimer !== null);
      } else stopRepeating();
    }
    return { ok: true, message };
  } catch (error) {
    if (selectedGathering === actionId) stopRepeating();
    showFeedback(error.message, "error");
    return { ok: false, message: error.message };
  }
}

function gameLoop(frameTime) {
  if (resettingGame) return;
  if (previousFrameTime === null) {
    previousFrameTime = frameTime;
  }

  const elapsedSeconds = (frameTime - previousFrameTime) / 1000;
  previousFrameTime = frameTime;

  // Hidden-tab time is deliberately ignored. There is no offline progress.
  if (!document.hidden && elapsedSeconds > 0 && !runtime.isPaused()) {
    let result;
    try { result=runtime.advance(elapsedSeconds); }
    catch (error) {
      runtime.pause();
      showFeedback(`${error.message} Progress paused. Restore save access, then execute a valid action or reload to resume.`, "error");
    }
    if (result) {
      const { previous, state, closure } = result;
      if (closure) { renderPeople.committed(previous, state, {}, null, closure); showFeedback(closure, "narrative"); }
      render();
      safeNarrative(()=>narrativePresentation.committed(result));
    }
  }

  requestAnimationFrame(gameLoop);
}

elements.commandForm.addEventListener("submit", event => {
  event.preventDefault();
  const command = elements.commandInput.value.trim();
  if (!command) return;
  if (command.toLowerCase() === "reset game") {
    try {
      clearGame();
      resettingGame = true;
      stopRepeating();
      window.location.reload();
    } catch (error) {
      resettingGame = false;
      showFeedback(`Could not reset the game: ${error.message}`, "error");
    }
    return;
  }
  if (["talk", "people"].includes(command.toLowerCase())) { renderPeople.show(); elements.commandInput.value = ""; return; }
  if (command.toLowerCase() === "research") { tabs.activateTab("research"); elements.commandInput.value = ""; return; }
  if (['look','observe'].includes(command.toLowerCase())) { observeLocation(); elements.commandInput.value=''; return; }
  try {
    const actionId = observationActions.find(action=>[action.id,action.name].some(name=>name.toLowerCase()===command.toLowerCase()))?.id ?? resolveAction(command);
    if (actionId) handleAction(actionId);
    else showFeedback("Directive not recognized. Enter a displayed action name or shortcut.", "error");
  } catch (error) { showFeedback(error.message, "error"); }
  elements.commandInput.value = "";
  elements.commandInput.focus();
});

document.addEventListener("keydown", event => {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
      event.target.closest("input, textarea, select, [contenteditable], #people-panel")) return;
  if (event.code === 'Space' && selectedGathering && !document.querySelector('#operations-panel').hidden) {
    event.preventDefault();
    if (!event.repeat) toggleRepeating();
    return;
  }
  if (event.repeat) return;
  let actionId;
  try { actionId = /^[1-9]$/.test(event.key) ? resolveAction(event.key) : null; }
  catch (error) { showFeedback(error.message, "error"); return; }
  if (actionId) {
    event.preventDefault();
    handleAction(actionId);
  }
});

document.addEventListener("visibilitychange", () => {
  // Reset the reference point so hidden time is not counted on return.
  previousFrameTime = performance.now();

  if (document.hidden && !resettingGame) {
    stopRepeating();
    runtime.flush();
  }
});

window.addEventListener("pagehide", () => { if (!resettingGame) runtime.flush(); });

runtime.flush();
render();
requestAnimationFrame(gameLoop);
