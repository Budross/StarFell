import { setScopedFlag } from "./flags.js";
import { validateEquipment } from "./equipment.js";
import { validateConditions } from "./conditions.js";
import { conditionReason } from "./conditionContext.js";
import { collectDiscoveryReferences, conditionEntityReferences } from "./conditionReferences.js";
import { capacity, moveExact, moveReason } from "./resources.js";
import { compileAmounts, volumeUnits, validateQuantity, formatQuantity } from "./quantities.js";
import { storageSummary } from "./storage.js";
import { locationDefinition, locationInstances, getEntityLocation } from "./entityQueries.js";
import { isEntityActive } from "./entities.js";
import { canUse, permissionReason, permissions, ownerOf, defaultAccess, validateAccess } from "./authority.js";
import { entityReference } from "./entityReferences.js";
import { isTerminal } from "./entities.js";
import { compileResourceNodes } from './processingCatalog.js';
import { compileEffects, describeEffects, applyEffects } from "./effects.js";
import { validateNarrativeMetadata,mergeNarrativeMetadata } from './narrative/narrativeMetadata.js';

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = id => typeof id === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(id) && !["constructor", "prototype", "__proto__"].includes(id);
const check = (ok, message) => { if (!ok) throw new Error(`Invalid locations: ${message}`); };
const union = (...lists) => [...new Set(lists.flat())];

