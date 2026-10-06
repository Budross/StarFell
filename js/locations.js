import { hasPropulsionDefinition } from './shipEquipment.js';
import { vesselLinkReason } from './vesselLinkPolicy.js';
import { setScopedFlag } from "./flags.js";
import { validateEquipment } from "./equipment.js";
import { validateConditions,conditionContracts } from "./conditions.js";
import { conditionReason } from "./conditionContext.js";
import { collectDiscoveryReferences, conditionEntityReferences } from "./conditionReferences.js";
import { capacity, moveExact, moveReason, observeItemReceipts } from "./resources.js";
import { compileAmounts, volumeUnits, validateQuantity, formatQuantity } from "./quantities.js";
import { storageSummary } from "./storage.js";
import { locationDefinition, locationInstances, getEntityLocation } from "./entityQueries.js";
import { isEntityActive } from "./entities.js";
import { canUse, permissionReason, permissions, ownerOf, defaultAccess, validateAccess } from "./authority.js";
import { encounterItem } from './itemKnowledgeState.js';
import { hasCapability } from './equipment.js';
import { validateLearningPolicy } from './itemKnowledgePolicy.js';
import { entityReference } from "./entityReferences.js";
import { isTerminal } from "./entities.js";
import { compileResourceNodes } from './processingCatalog.js';
import { compileEffects, describeEffects, applyEffects } from "./effects.js";
import { validateNarrativeMetadata,mergeNarrativeMetadata } from './narrative/narrativeMetadata.js';
import {getEntity,validEntityId} from './entities.js';
import {cellAt,containsPosition,validateSpace,distance,compareKeys} from './worldSpace.js';
import {areaKnowledge,admitKnownArea,admitDetectedArea,detectedContacts} from './mapKnowledge.js';

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const validId = id => typeof id === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(id) && !["constructor", "prototype", "__proto__"].includes(id);
const check = (ok, message) => { if (!ok) throw new Error(`Invalid locations: ${message}`); };
const union = (...lists) => [...new Set(lists.flat())];

export function locationProducerMetadata(world) {
  return Object.values(world.definitions).flatMap(def=>[
    ...Object.entries(def.initialFlags??{}).filter(([,value])=>value===true).map(([flag])=>({kind:'flag',scope:'location',targetId:def.id,flag,value:true})),
    ...['consoleExamined',...def.sceneObjects.filter(s=>!s.locationId).map(s=>`examined:${s.id}`)].map(flag=>({kind:'flag',scope:'location',targetId:def.id,flag,value:true}))
  ]);
}

