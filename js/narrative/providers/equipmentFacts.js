import { isOperational } from '../../equipment.js';
import { fact } from '../narrativeFacts.js';
import { canObserve,historyAge } from '../narrativeContext.js';
export const conditionBand = health => health === 0 ? 'inoperative' : health < .4 ? 'badly_degraded' : health < .8 ? 'degraded' : health < 1 ? 'worn' : 'sound';
export function equipmentFactProvider({content}) {
  const subject=(scope,id)=>({type:'equipment_group',hostId:scope.locationId,equipmentId:id});
  return {id:'equipment',provide(state,scope) {
    const facts=[];
    for (const [id,group] of Object.entries(state.locations[scope.locationId].infrastructure)) {
      if (!group.quantity || scope.equipmentId && scope.equipmentId!==id) continue;
      const def=content.infrastructure[id];
      if (!scope.facilities && !canObserve(scope,'equipment_condition',def.narrative)) continue;
      const band=conditionBand(group.health),data={equipmentId:id,name:def.name,conditionBand:band};
      if (scope.facilities) Object.assign(data,{quantity:group.quantity,health:group.health,enabled:group.enabled,operational:isOperational(state.locations[scope.locationId].infrastructure,id)});
      facts.push(fact('equipment','equipment_condition',subject(scope,id),data,scope,{exposure:scope.facilities?'facility_detail':'coarse_local',severity:{sound:0,worn:.1,degraded:.5,badly_degraded:.9,inoperative:1}[band]}));
    }
    return facts;
  },interpret(entry,scope) {
    if (entry.type!=='EQUIPMENT_REPAIRED' || entry.locationId!==scope.locationId || !scope.facilities || scope.equipmentId && scope.equipmentId!==entry.data.equipmentId) return [];
    return [fact('equipment','recent_equipment_repair',subject(scope,entry.data.equipmentId),{name:content.infrastructure[entry.data.equipmentId]?.name ?? 'Equipment',equipmentId:entry.data.equipmentId,ageBand:historyAge(scope,entry.time)},scope,{basis:'history',event:entry,exposure:'facility_detail',importance:.6})];
  }};
}