export function compileLocationCatalog(source, content) {
  try { return compileLocations(source, content); }
  catch (error) { throw new Error(error.message.startsWith("Invalid locations:") ? error.message : `Invalid locations: ${error.message}`); }
}
function compileLocations(source, content) {
  check(record(source.types) && record(source.locations), "types and locations are required.");
  check(Number.isFinite(source.connectionDistance) && source.connectionDistance > 0, "connection distance must be positive.");
  const definitions = {};
  function conditions(value = {}) {
    validateConditions(value, { content }, "locations conditions");
  }
  for (const id of Object.keys(source.templates ?? {})) check(!Object.hasOwn(source.locations, id), `duplicate template ${id}.`);
  const entries = { ...source.locations, ...Object.fromEntries(Object.entries(source.templates ?? {}).map(([id, def]) => [id, { ...def, spawn: false }])) };
  for (const [id, authored] of Object.entries(entries)) {
    check(validId(id) && record(authored) && Object.hasOwn(source.types, authored.type), `unknown type or invalid location ${id}.`);
    const template = source.types[authored.type];
    check(record(template), `invalid template ${authored.type}.`);
    for (const entry of [template, authored]) {
      for (const key of ["actions", "actionSets", "removeActions", "removeSceneObjects"]) {
        check(entry[key] === undefined || (Array.isArray(entry[key]) && entry[key].every(v => typeof v === "string" && v)), `${id}/${key}.`);
      }
      for (const key of ["initialResources", "initialInfrastructure", "capacities", "storage"]) check(entry[key] === undefined || record(entry[key]), `${id}/${key}.`);
      if (entry.storage !== undefined) check(Object.keys(entry.storage).every(key => key === "capacityM3"), `storage fields on ${id}.`);
      if (entry.storage && Object.hasOwn(entry.storage, "capacityM3")) volumeUnits(entry.storage.capacityM3);
      for (const value of Object.values(entry.initialInfrastructure ?? {})) check(record(value), `invalid equipment entry on ${id}.`);
      check(entry.sceneObjects === undefined || Array.isArray(entry.sceneObjects), `${id}/sceneObjects.`);
    }
    const def = structuredClone({ ...template, ...authored, id });
    validateNarrativeMetadata(template.narrative,'location');
    validateNarrativeMetadata(authored.narrative,'location');
    const narrative=mergeNarrativeMetadata(template.narrative,authored.narrative);
    if (narrative) { validateNarrativeMetadata(narrative,'location'); def.narrative=narrative; }
    check(["area", "site"].includes(def.kind) && typeof def.name === "string" && def.name.trim(), `identity for ${id}.`);
    const cargoCapacity = authored.storage?.capacityM3 ?? template.storage?.capacityM3 ?? (def.kind === "area" ? 0 : undefined);
    def.capacityVolumeUnits = volumeUnits(cargoCapacity);
    check(def.kind !== "area" || def.capacityVolumeUnits === 0, `area cargo capacity on ${id}.`);
    for (const key of ["description", "remoteDescription"]) check(typeof def[key] === "string" && def[key].trim(), `${key} for ${id}.`);
    check(/^#[0-9a-f]{6}$/i.test(def.color ?? "#1e2520"), `color for ${id}.`);
    def.color ??= "#1e2520";
    def.initialOwnerId ??= null;
    def.initialControllerId ??= null;
    def.mobile ??= false;
    def.resourceNodes = compileResourceNodes(def.resourceNodes, content, def.kind === 'site' && !def.mobile);
    if (def.initialLifecycle === undefined) def.initialLifecycle = "active";
    check(["active", "inactive"].includes(def.initialLifecycle) && (def.kind !== "area" || def.initialLifecycle === "active"), `initial lifecycle for ${id}.`);
    check(typeof def.mobile === "boolean" && (!def.mobile || def.kind === "site"), `mobile designation for ${id}.`);
    check(def.shipyard === undefined || typeof def.shipyard === 'boolean' && def.kind === 'site' && !def.mobile, `stationary Shipyard for ${id}.`);
    check(def.modularVessel === undefined || typeof def.modularVessel === 'boolean' && def.mobile && def.spawn === false && def.capacityVolumeUnits === 0 && def.capacities?.power === 0, `modular shell for ${id}.`);
    if (def.mobile) {
      def.initialDockedAtId ??= null;
      check(validId(def.propulsionCapability) && Object.values(content.infrastructure).some(m => m.capabilities.includes(def.propulsionCapability)), `propulsionCapability for ${id}.`);
      for (const key of ["localTravelPowerCost", "areaTravelPowerCost", "localTravelDistance", "travelSpeed"]) {
        check(Number.isFinite(def[key]) && (key.endsWith("PowerCost") ? def[key] >= 0 : def[key] > 0), `${key} for ${id}.`);
      }
      check(def.boardingCost === undefined, `boardingCost is not supported (${id}); boarding is free.`);
    }
    check(def.initialOwnerId === null || validId(def.initialOwnerId), `owner for ${id}.`);
    check(def.initialControllerId === null || validId(def.initialControllerId), `controller for ${id}.`);
    def.initialAccess = defaultAccess(def);
    validateAccess(def.initialAccess);
    check(def.spawn === undefined || typeof def.spawn === "boolean", `spawn for ${id}.`);
    if (def.spawn === false) check(def.kind === "site", `only sites/ships support templates (${id}).`);
    if (def.kind === "area") check(Array.isArray(def.position) && def.position.length === 2 && def.position.every(Number.isFinite) && !def.areaId, `area position for ${id}.`);
    for (const key of ["initialResources", "capacities"]) def[key] = { ...template[key], ...authored[key] };
    def.initialInfrastructure = {};
    for (const group of union(Object.keys(template.initialInfrastructure ?? {}), Object.keys(authored.initialInfrastructure ?? {}))) {
      check(record((authored.initialInfrastructure ?? {})[group] ?? (template.initialInfrastructure ?? {})[group]), `equipment ${group}.`);
      def.initialInfrastructure[group] = { ...template.initialInfrastructure?.[group], ...authored.initialInfrastructure?.[group] };
    }
    def.actionSets = union(template.actionSets ?? [], authored.actionSets ?? []);
    def.actions = union(template.actions ?? [], authored.actions ?? []);
    def.removeActions = [...(authored.removeActions ?? [])];
    const scenes = new Map();
    for (const list of [template.sceneObjects ?? [], authored.sceneObjects ?? []]) {
      const seen = new Set();
      for (const scene of list) {
        check(record(scene) && validId(scene.id) && !seen.has(scene.id), `scene identity on ${id}.`);
        seen.add(scene.id);
        check(scene.locationId || (typeof scene.name === "string" && typeof scene.description === "string"), `scene text on ${id}.`);
        conditions(scene.conditions);
        scenes.set(scene.id, structuredClone(scene));
      }
    }
    for (const removed of authored.removeSceneObjects ?? []) { check(scenes.has(removed), `unknown removed scene ${removed}.`); scenes.delete(removed); }
    def.sceneObjects = [...scenes.values()];
    conditions(def.conditions);
    conditions(def.accessConditions);
    def.startupMessages ??= [];
    check(Array.isArray(def.startupMessages), `startup messages on ${id}.`);
    for (const message of def.startupMessages) {
      check(record(message) && typeof message.text === "string" && message.text.trim(), `startup message on ${id}.`);
      conditions(message.conditions);
      if (message.equipment !== undefined || message.healthBelow !== undefined) {
        check(Object.hasOwn(content.infrastructure, message.equipment) && Number.isFinite(message.healthBelow) &&
          message.healthBelow >= 0 && message.healthBelow <= 1, `startup equipment on ${id}.`);
      }
    }
    for (const [asset, amount] of Object.entries(def.capacities)) check(content.utilities.includes(asset) && Number.isFinite(amount) && amount >= 0 && amount <= Number.MAX_SAFE_INTEGER, `utility capacity ${id}/${asset}.`);
    def.initialResources = compileAmounts(def.initialResources, content);
    check(Object.keys(def.initialInfrastructure).every(group => Object.hasOwn(content.infrastructure, group)), `unknown infrastructure on ${id}.`);
    definitions[id] = def;
  }
  for (const def of Object.values(definitions)) {
    def.inspectionEffects = compileEffects(def.inspectionEffects, { content, world: { definitions } }, { kind: "inspection" }, `locations.${def.id}.inspectionEffects`);
    for (const scene of def.sceneObjects) {
      check(!scene.locationId || scene.effects === undefined, `location scene cannot have inspection effects (${def.id}/${scene.id}).`);
      scene.effects = compileEffects(scene.effects, { content, world: { definitions } }, { kind: "inspection" }, `locations.${def.id}.sceneObjects.${scene.id}.effects`);
    }
    if (def.kind === "site" && def.spawn !== false) check(definitions[def.areaId]?.kind === "area", `unknown area on ${def.id}.`);
    if (def.mobile && def.initialDockedAtId !== null && def.spawn !== false) {
      const dock = definitions[def.initialDockedAtId];
      check(dock?.kind === "site" && !dock.mobile && dock.areaId === def.areaId, `initialDockedAtId for ${def.id}.`);
    }
    for (const scene of def.sceneObjects) if (scene.locationId) check(Object.hasOwn(definitions, scene.locationId), `unknown scene location ${scene.locationId}.`);
    for (const cond of [def.conditions, def.accessConditions, ...def.sceneObjects.map(s => s.conditions), ...def.startupMessages.map(m => m.conditions)]) {
      validateConditions(cond, { content, world: { definitions } }, `locations ${def.id}`);
    }
  }
  // Item conditions stay owned by the item catalog; cross-catalog references are checked here.
  function references(value) {
    if (!value || typeof value !== "object") return;
    if (value.conditions) validateConditions(value.conditions, { content, world: { definitions } }, "locations item conditions");
    Object.values(value).forEach(references);
  }
  references(content.items);
  check(definitions[source.startId]?.kind === "site" && definitions[source.startId].spawn !== false && definitions[source.startId].initialLifecycle === "active", "starting site is missing or inactive.");
  const areas = Object.values(definitions).filter(def => def.kind === "area");
  const links = [];
  areas.forEach((a, i) => areas.slice(i + 1).forEach(b => {
    if (Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1]) <= source.connectionDistance) links.push([a.id, b.id]);
  }));
  const effectSources = Object.values(definitions).flatMap(def => [
    { path: `locations.${def.id}.inspectionEffects`, effects: def.inspectionEffects, trigger: { kind: "inspection" } },
    ...def.sceneObjects.map(scene => ({ path: `locations.${def.id}.sceneObjects.${scene.id}.effects`, effects: scene.effects, trigger: { kind: "inspection" } }))
  ]);
  const effectMetadata = effectSources.flatMap(source => describeEffects(source.effects, source.path));
  const discoveryReferences = collectDiscoveryReferences(Object.values(definitions).flatMap(def =>
    [def.conditions, def.accessConditions, ...def.sceneObjects.map(scene => scene.conditions), ...def.startupMessages.map(message => message.conditions)]),
    effectMetadata.filter(m => m.kind === "discovery" && m.access === "produce").map(m => m.id));
  const world = { definitions, links, startId: source.startId, discoveryReferences, effectSources, vesselModules: content.vesselModules,
    initialSpawns: Object.values(definitions).filter(d => d.spawn !== false).map(d => ({ id: d.id, definitionId: d.id,
      areaId: d.kind === "site" ? d.areaId : null, dockedAtId: d.mobile ? d.initialDockedAtId : null,
      ownerId: d.initialOwnerId, controllerId: d.initialControllerId, access: structuredClone(d.initialAccess), lifecycle: d.initialLifecycle })) };
  world.entityReferences = Object.values(definitions).flatMap(def => [
    ...[def.conditions, def.accessConditions, ...def.sceneObjects.map(s => s.conditions), ...def.startupMessages.map(m => m.conditions)]
      .flatMap(c => conditionEntityReferences(c, `locations:${def.id}`)),
    ...def.sceneObjects.filter(s => s.locationId).map(s => entityReference(`scene:${def.id}/${s.id}`, s.locationId, "content"))
  ]).concat(effectMetadata.filter(m => m.kind === "entity" && !["current", "speaker"].includes(m.targetId)));
  for (const def of Object.values(definitions)) {
    const local = createLocationState(def, content);
    validateLocalState(local, def, content, world, def.spawn === false);
    check(storageSummary({ ...local, capacityVolumeUnits: def.capacityVolumeUnits }, content).overloadVolumeUnits === 0, `starting cargo exceeds capacity at ${def.id}.`);
  }
  return world;
}