export function compileLocationCatalog(source, content) {
  try { return compileLocations(source, content); }
  catch (error) { throw Object.assign(new Error(error.message.startsWith("Invalid locations:") ? error.message : `Invalid locations: ${error.message}`),{path:error.path}); }
}
function compileLocations(source, content) {
  check(record(source.types) && record(source.locations), "types and locations are required.");
  check(Number.isFinite(source.connectionDistance) && source.connectionDistance > 0, "connection distance must be positive.");
  const definitions = {}, conditionSources = [];
  function conditions(value = {},path) {
    validateConditions(value, { content,contract:conditionContracts.state,conditionSources,locationId:path.split('.')[1] }, path);
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
      check(validId(def.propulsionCapability) && hasPropulsionDefinition(content,def.propulsionCapability), `propulsionCapability for ${id}.`);
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
    if (def.kind === "area") {
      check(Array.isArray(def.position) && def.position.length === 2 && def.position.every(Number.isFinite) && !def.areaId, `area position for ${id}.`);
      check(def.initialMapKnowledge===undefined || ['UNKNOWN','DETECTED','KNOWN'].includes(def.initialMapKnowledge),`map knowledge for ${id}.`);
      check(def.generationConstraints===undefined || record(def.generationConstraints) && Object.keys(def.generationConstraints).every(k=>['exclusionRadius','minimumSpacing'].includes(k)) && Object.values(def.generationConstraints).every(n=>Number.isFinite(n)&&n>=0),`generation constraints for ${id}.`);
    }
    def.nodeStatePolicy='catalogReconciled';
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
        conditions(scene.conditions,`locations.${id}.sceneObjects.${scene.id}.conditions`);
        scenes.set(scene.id, structuredClone(scene));
      }
    }
    for (const removed of authored.removeSceneObjects ?? []) { check(scenes.has(removed), `unknown removed scene ${removed}.`); scenes.delete(removed); }
    def.sceneObjects = [...scenes.values()];
    conditions(def.conditions,`locations.${id}.conditions`);
    conditions(def.accessConditions,`locations.${id}.accessConditions`);
    def.startupMessages ??= [];
    check(Array.isArray(def.startupMessages), `startup messages on ${id}.`);
    for (const message of def.startupMessages) {
      check(record(message) && typeof message.text === "string" && message.text.trim(), `startup message on ${id}.`);
      conditions(message.conditions,`locations.${id}.startupMessages.${def.startupMessages.indexOf(message)}.conditions`);
      if (message.equipment !== undefined || message.healthBelow !== undefined) {
        check(Object.hasOwn(content.infrastructure, message.equipment) && Number.isFinite(message.healthBelow) &&
          message.healthBelow >= 0 && message.healthBelow <= 1, `startup equipment on ${id}.`);
      }
    }
    for (const [asset, amount] of Object.entries(def.capacities)) check(content.utilities.includes(asset) && Number.isFinite(amount) && amount >= 0 && amount <= Number.MAX_SAFE_INTEGER, `utility capacity ${id}/${asset}.`);
    def.initialResources = compileAmounts(def.initialResources, content);
    if(def.kind==='area')check(Object.values(def.initialResources).every(n=>n===0)&&Object.values(def.initialInfrastructure).every(e=>!e.quantity),`area cannot carry cargo or equipment (${id}).`);
    check(Object.keys(def.initialInfrastructure).every(group => Object.hasOwn(content.infrastructure, group)), `unknown infrastructure on ${id}.`);
    definitions[id] = def;
  }
  for (const def of Object.values(definitions)) {
    if(def.primaryLocalId!==undefined)check(def.kind==='area' && definitions[def.primaryLocalId]?.kind==='site' && !definitions[def.primaryLocalId].mobile && definitions[def.primaryLocalId].areaId===def.id,`primary Local for ${def.id}.`);
    for (const node of Object.values(def.resourceNodes ?? {})) validateLearningPolicy(node.learnWhen,{ content,world:{ definitions },conditionSources,locationId:def.id },`locations.${def.id}.nodes.${node.id}`);
    def.inspectionEffects = compileEffects(def.inspectionEffects, { content, world: { definitions },contract:conditionContracts.state }, { kind: "inspection" }, `locations.${def.id}.inspectionEffects`);
    for (const scene of def.sceneObjects) {
      check(!scene.locationId || scene.effects === undefined, `location scene cannot have inspection effects (${def.id}/${scene.id}).`);
      scene.effects = compileEffects(scene.effects, { content, world: { definitions },contract:conditionContracts.state }, { kind: "inspection" }, `locations.${def.id}.sceneObjects.${scene.id}.effects`);
    }
    if (def.kind === "site" && def.spawn !== false) check(definitions[def.areaId]?.kind === "area", `unknown area on ${def.id}.`);
    if (def.mobile && def.initialDockedAtId !== null && def.spawn !== false) {
      const dock = definitions[def.initialDockedAtId];
      check(dock?.kind === "site" && !dock.mobile && dock.areaId === def.areaId, `initialDockedAtId for ${def.id}.`);
    }
    for (const scene of def.sceneObjects) if (scene.locationId) check(Object.hasOwn(definitions, scene.locationId), `unknown scene location ${scene.locationId}.`);
    for (const cond of [def.conditions, def.accessConditions, ...def.sceneObjects.map(s => s.conditions), ...def.startupMessages.map(m => m.conditions)]) {
      validateConditions(cond, { content, world: { definitions },contract:conditionContracts.state }, `locations ${def.id}`);
    }
  }
  // Item conditions stay owned by the item catalog; cross-catalog references are checked here.
  function references(value) {
    if (!value || typeof value !== "object") return;
    if (value.conditions) validateConditions(value.conditions, { content, world: { definitions },contract:conditionContracts.state }, "locations item conditions");
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
    [def.conditions, def.accessConditions, ...Object.values(def.resourceNodes ?? {}).map(n => n.learnWhen?.conditions), ...def.sceneObjects.map(scene => scene.conditions), ...def.startupMessages.map(message => message.conditions)]),
    effectMetadata.filter(m => m.kind === "discovery" && m.access === "produce").map(m => m.id));
  const world = { conditionSources,definitions, links, connectionDistance:source.connectionDistance,startId: source.startId, discoveryReferences, effectSources, vesselModules: content.vesselModules,
    initialSpawns: Object.values(definitions).filter(d => d.spawn !== false).map(d => ({ id: d.id, definitionId: d.id,
      areaId: d.kind === "site" ? d.areaId : null, dockedAtId: d.mobile ? d.initialDockedAtId : null,
      ownerId: d.initialOwnerId, controllerId: d.initialControllerId, access: structuredClone(d.initialAccess), lifecycle: d.initialLifecycle })) };
  Object.defineProperty(world,'resolveLocationDefinition',{value:(state,id)=>resolveLocationDefinition(state,world,id),enumerable:false});
  world.entityReferences = Object.values(definitions).flatMap(def => [
    ...[def.conditions, def.accessConditions, ...Object.values(def.resourceNodes ?? {}).map(n => n.learnWhen?.conditions), ...def.sceneObjects.map(s => s.conditions), ...def.startupMessages.map(m => m.conditions)]
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
    resources: Object.fromEntries((def.kind==='area'?content.utilities:Object.keys(content.resources)).map(id => [id, def.initialResources[id] ?? 0])),
    infrastructure: Object.fromEntries((def.kind==='area'?[]:Object.keys(content.infrastructure)).map(id => [id, {
      quantity: 0, health: 1, enabled: true, upgrades: [], ...structuredClone(def.initialInfrastructure[id] ?? {})
    }])), flags: {}, resourceNodes: Object.fromEntries(Object.entries(def.resourceNodes ?? {}).map(([id,node]) => [id,{ resourceId: node.resourceId, remaining: node.initialReserve }]))
  };
}

