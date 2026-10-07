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
import consoleDisplay from "./consoleDisplay.js?v=activity-logs-1";
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
import itemKnowledgeDisplay from './itemKnowledgeDisplay.js';
import itemContextDisplay from './itemContextDisplay.js';
import facilitySystemsDisplay from './facilitySystemsDisplay.js';
import {createImmediateLocationViews} from './immediateLocation.js';
import surroundingsDisplay from './surroundingsDisplay.js';

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
let renderSurroundings=null;
const tabs = terminalTabs({
  tabList: document.querySelector("#terminal-tabs"),
  panelContainer: document.querySelector("#terminal-panels")
});
tabs.registerTab({
  id: "operations", label: "Operations", panel: document.querySelector("#operations-panel"),
  onActivate() {
    renderSurroundings?.setActiveTab('operations');
    logDisplay.onActivate();
    const button=document.querySelector('#terminal-tab-operations');
    button.classList.remove('has-updates'); button.setAttribute('aria-label','Operations');
    // The visible log announces results here; avoid duplicate announcements.
    elements.feedback.setAttribute("aria-live", "off");
  },
  onDeactivate() {
    renderSurroundings?.setActiveTab('other');
    stopRepeating();
    logDisplay.onDeactivate();
    elements.feedback.setAttribute("aria-live", "polite");
  }
});
tabs.registerTab({ id: "workshop", label: "Workshop", panel: document.querySelector("#workshop-panel"),
  onDeactivate() { renderItemContext.close(false); }
});
tabs.registerTab({ id: "systems", label: "Systems", panel: document.querySelector("#systems-panel"),
  onActivate() { renderSystems(runtime.getState()); }
});
tabs.registerTab({ id: "locations", label: "Locations", panel: document.querySelector("#locations-panel") });
tabs.registerTab({ id: "people", label: "People", panel: document.querySelector("#people-panel"),
  onActivate() { elements.feedback.setAttribute("aria-live", "off"); },
  onDeactivate() { elements.feedback.setAttribute("aria-live", "polite"); }
});
tabs.registerTab({ id: "research", label: "Research", panel: document.querySelector("#research-panel") });
tabs.registerTab({ id: "knowledge", label: "Knowledge", panel: document.querySelector("#knowledge-panel") });
tabs.registerTab({ id: "shipyard", label: "Shipyard", panel: document.querySelector("#shipyard-panel"),
  onDeactivate() { renderShipyard.cancelInteraction(); }
});
tabs.activateTab("operations");
bus.subscribe({}, message => {
  if (!["system", "error", "narrative"].includes(message.type)) return;
  const logVisible = logDisplay.isMessageVisible?.(message) ?? tabs.getActiveTabId() === 'operations';
  elements.feedback.setAttribute('aria-live', logVisible || tabs.getActiveTabId() === 'people' ? 'off' : 'polite');
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
createUiTour(tabs);
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
  if (actions.some(a => [a.id, a.name, ...(a.aliases ?? [])].some(name => ["talk", "people", "research", "look", "observe", "debug fog"].includes(name.trim().toLowerCase())))) throw new Error("talk, people, research, look, observe, and debug fog are reserved presentation commands.");
} });
let observationActions=[];
const renderActions = playerActionsDisplay(id => handleAction(id, undefined, true), "#player-actions",group=>{
  const mapped=renderSurroundings?.mappedActionIds()??new Set();
  return [...actionRegistry.getActions(group), ...(group==='directives'?observationActions:[])].filter(action=>!mapped.has(action.id));
});
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
const renderCrafting = craftingDisplay(content, handleAction, actionRegistry.getActionStatus, (id,opener) => renderItemContext.open(id,opener));
const renderProcessing = processingDisplay(systems.processing,handleAction);
const renderTransfer = transferDisplay(world, content, handleAction);
const renderCargo = cargoDisplay(world, content, handleAction);
const renderLocations = locationDisplay(world, content, handleAction, shipGraphView, shipStatus, actionRegistry.getActionStatus, (state, id) => getEntityLabel(state, systems, id));
const renderPeople = dialogueDisplay(people, handleAction, () => tabs.activateTab("people"));
const renderResearch = researchDisplay(research, handleAction, () => tabs.activateTab("research"));
let workshopReturn = null;
function itemReference(kind,id) {
  if (kind === 'item') { tabs.activateTab('knowledge'); renderKnowledge.select(id); }
  else if (kind === 'recipe') {
    if (actionRegistry.getActionStatus(`selectRecipe:${id}`).available && handleAction(`selectRecipe:${id}`).ok) {
      tabs.activateTab('workshop'); document.querySelector('#recipe-select').focus({preventScroll:true});
    }
  } else if (kind === 'location') { tabs.activateTab('locations'); renderLocations.select(id); }
  else if (kind === 'process') { tabs.activateTab('workshop'); const heading=document.querySelector('#processing-heading'); heading.tabIndex=-1; heading.focus(); heading.scrollIntoView({block:'nearest'}); }
  else if (kind === 'shipyard') tabs.activateTab('shipyard');
}
const renderKnowledge = itemKnowledgeDisplay(systems.itemKnowledge,research,itemReference,() => {
  tabs.activateTab('workshop');
  const target=workshopReturn?.isConnected && !workshopReturn.closest('[hidden]') ? workshopReturn : document.querySelector('#crafting-heading');
  if (target) { target.tabIndex=target.matches('button') ? 0 : -1; target.focus({preventScroll:true}); }
});
const renderItemContext = itemContextDisplay(systems.itemKnowledge,handleAction,itemReference,(id,opener) => {
  workshopReturn=opener; tabs.activateTab('knowledge'); renderKnowledge.select(id,true);
});
const renderShipyard = shipyardDisplay(systems, handleAction);
const renderVesselControls = vesselControlsDisplay(systems, handleAction);
function revealTerminalTarget(target) {
  if (!target) return;
  if (!target.matches('button, input, select, textarea')) target.tabIndex = -1;
  target.focus({preventScroll:true});
  // Reveal within the destination panel, without moving the mobile document.
  const panel=target.closest('[role="tabpanel"]');
  if (panel) {
    const bounds=panel.getBoundingClientRect(), rect=target.getBoundingClientRect();
    if (rect.top < bounds.top || rect.bottom > bounds.bottom) panel.scrollTop += rect.top-bounds.top-12;
  }
}
const renderSystems = facilitySystemsDisplay(systems.facilitySystems,content,(owner,equipmentId)=>{
  if (owner==='research') { tabs.activateTab('research'); revealTerminalTarget(document.querySelector('#research-experiment-heading')); }
  else if (owner==='communications') { tabs.activateTab('people'); revealTerminalTarget(document.querySelector('.people-roster')); }
  else {
    tabs.activateTab('workshop');
    const target=owner==='fabrication' ? document.querySelector('#recipe-select') :
      [...document.querySelectorAll('#processing-machines [data-equipment-id]')].find(el=>el.dataset.equipmentId===equipmentId) ?? document.querySelector('#processing-heading');
    revealTerminalTarget(target);
  }
});
document.querySelector('#facility-systems-shortcut').addEventListener('click',()=>{
  tabs.activateTab('systems'); renderSystems(runtime.getState());
  revealTerminalTarget(document.querySelector('#facility-systems-heading'));
});
renderSurroundings=surroundingsDisplay({views:createImmediateLocationViews(systems),getActionStatus:actionRegistry.getActionStatus,
  onAction:(id,payload)=>handleAction(id,payload),onObserve:request=>observe(request),
  onSelect:()=>tabs.activateTab('operations'),onOpen:link=>{
    tabs.activateTab(link.tab);
    if(link.tab==='locations'&&link.targetId)renderLocations.select(link.targetId);
    if(link.tab==='people')renderPeople.show();
  }});