// Link only after every feature has supplied actions. No item-specific action vocabulary.
export function linkLocationActions(world, actions) {
  const knownActions = new Set(actions.map(action => action.id));
  const collections = new Set(["crafting", "equipment", "processing", ...actions.map(action => action.collection).filter(Boolean)]);
  const assignments = new Map();
  for (const def of Object.values(world.definitions)) {
    check(def.actionSets.every(set => collections.has(set)), `unknown action collection on ${def.id}.`);
    const ids = union(def.actions, actions.filter(a => def.actionSets.includes(a.collection)).map(a => a.id));
    check(ids.every(id => knownActions.has(id)), `unknown action on ${def.id}.`);
    check(def.removeActions.every(id => ids.includes(id)), `unknown removed action on ${def.id}.`);
    assignments.set(def.id, ids.filter(id => !def.removeActions.includes(id)));
  }
  // Validate against a detached projection so a rejected link leaves world unchanged.
  const definitions = Object.fromEntries(Object.values(world.definitions).map(def =>
    [def.id, { ...def, actions: assignments.get(def.id) }]));
  validateActionScopes(actions, { ...world, definitions });
  for (const def of Object.values(world.definitions)) def.actions = assignments.get(def.id);
  return world;
}

// Compatibility constructor for callers that already have their action definitions.
export function buildLocationCatalog(source, content, actions) {
  const world = compileLocationCatalog(source, content);
  return linkLocationActions(world, [...actions, ...createLocationActions(world, content)]);
}

