import { record, validId } from './conditions.js';
import { getLocationContext } from './locations.js';
import { locationDefinition, locationInstances } from './entityQueries.js';
import { canUse, ownerOf } from './authority.js';
import { conditionReason } from './conditionContext.js';
import { previewExchange } from './resources.js';
import { installEquipment, validateEquipment } from './equipment.js';

export function installationTargets(state, { world }, actorId = 'player') {
  const current = locationDefinition(state,world,state.locationId);
  if (!current) return [];
  return locationInstances(state,world).filter(def => def.id === state.locationId ||
    !current.mobile && def.mobile && ownerOf(state,def.id) === actorId &&
    state.locations[def.id].dockedAtId === state.locationId && !state.locations[def.id].journey &&
    state.locations[def.id].areaId === state.locations[state.locationId].areaId);
}
export function previewItemInstallation(state, request, services, actorId = 'player') {
  try {
    if (!record(request) || Object.keys(request).some(k => !['itemId','sourceLocationId','targetLocationId'].includes(k)) ||
      !Object.values(request).every(validId) || Object.keys(request).length !== 3) throw new Error('Invalid installation request.');
    const { content, world } = services, { itemId,sourceLocationId,targetLocationId } = request;
    if (sourceLocationId !== state.locationId) throw new Error('Installation stock must come from your occupied storage.');
    const item = content.items[itemId];
    if (!item?.installation || item.vesselModule) throw new Error('This product is fitted through the Shipyard or cannot be installed.');
    if (!installationTargets(state,services,actorId).some(def => def.id === targetLocationId)) throw new Error('The target must be your occupied host or an owned ship docked at your current site.');
    const source = getLocationContext(state,content,world,sourceLocationId,actorId);
    const target = getLocationContext(state,content,world,targetLocationId,actorId);
    if (source.local.journey || target.local.journey) throw new Error('Cannot install while travelling.');
    if (!canUse(state,actorId,sourceLocationId,'viewCargo') || !canUse(state,actorId,sourceLocationId,'withdrawCargo')) throw new Error('Requires cargo visibility and withdrawal permission at the source.');
    if (!canUse(state,actorId,targetLocationId,'manageEquipment')) throw new Error('Requires equipment management permission at the target.');
    if (!source.actionIds.includes(`install:${itemId}`) || !target.actionIds.includes(`install:${itemId}`)) throw new Error('Installation is not supported at this host.');
    if (target.local.assembly) throw new Error('Equipment on this vessel is fitted through the Shipyard.');
    const reason = conditionReason(target.actionState,item.installation.conditions,content);
    if (reason) throw new Error(reason);
    const group = item.installation.group, infrastructure = structuredClone(target.store.infrastructure);
    if (infrastructure[group].quantity >= (item.installation.limit ?? Number.MAX_SAFE_INTEGER)) throw new Error('Installation limit reached.');
    installEquipment(infrastructure,group);
    validateEquipment(infrastructure,content,message => { throw new Error(`Invalid ${message}.`); });
    const debit = previewExchange(source.store,{ [itemId]:1 },{},content,sourceLocationId === targetLocationId ? infrastructure : source.store.infrastructure);
    if (!debit.ok) throw new Error(debit.reason);
    if (sourceLocationId !== targetLocationId) {
      const targetPreview = previewExchange(target.store,{}, {},content,infrastructure);
      if (!targetPreview.ok) throw new Error(targetPreview.reason);
    }
    return { ok:true,reason:'',resources:debit.resources,infrastructure };
  } catch (error) { return { ok:false,reason:error.message }; }
}
export function installItem(state, request, services, actorId = 'player') {
  const preview = previewItemInstallation(state,request,services,actorId);
  if (!preview.ok) throw new Error(preview.reason);
  Object.assign(state.locations[request.sourceLocationId].resources,preview.resources);
  Object.assign(state.locations[request.targetLocationId].infrastructure,preview.infrastructure);
  return `Installed ${services.content.items[request.itemId].name.toLowerCase()} on ${locationDefinition(state,services.world,request.targetLocationId).name}.`;
}
export function createItemInstallationActions(services) {
  return [{ id:'installItemAtTarget',name:'Install a product at a docked target',group:'item-context',collection:'equipment',permissions:[],
    requirement:(state,ctx,request) => previewItemInstallation(state,request,services).reason,
    execute:(state,ctx,request) => installItem(state,request,services) }];
}
