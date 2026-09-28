import { checkedAdd, checkedMultiply, validateQuantity, VOLUME_SCALE, record } from './quantities.js';
import { validId } from './conditions.js';
import { capacityWithEquipment, validateEquipment, powerOutput, hasCapability, propulsionOutput } from './equipment.js';
import { SHIPYARD_CELL_SIZE_METERS, VESSEL_REFERENCE_MASS_KG } from './vesselModuleCatalog.js';

const fail = message => { throw new Error(`Invalid vessel: ${message}.`); };
const fields = (value, keys) => record(value) && Object.keys(value).every(k => keys.includes(k));
export function validateAssemblySyntax(assembly, { draft = false } = {}) {
  if (!fields(assembly, ['core', 'attachments']) || !Array.isArray(assembly.attachments) || (!draft && !assembly.attachments.length)) fail('exactly one core and at least one attachment required');
  if (draft && assembly.core === null && !assembly.attachments.length) return [];
  const placements = [assembly.core, ...assembly.attachments], keys = new Set();
  for (const p of placements) {
    if (!fields(p, ['key', 'moduleId', 'x', 'y']) || !validId(p.key) || !validId(p.moduleId) || keys.has(p.key) || !Number.isSafeInteger(p.x) || !Number.isSafeInteger(p.y)) fail('placement syntax or duplicate key');
    keys.add(p.key);
  }
  if (assembly.core.x !== 0 || assembly.core.y !== 0) fail('core must be anchored at origin');
  return placements;
}
export function moduleGeometry(moduleId, content) {
  const m = content.vesselModules?.[moduleId], item = content.items[moduleId];
  if (!m || !item) fail(`unknown module ${moduleId}; explicit content migration required`);
  const width = m.footprint.width * SHIPYARD_CELL_SIZE_METERS, length = m.footprint.height * SHIPYARD_CELL_SIZE_METERS;
  const volumeM3 = item.unitVolumeUnits / VOLUME_SCALE, projectedArea = width * length, depth = volumeM3 / projectedArea;
  if (![width, length, projectedArea, volumeM3, depth].every(n => Number.isFinite(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER)) fail('geometry bounds');
  const minPlane = Math.min(width, length), maxPlane = Math.max(width, length), largest = Math.max(maxPlane, depth), smallest = Math.min(minPlane, depth);
  return { moduleId, width, length, depth, volumeM3, projectedArea, dryMassKg: m.dryMassGrams / 1000,
    sizeBand: largest < 2 ? 'small' : largest < 5 ? 'medium' : 'large', elongated: maxPlane / minPlane >= 2,
    shallow: depth / minPlane <= 0.25, broadShallow: minPlane >= 1 && maxPlane / minPlane < 2 && depth / minPlane <= 0.25,
    deep: depth / maxPlane >= 1, compactPrism: largest / smallest <= 2 };
}
export function deriveVessel(assembly, content, { draft = false } = {}) {
  const placements = validateAssemblySyntax(assembly, { draft });
  if (!placements.length) fail('choose a core');
  const counts = {}, modules = placements.map((p, i) => {
    const def = content.vesselModules?.[p.moduleId];
    if (!def || def.role !== (i === 0 ? 'core' : 'attachment')) fail(`incompatible module ${p.moduleId}`);
    const xmax = p.x + def.footprint.width, ymax = p.y + def.footprint.height;
    if (!Number.isSafeInteger(xmax) || !Number.isSafeInteger(ymax)) fail('unsafe footprint extents');
    counts[p.moduleId] = checkedAdd(counts[p.moduleId] ?? 0, 1);
    return { ...p, ...moduleGeometry(p.moduleId, content), xmax, ymax, def };
  });
  const edges = modules.map(() => []);
  let contactCount = 0, sharedEdgeLength = 0;
  for (let i = 0; i < modules.length; i++) for (let j = i + 1; j < modules.length; j++) {
    const a = modules[i], b = modules[j], ox = Math.min(a.xmax, b.xmax) - Math.max(a.x, b.x), oy = Math.min(a.ymax, b.ymax) - Math.max(a.y, b.y);
    if (ox > 0 && oy > 0) fail(`overlap between ${a.key} and ${b.key}`);
    if (ox > 0 && oy === 0 || oy > 0 && ox === 0) { edges[i].push(j); edges[j].push(i); contactCount++; sharedEdgeLength += Math.max(ox, oy); }
  }
  const reached = new Set([0]), queue = [0];
  for (let head = 0; head < queue.length; head++) for (const next of edges[queue[head]]) if (!reached.has(next)) { reached.add(next); queue.push(next); }
  if (reached.size !== modules.length) fail(`disconnected attachments: ${modules.filter((_, i) => !reached.has(i)).map(m => m.key).join(', ')}`);
  const xmin = Math.min(...modules.map(m => m.x)), ymin = Math.min(...modules.map(m => m.y));
  const xmax = Math.max(...modules.map(m => m.xmax)), ymax = Math.max(...modules.map(m => m.ymax));
  const width = xmax - xmin, length = ymax - ymin;
  if (![width, length].every(n => Number.isSafeInteger(n) && n > 0)) fail('unsafe vessel envelope');
  let volumeUnits = 0, dryMassGrams = 0, cargoVolumeUnits = 0, fuelVolumeUnits = 0, occupiedArea = 0;
  const fuelIds = new Set(), propulsionFuelIds = new Set();
  for (const m of modules) {
    volumeUnits = checkedAdd(volumeUnits, content.items[m.moduleId].unitVolumeUnits);
    dryMassGrams = checkedAdd(dryMassGrams, m.def.dryMassGrams);
    cargoVolumeUnits = checkedAdd(cargoVolumeUnits, m.def.cargoVolumeUnits);
    fuelVolumeUnits = checkedAdd(fuelVolumeUnits, m.def.fuelVolumeUnits);
    occupiedArea = checkedAdd(occupiedArea, checkedMultiply(m.def.footprint.width, m.def.footprint.height));
    m.def.capabilities?.fuelStorage?.acceptedFuelItemIds.forEach(id => fuelIds.add(id));
    if (m.def.capabilities?.propulsion) propulsionFuelIds.add(m.def.capabilities.propulsion.fuelItemId);
  }
  // v1 supports one fuel type per vessel, including its tank contents.
  if (new Set([...fuelIds, ...propulsionFuelIds]).size > 1) fail('mixed fuel types are unsupported');
  const compactness = occupiedArea / checkedMultiply(width, length), core = modules[0].def.core;
  const equipment = Object.fromEntries(Object.keys(content.infrastructure).map(id => [id, { quantity: 0, health: 1, enabled: true, upgrades: [] }]));
  for (const [id, count] of Object.entries(counts)) equipment[content.vesselModules[id].group].quantity = count;
  const warnings = [];
  for (const [condition, label] of [[!hasCapability(equipment, 'propulsion', content), 'No propulsion'], [!fuelVolumeUnits, 'No fuel storage'], [!cargoVolumeUnits, 'No cargo'], [powerOutput(equipment, content) <= 0, 'No generation'], [!hasCapability(equipment, 'radio', content), 'No radio'], [!hasCapability(equipment, 'surfaceExtraction', content), 'No extraction']]) if (condition) warnings.push(label);
  return { core: { ...core }, counts, modules: modules.map(({ def, ...m }) => m), moduleCount: modules.length,
    dryMassGrams, dryMassKg: dryMassGrams / 1000, volumeUnits, volumeM3: volumeUnits / VOLUME_SCALE,
    cargoVolumeUnits, fuelVolumeUnits, acceptedFuelItemIds: [...fuelIds], equipment, warnings,
    geometry: { xmin, ymin, xmax, ymax, width, length, depth: Math.max(...modules.map(m => m.depth)), occupiedArea, compactness, contactCount, sharedEdgeLength,
      compactCluster: compactness >= 0.75 && modules.length >= 2, elongated: Math.max(width, length) / Math.min(width, length) >= 2, sparse: compactness <= 0.60 } };
}
export function vesselDefinition(local, definition, content) {
  if (!local?.assembly) return definition;
  const core = content.vesselModules?.[local.assembly.core?.moduleId]?.core;
  if (!core) fail('missing or incompatible core definition');
  return { ...definition, ...core };
}
export function vesselSpeed(derived, infrastructure, content, multiplier = 1) {
  return multiplier * propulsionOutput(infrastructure, 'propulsion', content) * VESSEL_REFERENCE_MASS_KG / derived.dryMassKg;
}
export function initializeVessel(local, assembly, content) {
  const preview = deriveVessel(assembly, content);
  local.assembly = { core: structuredClone(assembly.core), attachments: structuredClone(assembly.attachments).sort((a, b) => a.key.localeCompare(b.key)) };
  local.fuel = { items: {} };
  for (const [id, count] of Object.entries(preview.counts)) local.infrastructure[content.vesselModules[id].group] = { quantity: count, health: 1, enabled: true, upgrades: [] };
}
function checkFuel(local, preview, content) {
  if (!fields(local.fuel, ['items']) || !record(local.fuel.items)) fail('fuel storage shape');
  for (const [id, amount] of Object.entries(local.fuel.items)) {
    if (content.items[id]?.category !== 'component' || !preview.acceptedFuelItemIds.includes(id)) fail(`incompatible fuel ${id}`);
    validateQuantity(amount, id, content);
    checkedMultiply(amount, content.items[id].unitVolumeUnits);
  }
}
export function reconcileVessels(state, content, world) {
  for (const [id, local] of Object.entries(state.locations)) {
    const entity = state.entities?.[id], base = world.definitions[entity?.definition?.id];
    if (['retired', 'destroyed'].includes(entity?.lifecycle)) { if (local.assembly) validateAssemblySyntax(local.assembly); continue; }
    if (!Object.hasOwn(local, 'assembly')) { if (base?.modularVessel) fail(`missing assembly on ${id}`); continue; }
    if (entity?.type !== 'ship' || !base?.modularVessel) fail(`assembly on incompatible entity ${id}`);
    const preview = deriveVessel(local.assembly, content);
    if (!record(local.resources) || !Object.hasOwn(local.resources, 'power')) fail(`missing required power at ${id}`);
    validateQuantity(local.resources.power, 'power', content);
    if (!record(local.infrastructure)) fail(`missing equipment at ${id}`);
    // Only absent newly introduced groups may receive neutral defaults. Present
    // condition is validated before membership counts are rebuilt.
    const equipment = { ...local.infrastructure };
    for (const group of Object.keys(content.infrastructure)) if (!Object.hasOwn(equipment, group)) equipment[group] = { quantity: 0, health: 1, enabled: true, upgrades: [] };
    validateEquipment(equipment, content, fail);
    for (const [group, def] of Object.entries(content.infrastructure)) if (def.assemblyOwned) {
      if (!Object.hasOwn(local.infrastructure, group)) local.infrastructure[group] = { quantity: 0, health: 1, enabled: true, upgrades: [] };
      local.infrastructure[group].quantity = preview.counts[def.itemId] ?? 0;
    }
    if (!Object.hasOwn(local, 'fuel')) local.fuel = { items: {} };
    checkFuel(local, preview, content);
    const reserve = capacityWithEquipment(base.capacities?.power ?? 0, local.infrastructure, 'power', content);
    validateQuantity(reserve, 'power', content);
    local.resources.power = Math.min(local.resources.power, reserve);
  }
}
export function validateVessels(state, content, world) {
  for (const [id, local] of Object.entries(state.locations)) {
    const entity = state.entities?.[id], base = world.definitions[entity?.definition?.id];
    if (['retired', 'destroyed'].includes(entity?.lifecycle)) {
      if (Object.hasOwn(local, 'assembly')) validateAssemblySyntax(local.assembly);
      if (local.fuel !== undefined && (!fields(local.fuel, ['items']) || !record(local.fuel.items) || Object.entries(local.fuel.items).some(([id, n]) => !validId(id) || !Number.isSafeInteger(n) || n < 0))) fail('retained fuel');
      continue;
    }
    if (!Object.hasOwn(local, 'assembly')) { if (base?.modularVessel || local.fuel !== undefined) fail(`missing assembly on ${id}`); }
    else {
      if (entity?.type !== 'ship' || !base?.modularVessel) fail(`incompatible assembly on ${id}`);
      const preview = deriveVessel(local.assembly, content);
      checkFuel(local, preview, content);
      if (!preview.core.boardable && (state.locationId === id || Object.values(state.npcs ?? {}).some(n => n.locationId === id))) fail(`autonomous vessel ${id} cannot carry occupants`);
      for (const [group, def] of Object.entries(content.infrastructure)) if (!def.assemblyOwned && local.infrastructure[group]?.quantity) fail('ordinary equipment cannot bypass vessel composition');
    }
    for (const [group, def] of Object.entries(content.infrastructure)) if (def.assemblyOwned && (local.infrastructure?.[group]?.quantity ?? 0) !== (local.assembly ? deriveCount(local.assembly, def.itemId) : 0)) fail(`installed membership mismatch at ${id}/${group}`);
  }
}
function deriveCount(assembly, id) { return [assembly.core, ...assembly.attachments].filter(p => p.moduleId === id).length; }