export function createLocationState(def, content) {
  return {
    ownerId: def.initialOwnerId, areaId: def.kind === "site" ? def.areaId : null,
    ...(def.mobile ? { dockedAtId: def.initialDockedAtId, journey: null } : {}),
    resources: Object.fromEntries(Object.keys(content.resources).map(id => [id, def.initialResources[id] ?? 0])),
    infrastructure: Object.fromEntries(Object.keys(content.infrastructure).map(id => [id, {
      quantity: 0, health: 1, enabled: true, upgrades: [], ...structuredClone(def.initialInfrastructure[id] ?? {})
    }])), flags: {}, resourceNodes: Object.fromEntries(Object.entries(def.resourceNodes ?? {}).map(([id,node]) => [id,{ resourceId: node.resourceId, remaining: node.initialReserve }]))
  };
}

export function effectiveCapacities(def, content) {
  return Object.fromEntries(content.utilities.map(id => [id, def.capacities[id] ?? (def.kind === "area" ? 0 : content.resources[id].baseCapacity)]));
}

export function validateLocalState(local, def, content, world, unplaced = false) {
  const fail = message => { throw new Error(`Invalid ${message} at ${def.name}.`); };
  if (!record(local) || !(local.ownerId === undefined || local.ownerId === null || validId(local.ownerId)) ||
      (!unplaced && (def.kind === "area" ? local.areaId !== null : world.definitions[local.areaId]?.kind !== "area"))) fail("ownership or area");
  if (!record(local.resources) || !record(local.infrastructure) || !record(local.flags) || Object.values(local.flags).some(v => typeof v !== "boolean")) fail("local assets or flags");
  if (Object.keys(local.resources).some(id => !Object.hasOwn(content.resources, id)) || Object.keys(local.infrastructure).some(id => !Object.hasOwn(content.infrastructure, id))) fail("unknown saved asset");
  validateEquipment(local.infrastructure, content, fail);
  const storage = { ...local, capacities: effectiveCapacities(def, content), capacityVolumeUnits: def.capacityVolumeUnits };
  for (const id of Object.keys(content.resources)) {
    const amount = local.resources[id];
    validateQuantity(amount, id, content);
    if (content.utilities.includes(id) && amount > capacity(storage, id, content)) fail(`${id} quantity`);
  }
  const summary = storageSummary(storage, content);
  if (def.kind === "area" && (summary.capacityVolumeUnits || summary.usedVolumeUnits)) fail("area cargo");
}

