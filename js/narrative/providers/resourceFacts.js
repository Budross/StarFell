import { storageSummary } from '../../storage.js';
import { claimedReserve } from '../../processing.js';
import { fact } from '../narrativeFacts.js';
export function resourceFactProvider({content,contextFor}) {
  return {id:'resources',provide(state,scope) {
    const facts=[];
    if (scope.cargo && !scope.equipmentId) {
      const s=storageSummary(contextFor(state,scope.locationId).store,content),fill=s.capacityVolumeUnits>0?s.usedVolumeUnits/s.capacityVolumeUnits:0;
      facts.push(fact('resources','storage_condition',{type:'entity',id:scope.locationId},{...s,fillBand:s.overloadVolumeUnits?'overloaded':fill>=.9?'nearly_full':'ordinary'},scope,{exposure:'cargo_detail',importance:.3,severity:s.overloadVolumeUnits ? .7 : 0}));
    }
    if (!scope.facilities || scope.equipmentId) return facts;
    for (const [id,node] of Object.entries(state.locations[scope.locationId].resourceNodes ?? {})) {
      const claimed=claimedReserve(state,scope.locationId,id);
      facts.push(fact('resources','resource_node_condition',{type:'resource_node',locationId:scope.locationId,nodeId:id},{nodeId:id,resourceId:node.resourceId,name:content.items[node.resourceId]?.name ?? 'mineral',remaining:node.remaining,claimed,available:node.remaining-claimed,reserveBand:node.remaining===0?'depleted':node.remaining===claimed?'claimed':'available'},scope,{exposure:'facility_detail',importance:node.remaining===0 ? .8 : .4}));
    }
    return facts;
  }};
}
