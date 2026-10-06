import { locationDefinition } from './entityQueries.js';
import { getLocationContext, isKnown } from './locations.js';
import { permissionReason } from './authority.js';
import { previewMove, moveExact } from './resources.js';
import { quantityKind, record } from './quantities.js';

// Physical/authority checks only. Communication belongs to the command boundary.
export function previewBerthTransfer(state, request, services, actorId='player') {
  try {
    if (!record(request) || Object.keys(request).some(k=>!['vesselId','sourceId','destinationId','assetId','amount'].includes(k))) throw new Error('Invalid drone transfer request.');
    const {vesselId,sourceId,destinationId,assetId,amount}=request, local=state.locations[vesselId];
    const berth=locationDefinition(state,services.world,local?.dockedAtId);
    if (!local || local.journey || !berth || berth.mobile || berth.kind!=='site' || local.areaId!==state.locations[berth.id]?.areaId ||
      !((sourceId===vesselId && destinationId===berth.id)||(destinationId===vesselId && sourceId===berth.id))) throw new Error('Transfers require the selected vessel and its actual stationary berth.');
    if (!isKnown(state,services.world,services.content,sourceId) || !isKnown(state,services.world,services.content,destinationId)) throw new Error('Both transfer endpoints must be known.');
    const reason=permissionReason(state,actorId,sourceId,'withdrawCargo') || permissionReason(state,actorId,destinationId,'depositCargo');
    if(reason) throw new Error(reason);
    if (!services.content.items[assetId] || services.content.utilities.includes(assetId)) throw new Error('Choose a physical cargo item.');
    const {debit,credit}=previewMove(getLocationContext(state,services.content,services.world,sourceId,actorId).store,getLocationContext(state,services.content,services.world,destinationId,actorId).store,assetId,amount,services.content);
    return {ok:true,reason:'',sourceResources:debit.resources,destinationResources:credit.resources};
  } catch(error) { return {ok:false,reason:error.message}; }
}
export function executeBerthTransfer(state,request,services,actorId='player') {
  const result=previewBerthTransfer(state,request,services,actorId); if(!result.ok) throw new Error(result.reason);
  const {sourceId,destinationId,assetId,amount}=request;
  moveExact(getLocationContext(state,services.content,services.world,sourceId,actorId).store,getLocationContext(state,services.content,services.world,destinationId,actorId).store,assetId,amount,services.content);
  services.ledgerServices?.append(state,{type:'RESOURCE_TRANSFERRED',actorId,targetId:destinationId,locationId:sourceId,areaId:state.locations[sourceId].areaId,
    data:{sourceId,destinationId,resourceId:assetId,quantityKind:quantityKind(assetId,services.content),amount}});
}