// A transient adapter preserves the existing resource/crafting contracts. Never save it.
export function getLocationContext(state, content, world, id = state.locationId, actorId = "player") {
  const definition = locationDefinition(state, world, id), local = state.locations[id];
  if (!definition || !local || state.entities && !isEntityActive(state, id)) throw new Error(`Unknown or unavailable location: ${id}`);
  const owned = state.entities ? ownerOf(state, id) === actorId : local.ownerId === actorId;
  const access = Object.fromEntries(permissions.map(p => [p, canUse(state, actorId, id, p)]));
  const store = { resources: local.resources, infrastructure: local.infrastructure,
    capacities: effectiveCapacities(definition, content), capacityVolumeUnits: definition.capacityVolumeUnits };
  // Read compatibility projection. Production mutations use store or explicit root operations.
  // Never retain either context across a state commit.
  const actionState = { ...state, ...store, locationId: id, localFlags: local.flags, permissions: access,
    managedAccess: access.useFacilities && access.withdrawCargo && access.depositCargo };
  return { id, definition, local, owned, permissions: access, actorId, actionIds: definition.actions, store, actionState };
}

export function areaOf(state, world, id) {
  return locationDefinition(state, world, id)?.kind === "area" ? id : state.locations[id]?.areaId;
}

export function isKnown(state, world, content, id) {
  const def = locationDefinition(state, world, id);
  if (!def || state.entities && !isEntityActive(state, id)) return false;
  const ctx = getLocationContext(state, content, world, id);
  if (conditionReason(ctx.actionState, def.conditions, content)) return false;
  return def.kind === "area" || isKnown(state, world, content, ctx.local.areaId);
}

export function travelReason(state, targetId, world, content) {
  return "Direct travel is unavailable. Board a ship, travel, dock, and disembark.";
}

export function movePlayer(state, targetId, world, content) {
  const reason = travelReason(state, targetId, world, content);
  if (reason) throw new Error(reason);
}