export function effectiveCapacities(def, content) {
  return Object.fromEntries(content.utilities.map(id => [id, def.capacities[id] ?? (def.kind === "area" ? 0 : content.resources[id].baseCapacity)]));
}

const neutralAreaEquipment=new WeakMap();
function areaInfrastructure(local,content) {
  if(!neutralAreaEquipment.has(content))neutralAreaEquipment.set(content,Object.freeze(Object.fromEntries(Object.keys(content.infrastructure).map(id=>[id,Object.freeze({quantity:0,health:1,enabled:true,upgrades:Object.freeze([])})]))));
  const neutral=neutralAreaEquipment.get(content);
  return Object.keys(local.infrastructure).length?{...neutral,...local.infrastructure}:neutral;
}

export function validateLocalState(local, def, content, world, unplaced = false) {
  const fail = message => { throw new Error(`Invalid ${message} at ${def.name}.`); };
  if (!record(local) || !(local.ownerId === undefined || local.ownerId === null || validId(local.ownerId)) ||
      (!unplaced && (def.kind === "area" ? local.areaId !== null : world.definitions[local.areaId]?.kind !== "area"))) fail("ownership or area");
  if (!record(local.resources) || !record(local.infrastructure) || !record(local.flags) || Object.values(local.flags).some(v => typeof v !== "boolean")) fail("local assets or flags");
  if (Object.keys(local.resources).some(id => !Object.hasOwn(content.resources, id)) || Object.keys(local.infrastructure).some(id => !Object.hasOwn(content.infrastructure, id))) fail("unknown saved asset");
  validateEquipment(def.kind==='area'?areaInfrastructure(local,content):local.infrastructure, content, fail);
  if(def.kind==='area'&&Object.values(local.infrastructure).some(e=>e.quantity!==0))fail('area equipment');
  const storage = { ...local, capacities: effectiveCapacities(def, content), capacityVolumeUnits: def.capacityVolumeUnits };
  for (const id of Object.keys(content.resources)) {
    const amount = def.kind==='area'?(local.resources[id]??0):local.resources[id];
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
  const store = { resources: local.resources, infrastructure: definition.kind==='area'?areaInfrastructure(local,content):local.infrastructure,
    capacities: effectiveCapacities(definition, content), capacityVolumeUnits: definition.capacityVolumeUnits };
  observeItemReceipts(local.resources,rewards => {
      const contact=definition.controlMode!=='commanded' || !vesselLinkReason(state,id,{world,content,isKnown:(s,target)=>isKnown(s,world,content,target)});
      if (actorId === 'player' && contact && access.viewCargo && (id === state.locationId || owned)) for (const [itemId,amount] of Object.entries(rewards))
        if (amount > 0 && Object.hasOwn(content.items,itemId)) encounterItem(state,itemId);
  });
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
  if(def.kind==='area'&&state.mapKnowledge&&areaKnowledge(state,id)!=='KNOWN')return false;
  const ctx = getLocationContext(state, content, world, id);
  if (conditionReason(ctx.actionState, def.conditions, content)) return false;
  return def.kind === "area" ? !state.mapKnowledge || areaKnowledge(state,id)==='KNOWN' : isKnown(state, world, content, ctx.local.areaId);
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

export function graphView(state, world, content, areaId = null, { revealAll = false } = {}) {
  const origin=locationDefinition(state,world,areaOf(state,world,state.locationId))?.position;
  const remembered=new Set(Object.keys(state.vesselReports?.byVessel ?? {}));
  const drones=new Set([...remembered,...locationInstances(state,world).filter(d=>d.controlMode==='commanded').map(d=>d.id)]);
  const nodes = locationInstances(state, world).filter(def => !drones.has(def.id) && (revealAll || isKnown(state, world, content, def.id)) &&
    (areaId ? def.kind === "site" && state.locations[def.id].areaId === areaId : def.kind === "area"))
    .map(def => ({ id: def.id, name: def.name, description: def.remoteDescription, kind: def.kind, position: def.position,
      ...(origin && def.position?{distance:distance(origin,def.position)}:{}),
      owned: ownerOf(state, def.id) === "player", ownerId: ownerOf(state, def.id), current: def.id === state.locationId,
      containsPlayer: def.kind === "area" && areaOf(state, world, state.locationId) === def.id,
      ...(revealAll && !isKnown(state, world, content, def.id) ? { debugVisible: true } : {}),
      reason: travelReason(state, def.id, world, content) }));
  if(areaId && world.observableVesselStatus)for(const id of drones) {
    const visible=world.observableVesselStatus(state,id);if(visible.areaId!==areaId)continue;
    nodes.push({id,name:visible.name,kind:'site',drone:true,mobile:true,owned:true,ownerId:'player',current:false,observable:visible,
      description:`${visible.classification.replaceAll('_',' ')}${visible.observedAt!==null?` · observed at ${Math.floor(visible.observedAt)}s`:''}`,reason:''});
  }
  const ids = new Set(nodes.map(n => n.id));
  const dockFor=n=>n.drone?n.observable.dockedAtId:state.locations[n.id]?.dockedAtId;
  const links = areaId ? nodes.filter(n => (n.mobile || locationDefinition(state, world, n.id)?.mobile) && ids.has(dockFor(n)))
    .map(n => [n.id, dockFor(n)]) : physicalLinks(state,world).filter(([a, b]) => ids.has(a) && ids.has(b));
  if(!areaId && !revealAll)nodes.push(...detectedContacts(state));
  return { nodes, links, ...(!areaId&&state.worldGeography?{space:state.worldGeography.space}:{}) };
}

// Locations owns the composed definition boundary. Entities only delegates this
// read; provenance is irrelevant to consumers after installation.
export function resolveLocationDefinition(state,world,locationId) {
  const ref=getEntity(state,locationId)?.definition;
  const id=ref?.id??locationId;
  const saved=state.worldGeography?.generatedLocationFactsById;
  const def=(saved && Object.hasOwn(saved,id)?saved[id]:undefined) ?? (Object.hasOwn(world.definitions,id)?world.definitions[id]:undefined);
  const anchor=state.worldGeography?.areas[locationId];
  return def && anchor ? {...def,position:[...anchor.position],primaryLocalId:anchor.primaryLocalId} : def;
}
export const physicalLinks=(state,world)=>state.worldGeography?.physicalEdges??world.links;
export function freezeAuthoredGeography(state,world,seed=null,extent) {
  const defs=locationInstances(state,world,['active','inactive']).filter(d=>d.kind==='area');
  // Custom test/authoring worlds can exceed production bounds. Freeze their own
  // bounded extent instead of moving existing coordinates during migration.
  const space=extent??{min:[0,1].map(i=>Math.min(-320,...defs.map(d=>Math.floor(d.position[i]/10)*10))),max:[0,1].map(i=>Math.max(320,...defs.map(d=>Math.floor(d.position[i]/10)*10+10))),cellSize:10};
  return {schemaVersion:1,seed,generatorRevision:null,connectionDistance:world.connectionDistance??120,space:structuredClone(space),areas:Object.fromEntries(defs.sort((a,b)=>compareKeys(a.id,b.id)).map(d=>[d.id,{position:[...d.position],cell:cellAt(space,d.position),primaryLocalId:d.primaryLocalId??null}])),generatedLocationFactsById:{},physicalEdges:world.links.map(e=>[...e].sort(compareKeys)).sort((a,b)=>compareKeys(a.join('/'),b.join('/')))};
}
export function reconcileAuthoredMapKnowledge(state,world,content,initial=false) {
  let changed=false;
  for(const def of locationInstances(state,world).filter(d=>d.kind==='area' && world.definitions[d.definitionId??d.id])) {
    const configured=world.definitions[def.definitionId??def.id],explicit=configured.initialMapKnowledge;
    const ready=!conditionReason(getLocationContext(state,content,world,def.id).actionState,configured.conditions,content);
    const legacyReveal=explicit===undefined&&ready;
    if(initial&&explicit==='DETECTED')changed=admitDetectedArea(state,def.id,def.position,'Authored starting chart')||changed;
    else if(initial&&explicit==='KNOWN'||legacyReveal)changed=admitKnownArea(state,def.id)||changed;
  }
  // Occupancy is observation, including legacy saves at otherwise hidden Areas.
  const occupied=areaOf(state,world,state.locationId);
  if(occupied)changed=admitKnownArea(state,occupied)||changed;
  return changed;
}
export function validateWorldGeography(state,content,world) {
  const g=state.worldGeography,fail=detail=>{throw new Error(`Invalid physical geography: ${detail}.`);};
  if(!record(g)||g.schemaVersion!==1||!record(g.areas)||!record(g.generatedLocationFactsById)||!Array.isArray(g.physicalEdges)||!(g.seed===null||Number.isSafeInteger(g.seed)&&g.seed>=0&&g.seed<=0xffffffff)||!(g.generatorRevision===null||typeof g.generatorRevision==='string'&&g.generatorRevision.trim()))fail('header');
  if(Object.keys(g).some(k=>!['schemaVersion','seed','generatorRevision','acceptedAttempt','connectionDistance','space','areas','generatedLocationFactsById','physicalEdges'].includes(k))||!Number.isFinite(g.connectionDistance)||g.connectionDistance<=0)fail('unexpected fields/range');
  validateSpace(g.space);
  if(g.acceptedAttempt!==undefined&&(!Number.isSafeInteger(g.acceptedAttempt)||g.acceptedAttempt<0||g.acceptedAttempt>=8))fail('attempt');
  const cells=new Set();
  for(const [id,a] of Object.entries(g.areas)) {
    if(getEntity(state,id)?.type!=='area'||!record(a)||!containsPosition(g.space,a.position)||!Array.isArray(a.cell)||JSON.stringify(a.cell)!==JSON.stringify(cellAt(g.space,a.position))||Object.keys(a).some(k=>!['position','cell','primaryLocalId','placementKey'].includes(k)))fail(`anchor ${id}`);
    if(a.primaryLocalId!==null&&(getEntity(state,a.primaryLocalId)?.type!=='site'||state.locations[a.primaryLocalId]?.areaId!==id))fail(`primary Local ${id}`);
    const key=a.cell.join('/');if(cells.has(key))fail('overlapping cells');cells.add(key);
  }
  for(const e of Object.values(state.entities))if(e.type==='area'&&!isTerminal(e)&&!g.areas[e.id])fail(`missing anchor ${e.id}`);
  for(const [id,def] of Object.entries(g.generatedLocationFactsById)) {
    const e=getEntity(state,id);
    if(!validEntityId(id)||!record(def)||def.id!==id||e?.definition?.id!==id||e?.definition?.catalog!=='locations'||e.type!==def.kind||world.definitions[id]||!['area','site'].includes(def.kind)||def.mobile||typeof def.name!=='string'||!def.name.trim()||!record(def.resourceNodes)||!Array.isArray(def.actions)||!Array.isArray(def.sceneObjects)||!record(def.initialInfrastructure)||!record(def.initialResources)||!record(def.capacities))fail(`definition ${id}`);
    if(def.kind==='site'&&(!g.areas[def.areaId]||def.nodeStatePolicy!=='frozenRuntime'))fail(`site ${id}`);
    if(def.bodyCharacter && (!record(def.bodyCharacter)||!['small','ordinary','large','massive'].includes(def.bodyCharacter.scale)||typeof def.bodyCharacter.dominant!=='string'||!record(def.bodyCharacter.materials)||Object.values(def.bodyCharacter.materials).some(n=>!Number.isSafeInteger(n)||n<0||n>10000)))fail(`physical character ${id}`);
    if(def.kind==='area'&&JSON.stringify(def.position)!==JSON.stringify(g.areas[id].position))fail(`position ${id}`);
    const resources=new Set();
    for(const [nodeId,n] of Object.entries(def.resourceNodes)) {
      if(!validEntityId(nodeId)||n.id!==nodeId||content.items[n.resourceId]?.category!=='resource'||resources.has(n.resourceId)||!Number.isSafeInteger(n.initialReserve)||n.initialReserve<=0||volumeUnits(n.initialReserveM3)!==n.initialReserve||!Array.isArray(n.tags)||!n.tags.every(validEntityId))fail(`deposit ${id}/${nodeId}`);
      resources.add(n.resourceId);
    }
  }
  const edgeSet=new Set();
  for(const e of g.physicalEdges){if(!Array.isArray(e)||e.length!==2||e[0]===e[1]||!e.every(id=>g.areas[id])||distance(g.areas[e[0]].position,g.areas[e[1]].position)>g.connectionDistance||edgeSet.has([...e].sort(compareKeys).join('/')))fail('edge');edgeSet.add([...e].sort(compareKeys).join('/'));}
  if(g.generatorRevision!==null) {
    const reached=new Set([Object.keys(g.areas)[0]]);let changed=true;
    while(changed){changed=false;for(const [a,b] of g.physicalEdges)if(reached.has(a)!==reached.has(b)){reached.add(a);reached.add(b);changed=true;}}
    if(reached.size!==Object.keys(g.areas).length)fail('disconnected physical map');
  }
  // No generator dependency: frozen facts remain valid under newer profiles.
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
