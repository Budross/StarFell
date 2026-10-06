import { isKnown } from './locations.js';
import { vesselLinkReason as linkReason } from './vesselLinkPolicy.js';

export function vesselLinkReason(state, vesselId, services, actorId = 'player') {
  return linkReason(state,vesselId,{...services,isKnown:(s,id)=>isKnown(s,services.world,services.content,id)},actorId);
}