export function locationTransferReason(state, payload, world, content, actorId = "player") {
  if (!record(payload)) return "Choose endpoints, an item or power, and an amount in Locations.";
  const { sourceId, destinationId, assetId, amount } = payload;
  if (![sourceId, destinationId].every(id => locationDefinition(state, world, id)?.kind === "site" && (!state.entities || isEntityActive(state, id)))) return "Choose two valid sites.";
  if (sourceId === destinationId) return "Choose two different sites.";
  const actorLocationId = actorId === "player" ? state.locationId : getEntityLocation(state, actorId).locationId;
  if (![sourceId, destinationId].includes(actorLocationId)) return "One endpoint must be your current location.";
  const source = getLocationContext(state, content, world, sourceId, actorId), destination = getLocationContext(state, content, world, destinationId, actorId);
  if (state.locations[actorLocationId]?.journey || source.local.journey || destination.local.journey) return "Cargo transfers are unavailable during a journey.";
  const accessReason = permissionReason(state, actorId, sourceId, "withdrawCargo") || permissionReason(state, actorId, destinationId, "depositCargo");
  if (accessReason) return accessReason;
  if (!source.local.areaId || source.local.areaId !== destination.local.areaId) return "Both sites must be in the same area.";
  if (!isKnown(state, world, content, sourceId) || !isKnown(state, world, content, destinationId)) return "Both sites must be known.";
  if (!Object.hasOwn(content.items, assetId) && assetId !== "power") return "Choose a stored item or power; installed equipment cannot be transferred.";
  if (!Number.isFinite(amount) || amount <= 0 || (assetId !== "power" && !Number.isSafeInteger(amount))) return "Enter a positive amount in the selected item's units.";
  return moveReason(source.store, destination.store, assetId, amount, content);
}

// Silent compatibility facade: physical movement/checks/presentation only.
// Semantic gameplay transfers use worldOperations.transferResources instead.
export function transferBetweenLocations(state, payload, world, content, actorId = "player") {
  const reason = locationTransferReason(state, payload, world, content, actorId);
  if (reason) throw new Error(reason);
  const { sourceId, destinationId, assetId, amount } = payload;
  moveExact(getLocationContext(state, content, world, sourceId).store,
    getLocationContext(state, content, world, destinationId).store, assetId, amount, content);
  return `Transferred ${formatQuantity(amount, assetId, content)} ${content.resources[assetId].name.toLowerCase()} to ${locationDefinition(state, world, destinationId).name}.`;
}

export function createLocationActions(world, content, effectServices, worldOperations) {
  const actions = [{ id: "inspectSite", name: "Inspect local console", access: "public",
    visible: (_state, context) => !context.local.flags.consoleExamined,
    execute(state, context) {
      const { id, definition } = context, text = definition.description;
      applyEffects(state, definition.inspectionEffects, effectServices, { kind: "inspection", locationId: id, actorId: 'player' });
      setScopedFlag(state, "location", id, "consoleExamined"); return text;
    } },
  { id: "transferLocations", name: "Transfer cargo", aliases: ["transfer"], scope: "global", group: "navigation",
    requirement: (state, _ctx, payload) => locationTransferReason(state, payload, world, content),
    execute: (state, _ctx, payload) => worldOperations ? worldOperations.transferResources(state, payload)
      : transferBetweenLocations(state, payload, world, content) }];
  const sceneFor = (ctx, payload) => payload?.targetId === ctx.id && ctx.definition.sceneObjects.find(s => s.id === payload.sceneId && !s.locationId);
  actions.push({ id: "inspectScene", name: "Inspect scene object", scope: "global", access: "public",
    targets: state => locationInstances(state, world).flatMap(def => def.sceneObjects.filter(s => !s.locationId)
      .map(s => ({ id: `inspect:${def.id}:${s.id}`, name: `Inspect ${s.name}`, payload: { targetId: def.id, sceneId: s.id } }))),
    visible: (state, ctx, payload) => { const scene = sceneFor(ctx, payload); return !!scene && !ctx.local.flags[`examined:${scene.id}`] && !conditionReason(ctx.actionState, scene.conditions, content); },
    execute(state, ctx, payload) {
      const scene = sceneFor(ctx, payload); if (!scene) throw new Error("Unknown local scene.");
      const id = ctx.id, text = scene.description;
      applyEffects(state, scene.effects, effectServices, { kind: "inspection", locationId: id, actorId: 'player' });
      setScopedFlag(state, "location", id, `examined:${scene.id}`); return text;
    } });
  return actions;
}

export function actionAssigned(action, context) {
  return action.scope === "global" || (action.locations ? action.locations.includes(context.id) : context.actionIds.includes(action.id));
}

