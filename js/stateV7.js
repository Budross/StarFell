// Historical versions 1–7 only. Keep legacy conversions before registry seeding.
import { createLocationState, validateLocalState, getLocationContext, isKnown } from "./locations.js";
import { validateShipStates } from "./ships.js";
import { conditionReason } from "./conditionContext.js";
import { createNpcState, validateNpcState } from "./npcs.js";
import { createDialogueState, validateDialogueState, reconcilePeopleContent } from "./dialogue.js";
import { createResearchState, validateResearchState, reconcileResearchContent } from "./research/researchState.js";
import { grantDiscovery } from "./knowledge.js";
import { convertLegacyStorage, LEGACY_STORAGE } from "./storageMigration.js";

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const booleanMap = value => record(value) && Object.values(value).every(entry => typeof entry === "boolean");

export function createInitialState(content, world, people, research, seed = 0x07B3A91D) {
  return { saveVersion: 7, simulationTime: 0, locationId: world.startId,
    locations: Object.fromEntries(Object.entries(world.definitions).filter(([, d]) => d.spawn !== false).map(([id, def]) => [id, createLocationState(def, content)])),
    npcs: Object.fromEntries(Object.entries(people.npcs).filter(([, d]) => d.spawn !== false).map(([id, def]) => [id, createNpcState(def)])), dialogue: createDialogueState(),
    crafting: { recipeId: null, ingredients: {} }, knowledge: { discoveries: {} }, flags: {}, research: createResearchState(seed) };
}

export function migrateState(saved, content, world, people, notices = [], research, legacyStorage = LEGACY_STORAGE) {
  if (!record(saved) || ![1, 2, 3, 4, 5, 6, 7].includes(saved.saveVersion)) throw new Error("Unsupported or missing save data.");
  const state = structuredClone(saved);
  if (state.saveVersion < 7) convertLegacyStorage(state, content, world, legacyStorage);
  const defaults = createInitialState(content, world, people, research);
  if (!Object.hasOwn(world.definitions, state.locationId)) throw new Error(`Invalid location: ${state.locationId}.`);
  if (state.saveVersion < 3) {
    if (!record(state.resources) || !record(state.infrastructure)) throw new Error("Invalid saved inventory or infrastructure.");
    state.locations = defaults.locations;
    const habitat = state.locations.habitat;
    if (!habitat) throw new Error("Legacy habitat migration target is missing.");
    // Existing assets replace initial grants; only the newly required facility is added.
    habitat.resources = { ...Object.fromEntries(Object.keys(content.resources).map(id => [id, 0])), ...state.resources };
    habitat.infrastructure = { ...habitat.infrastructure, ...state.infrastructure };
    for (const value of Object.values(habitat.infrastructure)) {
      if (record(value) && !Object.hasOwn(value, "upgrades")) value.upgrades = [];
    }
    habitat.ownerId = "player";
    delete state.resources;
    delete state.infrastructure;
    for (const key of ["crafting", "knowledge", "flags"]) if (!Object.hasOwn(state, key)) state[key] = defaults[key];
    state.saveVersion = 3;
  }
  if (!record(state.locations)) throw new Error("Invalid saved locations.");
  for (const [id, def] of Object.entries(world.definitions).filter(([, d]) => d.spawn !== false)) {
    if (!Object.hasOwn(state.locations, id)) state.locations[id] = createLocationState(def, content);
    const local = state.locations[id];
    if (!record(local) || !record(local.resources) || !record(local.infrastructure)) throw new Error(`Invalid local assets at ${id}.`);
    // New asset definitions start empty at existing sites; never replay starting grants.
    for (const asset of Object.keys(content.resources)) if (!Object.hasOwn(local.resources, asset)) local.resources[asset] = 0;
    for (const group of Object.keys(content.infrastructure)) if (!Object.hasOwn(local.infrastructure, group)) local.infrastructure[group] = { quantity: 0, health: 1, enabled: true, upgrades: [] };
    if (state.saveVersion === 3 && def.mobile) {
      if (!Object.hasOwn(local, "dockedAtId")) local.dockedAtId = null;
      if (!Object.hasOwn(local, "journey")) local.journey = null;
    }
  }
  if (state.saveVersion === 3) {
    // Legacy quantities were checked and converted before current defaults were added.
    for (const [id, def] of Object.entries(world.definitions).filter(([, d]) => d.spawn !== false)) validateLocalState(state.locations[id], def, content, world);
    if (world.definitions[state.locationId].kind === "area") {
      const mapped = { vicinity: "habitat", outerReach: "derelict" }[state.locationId];
      const target = world.definitions[mapped];
      if (!target || target.kind !== "site" || target.mobile || state.locations[mapped].areaId !== state.locationId ||
          !isKnown(state, world, content, mapped) || conditionReason(getLocationContext(state, content, world).actionState, target.accessConditions, content)) {
        throw new Error(`No accessible site migration is defined for area ${state.locationId}. Save preserved.`);
      }
      state.locationId = mapped;
    }
    state.saveVersion = 4;
  }
  if (state.saveVersion === 4) {
    state.npcs = defaults.npcs; state.dialogue = defaults.dialogue; state.saveVersion = 5;
  }
  if (state.saveVersion === 5) {
    if (!record(state.knowledge) || !booleanMap(state.knowledge.discoveries)) throw new Error("Invalid knowledge or flags.");
    state.research = createResearchState(); state.research.legacyKnowledge = true;
    for (const discovery of research.catalog.orderedDiscoveries) if (discovery.legacyGrant) grantDiscovery(state, discovery.id);
    state.saveVersion = 6;
    notices.push("Research is now available. Your previously available fabrication knowledge has been preserved.");
  }
  if (state.saveVersion === 6) {
    state.saveVersion = 7;
    notices.push("Cargo now uses shared volume storage. Your inventory was preserved; overloaded holds can transfer, consume, install, or explicitly discard cargo.");
  }
  const notice = reconcilePeopleContent(state, people);
  if (notice) notices.push(notice);
  reconcileResearchContent(state, research);
  validateState(state, content, world, people, research);
  return state;
}

