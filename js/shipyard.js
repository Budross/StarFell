import { deriveVessel } from './vessels.js';
import { getLocationContext } from './locations.js';
import { permissionReason } from './authority.js';
import { createEntity } from './entityCreation.js';
import { previewExchange, transfer } from './resources.js';
import { checkedAdd, record } from './quantities.js';
import { hasCapability } from './equipment.js';

export function createShipyardDraft(yardId) { return { yardId, core: null, attachments: [], nextKey: 1, name: '' }; }
export function draftAssembly(draft) { return { core: draft.core, attachments: draft.attachments }; }
function rebaseCore(draft, x, y, content) {
  const m = content.vesselModules[draft.core.moduleId];
  if (![x, y, x + m.footprint.width, y + m.footprint.height].every(Number.isSafeInteger)) throw new Error('Invalid module coordinates.');
  for (const p of draft.attachments) { p.x -= x; p.y -= y; }
}
export function placeDraftModule(draft, moduleId, x, y, content) {
  const next = structuredClone(draft), module = content.vesselModules[moduleId];
  if (!module) throw new Error('Choose a compatible module.');
  if (module.role === 'core') {
    next.core = { key: 'core', moduleId, x: 0, y: 0 };
    rebaseCore(next, x, y, content);
  }
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
  const next = structuredClone(draft), p = [next.core, ...next.attachments].find(p => p?.key === key);
  if (!p) throw new Error('Choose a placed module.');
  if (key === 'core') rebaseCore(next, x, y, content);
  else { p.x = x; p.y = y; }
  checkDraftRectangles(next, content); return next;
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

export function previewVesselDesign(state,request,services,actorId='player'){
  try{
    if(!record(request)||Object.keys(request).some(k=>!['designId','revision','yardId','name'].includes(k)))throw new Error('Invalid vessel design request.');
    const design=services.vesselDesigns?.[request.designId];if(!design||request.revision!==design.revision)throw new Error('Vessel design revision changed. Review the current design.');
    const reason=shipyardReason(state,request.yardId,services,actorId);if(reason)throw new Error(reason);
    if(request.name!==undefined&&(typeof request.name!=='string'||request.name.trim().length>80||/[\x00-\x1f]/.test(request.name)))throw new Error('Vessel name must contain at most 80 printable characters.');
    if(!state.knowledge.discoveries[design.discoveryId]||design.principles.some(id=>!state.knowledge.discoveries[id]))throw new Error('Study the operated source vessel and understand its principles first.');
    const yard=getLocationContext(state,services.content,services.world,request.yardId,actorId);
    if(!hasCapability(yard.local.infrastructure,'fabrication',services.content))throw new Error('Requires an operational fabrication facility at the Shipyard.');
    const exchange=previewExchange(yard.store,design.cost,{},services.content);
    return {ok:exchange.ok,reason:exchange.reason,design,cost:design.cost,vessel:deriveVessel(design.assembly,services.content)};
  }catch(error){return {ok:false,reason:error.message};}
}
export function manufactureVesselDesign(state,request,services,actorId='player'){
  const p=previewVesselDesign(state,request,services,actorId);if(!p.ok)throw new Error(p.reason);
  const yard=getLocationContext(state,services.content,services.world,request.yardId,actorId);
  transfer(yard.store,p.cost,{},services.content);
  const id=createEntity(state,services,{type:'ship',definitionId:'modularVessel',displayName:request.name?.trim()||p.design.name,areaId:yard.local.areaId,dockedAtId:yard.id,ownerId:actorId,controllerId:actorId,access:{public:[],grants:{}},assembly:structuredClone(p.design.assembly)});
  state.locations[id].designOrigin={designId:p.design.id,revision:p.design.revision,family:p.design.family};
  services.ledgerServices.append(state,{type:'VESSEL_ASSEMBLED',actorId,targetId:id,locationId:yard.id,areaId:yard.local.areaId,data:{}});
  return id;
}