export function validateActionScopes(actions, world) {
  const ids = new Set();
  for (const action of actions) { check(!ids.has(action.id), `duplicate action ${action.id}.`); ids.add(action.id); }
  for (const def of Object.values(world.definitions)) {
    check(def.actions.every(id => ids.has(id)), `unregistered action at ${def.id}.`);
    const commands = new Map();
    for (const action of actions.filter(a => actionAssigned(a, { id: def.id, actionIds: def.actions }))) {
      for (const raw of [action.id, action.name, ...(action.aliases ?? []), action.shortcut].filter(Boolean)) {
        const key = raw.trim().toLowerCase().replace(/^\[(\d+)\]$/, "$1");
        check(!commands.has(key) || commands.get(key) === action.id, `conflicting command "${key}" at ${def.id}.`);
        commands.set(key, action.id);
      }
    }
  }
}

export function graphView(state, world, content, areaId = null) {
  const nodes = locationInstances(state, world).filter(def => isKnown(state, world, content, def.id) &&
    (areaId ? def.kind === "site" && state.locations[def.id].areaId === areaId : def.kind === "area"))
    .map(def => ({ id: def.id, name: def.name, description: def.remoteDescription, kind: def.kind, position: def.position,
      owned: ownerOf(state, def.id) === "player", ownerId: ownerOf(state, def.id), current: def.id === state.locationId,
      containsPlayer: def.kind === "area" && areaOf(state, world, state.locationId) === def.id,
      reason: travelReason(state, def.id, world, content) }));
  if (areaId) {
    for (const def of locationInstances(state, world).filter(d => d.id === areaId || (d.kind === "site" && state.locations[d.id].areaId === areaId))) {
      if (!isKnown(state, world, content, def.id)) continue;
      const ctx = getLocationContext(state, content, world, def.id);
      for (const scene of def.sceneObjects) {
        if (conditionReason(ctx.actionState, scene.conditions, content)) continue;
        // Locations are already derived from saved membership; stale scene references add nothing.
        if (scene.locationId) continue;
        nodes.push({ id: `scene:${def.id}:${scene.id}`, name: scene.name, description: `Scene object at ${def.name}.`, kind: "object",
          ownerLocationId: def.id, actionId: `inspect:${def.id}:${scene.id}`, reason: state.locationId === def.id ? "" : `Visit ${def.name} to inspect.` });
      }
    }
  }
  const ids = new Set(nodes.map(n => n.id));
  const links = areaId ? nodes.filter(n => locationDefinition(state, world, n.id)?.mobile && ids.has(state.locations[n.id].dockedAtId))
    .map(n => [n.id, state.locations[n.id].dockedAtId]) : world.links.filter(([a, b]) => ids.has(a) && ids.has(b));
  return { nodes, links };
}

// The UI and transfer mechanics share the same endpoint policy.
export function transferOptions(state, world, content) {
  const current = state.locations[state.locationId];
  const permitted = id => canUse(state, "player", id, "withdrawCargo") || canUse(state, "player", id, "depositCargo");
  const accessible = permitted(state.locationId) && !current.journey;
  const reason = accessible ? "" : current.journey ? "Cargo transfers are unavailable during a journey." : "Requires cargo permission (ownership or a grant).";
  const endpoints = accessible ? locationInstances(state, world).filter(def =>
    def.kind === "site" && !state.locations[def.id].journey &&
    permitted(def.id) &&
    state.locations[def.id].areaId === areaOf(state, world, state.locationId) &&
    isKnown(state, world, content, def.id)) : [];
  return { accessible, reason, endpoints };
}

// Startup notices are evaluated again on reload, as before; no new saved flags.
export function startupMessages(state, world, content) {
  const context = getLocationContext(state, content, world);
  return context.definition.startupMessages.filter(message =>
    (message.equipment === undefined || context.local.infrastructure[message.equipment].health < message.healthBelow) &&
    !conditionReason(context.actionState, message.conditions, content)).map(message => message.text);
}

export function collectLocationReferences(state) {
  const refs = [entityReference("locationId", state.locationId, "occupant", "player")];
  for (const [id, local] of Object.entries(state.locations)) {
    if (isTerminal(state.entities[id])) continue;
    if (local.areaId) refs.push(entityReference(`locations.${id}.areaId`, local.areaId, "area", id));
  }
  return refs;
}