export function validateState(state, content, world, people, research) {
  if (!record(state) || state.saveVersion !== 7) throw new Error("Unsupported or missing save data.");
  if (!Number.isFinite(state.simulationTime) || state.simulationTime < 0) throw new Error("Invalid simulation time.");
  if (!Object.hasOwn(world.definitions, state.locationId) || world.definitions[state.locationId].kind !== "site") throw new Error("Invalid player location; occupy a site or ship.");
  if (!record(state.locations) || Object.keys(state.locations).some(id => !Object.hasOwn(world.definitions, id))) throw new Error("Invalid or removed saved location.");
  for (const [id, def] of Object.entries(world.definitions).filter(([, d]) => d.spawn !== false)) {
    if (!Object.hasOwn(state.locations[id] ?? {}, "ownerId")) throw new Error(`Invalid legacy ownership at ${id}.`);
    validateLocalState(state.locations[id], def, content, world);
  }
  validateShipStates(state, world);
  if (!record(state.npcs) || Object.keys(state.npcs).some(id => !Object.hasOwn(people.npcs, id))) throw new Error("Invalid or removed saved NPC.");
  for (const [id, def] of Object.entries(people.npcs).filter(([, d]) => d.spawn !== false)) validateNpcState(state.npcs[id], def, world, content);
  validateDialogueState(state, people);
  if (!booleanMap(state.flags) || !record(state.knowledge) || !booleanMap(state.knowledge.discoveries)) throw new Error("Invalid knowledge or flags.");
  validateResearchState(state.research, research, state);
  const draft = state.crafting;
  if (!record(draft) || !record(draft.ingredients) || (draft.recipeId !== null && !Object.hasOwn(content.recipes, draft.recipeId))) throw new Error("Invalid crafting selection.");
  const recipe = content.recipes[draft.recipeId];
  for (const [slotId, itemId] of Object.entries(draft.ingredients)) {
    if (!recipe?.inputs.some(slot => slot.id === slotId) || typeof itemId !== "string" || !Object.hasOwn(content.items, itemId)) throw new Error("Invalid ingredient selection.");
  }
}
