import { locationInstances,locationDefinition,getEntityLabel } from '../../entityQueries.js';
import { fact } from '../narrativeFacts.js';
import { canObserve,historyAge } from '../narrativeContext.js';
import { isKnown } from '../../locations.js';
export function shipFactProvider({world,content}) {
  return {id:'ships',provide(state,scope) {
    if (scope.equipmentId) return [];
    const facts=[];
    for (const def of locationInstances(state,world).filter(d=>d.mobile)) {
      if (!isKnown(state,world,content,def.id)) continue;
      const drone=def.controlMode==='commanded' || !!state.vesselReports?.byVessel[def.id];
      const seen=drone?world.observableVesselStatus?.(state,def.id):null;
      if(drone && (!seen || !['LIVE','LOCALLY_OBSERVED'].includes(seen.classification)))continue;
      // Coarse sighting is sufficient for presence, never for an unseen berth or
      // remote journey. Use the same player projection as the map and controls.
      const local=drone?{areaId:seen.areaId,dockedAtId:seen.dockedAtId,journey:seen.classification==='LIVE'?seen.report?.journey:null}:state.locations[def.id],own=def.id===scope.locationId,atHost=local.dockedAtId===scope.locationId,area=local.areaId===scope.areaId;
      if (!own && !atHost && (!area || !canObserve(scope,'local_ship_presence'))) continue;
      if (local.journey) { if (own) facts.push(fact('ships','ship_movement',{type:'entity',id:def.id},{name:def.name,targetId:local.journey.targetId,targetName:getEntityLabel(state,{world},local.journey.targetId)},scope)); }
      else if (!own) facts.push(fact('ships','ship_presence',{type:'entity',id:def.id},{name:def.name,presence:atHost?'docked':'in_area',dockedAtId:local.dockedAtId},scope,{importance:atHost?.6:.4}));
    }
    return facts;
  },interpret(entry,scope,state) {
    if (!['SHIP_ARRIVED','SHIP_DEPARTED'].includes(entry.type) || scope.equipmentId) return [];
    if(state.vesselReports?.byVessel[entry.actorId] || locationDefinition(state,world,entry.actorId)?.controlMode==='commanded') {
      if(world.observableVesselStatus?.(state,entry.actorId)?.classification!=='LIVE')return [];
    }
    if (state.entities[entry.actorId]?.lifecycle==='active' && !isKnown(state,world,content,entry.actorId)) return [];
    const own=entry.actorId===scope.locationId;
    if (!own && !(entry.data.destinationId===scope.locationId && entry.data.kind==='dock') && !(entry.areaId===scope.areaId && canObserve(scope,'local_ship_presence'))) return [];
    return [fact('ships','recent_ship_movement',{type:'entity',id:entry.actorId},{name:getEntityLabel(state,{world},entry.actorId),destination:getEntityLabel(state,{world},entry.data.destinationId),movement:entry.type==='SHIP_ARRIVED'?'arrived':'departed',journeyKind:entry.data.kind,ageBand:historyAge(scope,entry.time)},scope,{basis:'history',event:entry,importance:.65})];
  }};
}