function loadOrCreateGame() {
  try {
    const saved = loadGame();
    freshGame = saved === null;
    const notices = [];
    const loaded = saved === null ? createInitialState(crypto.getRandomValues(new Uint32Array(1))[0]) : migrateState(saved, notices);
    validateState(loaded);
    if (saved===null || saved.saveVersion !== loaded.saveVersion) saveGame(loaded);
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

function showFeedback(text, type = "system", gathering = null, activity = null) {
  bus.publish({
    author: type === "command" ? "PLAYER" : "SYSTEM",
    type,
    text,
    gathering,
    activity,
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
  renderSurroundings(state);
  renderActions();
  renderCrafting(context.actionState);
  renderProcessing(state);
  renderTransfer(state);
  renderCargo(state);
  renderLocations(state);
  renderPeople(state);
  renderResearch(state);
  renderKnowledge(state);
  renderItemContext(state);
  renderShipyard(state);
  renderVesselControls(state);
  renderSystems(state);
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
  const activity = action.gathering ? 'gathering' : action.collection === 'crafting' ? 'crafting' : null;
  if (!["selection", "dialogue"].includes(action.group) && !action.gathering) showFeedback(`> ${action.name}`, "command", null, activity);
  const result=runtime.applyAction(execute);
  const { previous, state, message } = result;
  renderPeople.committed(previous, state, action, payload, message);
  if (action.navigation && !state.dialogue.active) tabs.activateTab("operations");
  render();
  if (message) {
    showFeedback(message, "system", action.gathering ? {
      actionId: action.id, locationId: state.locationId, ...action.gathering
    } : null, activity);
  }
  safeNarrative(()=>narrativePresentation.committed(result,{action,payload}));
  return message;
}

function handleAction(actionId, payload, fromButton = false) {
  let activity = null;
  if (selectedGathering && selectedGathering !== actionId) stopRepeating();
  try {
    if (actionId.startsWith('observe-equipment:')) {
      const state=runtime.getState();
      const choice=equipmentObservationActions(systems.narrative.buildContext(state,{surface:'inspect_location',subjectId:state.locationId})).find(action=>action.id===actionId);
      if (!choice) throw new Error('That inspection is no longer available here.');
      const result=observe(choice.request);
      return {ok:result?.status==='ok',message:result?.text};
    }
    const actionStatus = actionRegistry.getActionStatus(actionId, payload);
    activity = actionStatus.gathering ? 'gathering' : actionStatus.collection === 'crafting' ? 'crafting' : null;
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
    showFeedback(error.message, "error", null, activity);
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
  if (command.toLowerCase() === "debug fog") {
    const enabled = renderLocations.toggleFogOfWar();
    tabs.activateTab('locations');
    showFeedback(enabled ? 'Debug: fog of war on. Showing discovered locations.' : 'Debug: fog of war off. Showing all locations; discoveries and travel permissions are unchanged.');
    elements.commandInput.value = '';
    return;
  }
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
      event.target.closest("input, textarea, select, [contenteditable], #people-panel, #systems-panel")) return;
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
