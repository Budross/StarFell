import { deriveVessel } from './vessels.js';
import { getLocationContext } from './locations.js';
import { permissionReason } from './authority.js';
import { createEntity } from './entityCreation.js';
import { previewExchange, transfer } from './resources.js';
import { checkedAdd, record } from './quantities.js';

export function createShipyardDraft(yardId) { return { yardId, core: null, attachments: [], nextKey: 1, name: '' }; }
export function draftAssembly(draft) { return { core: draft.core, attachments: draft.attachments }; }
export function placeDraftModule(draft, moduleId, x, y, content) {
  const next = structuredClone(draft), module = content.vesselModules[moduleId];
  if (!module) throw new Error('Choose a compatible module.');
  if (module.role === 'core') next.core = { key: 'core', moduleId, x: 0, y: 0 };
  else {
    if (!next.core) throw new Error('Place a core first.');
    next.attachments.push({ key: `module${next.nextKey++}`, moduleId, x, y });
  }
  // Disconnection is editable. Overlap and unsafe rectangles are not accepted.
  checkDraftRectangles(next, content);
  return next;
}
function checkDraftRectangles(draft, content) {
  const placements = [draft.core, ...draft.attachments].filter(Boolean);
  for (const p of placements) {
    const m = content.vesselModules[p.moduleId];
    if (!m || !Number.isSafeInteger(p.x) || !Number.isSafeInteger(p.y) || !Number.isSafeInteger(p.x + m.footprint.width) || !Number.isSafeInteger(p.y + m.footprint.height)) throw new Error('Invalid module coordinates.');
  }
  for (let i = 0; i < placements.length; i++) for (let j = i + 1; j < placements.length; j++) {
    const a = placements[i], b = placements[j], ad = content.vesselModules[a.moduleId], bd = content.vesselModules[b.moduleId];
    if (Math.min(a.x + ad.footprint.width, b.x + bd.footprint.width) > Math.max(a.x, b.x) && Math.min(a.y + ad.footprint.height, b.y + bd.footprint.height) > Math.max(a.y, b.y)) throw new Error('Modules cannot overlap.');
  }
}
export function moveDraftModule(draft, key, x, y, content) {
  const next = structuredClone(draft), p = next.attachments.find(p => p.key === key);
  if (!p) throw new Error('The core stays at the origin; choose an attachment.');
  p.x = x; p.y = y; checkDraftRectangles(next, content); return next;
}
export function removeDraftModule(draft, key) {
  const next = structuredClone(draft);
  if (key === 'core') { next.core = null; next.attachments = []; }
  else next.attachments = next.attachments.filter(p => p.key !== key);
  return next;
}
export function shipyardReason(state, yardId, services, actorId = 'player') {
  try {
    const ctx = getLocationContext(state, services.content, services.world, yardId, actorId);
    if (yardId !== state.locationId || ctx.definition.mobile || !ctx.definition.shipyard) return 'Use the Shipyard at your occupied stationary berth.';
    if (!services.world.definitions.modularVessel?.modularVessel) return 'This yard has no modular vessel template.';
    return ['useFacilities', 'withdrawCargo', 'manageEquipment'].map(p => permissionReason(state, actorId, yardId, p)).find(Boolean) ?? '';
  } catch (error) { return error.message; }
}
export function previewAssembly(state, request, services, actorId = 'player') {
  try {
    if (!record(request) || Object.keys(request).some(k => !['yardId', 'name', 'assembly'].includes(k))) throw new Error('Invalid assembly request.');
    if (request.name !== undefined && (typeof request.name !== 'string' || request.name.trim().length > 80 || /[\x00-\x1f]/.test(request.name))) throw new Error('Vessel name must contain at most 80 printable characters.');
    const reason = shipyardReason(state, request.yardId, services, actorId); if (reason) throw new Error(reason);
    const vessel = deriveVessel(request.assembly, services.content), cost = { ...vessel.counts, power: 2 };
    cost.structuralFrame = checkedAdd(cost.structuralFrame ?? 0, vessel.moduleCount);
    const stock = previewExchange(getLocationContext(state, services.content, services.world, request.yardId, actorId).store, cost, {}, services.content);
    return { ok: stock.ok, reason: stock.reason, vessel, cost };
  } catch (error) { return { ok: false, reason: error.message }; }
}
export function assembleVessel(state, request, services, actorId = 'player') {
  const preview = previewAssembly(state, request, services, actorId);
  if (!preview.ok) throw new Error(preview.reason);
  const yard = getLocationContext(state, services.content, services.world, request.yardId, actorId);
  transfer(yard.store, preview.cost, {}, services.content);
  const id = createEntity(state, services, { type: 'ship', definitionId: 'modularVessel', displayName: request.name?.trim() || (preview.vessel.core.boardable ? 'Crewed vessel' : 'Autonomous vessel'),
    areaId: yard.local.areaId, dockedAtId: yard.id, ownerId: actorId, controllerId: actorId, access: { public: [], grants: {} }, assembly: request.assembly });
  services.ledgerServices.append(state, { type: 'VESSEL_ASSEMBLED', actorId, targetId: id, locationId: yard.id, areaId: yard.local.areaId, data: {} });
  return id;
}
