import { createEquipmentQueries } from '../../equipmentQuery.js';
import { fact } from '../narrativeFacts.js';
import { canObserve,historyAge } from '../narrativeContext.js';
export const conditionBand = health => health === 0 ? 'inoperative' : health < .4 ? 'badly_degraded' : health < .8 ? 'degraded' : health < 1 ? 'worn' : 'sound';
export function equipmentFactProvider({content,equipment = createEquipmentQueries(content)}) {
  const subject=(scope,id)=>({type:'equipment_group',hostId:scope.locationId,equipmentId:id});
  return {id:'equipment',provide(state,scope) {
    const facts=[];
    for (const id of Object.keys(content.equipment)) {
      const group=equipment.describeInstalled(state,{hostId:scope.locationId,equipmentId:id});
      if (!group || scope.equipmentId && scope.equipmentId!==id) continue;
      const def=content.infrastructure[id];
      if (!scope.facilities && !canObserve(scope,'equipment_condition',def.narrative)) continue;
      const band=conditionBand(group.health),data={equipmentId:id,name:def.name,conditionBand:band};
      if (scope.facilities) Object.assign(data,{quantity:group.quantity,health:group.health,enabled:group.enabled,operational:group.operational});
      facts.push(fact('equipment','equipment_condition',subject(scope,id),data,scope,{exposure:scope.facilities?'facility_detail':'coarse_local',severity:{sound:0,worn:.1,degraded:.5,badly_degraded:.9,inoperative:1}[band]}));
      if (scope.facilities && scope.equipmentId===id && (group.capabilities.length || group.contributions.length)) {
        const provision=[...group.capabilities.map(c=>c.summary),...group.contributions.map(c=>c.summary)].join(' ');
        facts.push(fact('equipment','equipment_provision',subject(scope,id),{equipmentId:id,name:group.name,provision},scope,{exposure:'facility_detail',importance:.55}));
      }
    }
    return facts;
  },interpret(entry,scope) {
    if (entry.type!=='EQUIPMENT_REPAIRED' || entry.locationId!==scope.locationId || !scope.facilities || scope.equipmentId && scope.equipmentId!==entry.data.equipmentId) return [];
    return [fact('equipment','recent_equipment_repair',subject(scope,entry.data.equipmentId),{name:content.infrastructure[entry.data.equipmentId]?.name ?? 'Equipment',equipmentId:entry.data.equipmentId,ageBand:historyAge(scope,entry.time)},scope,{basis:'history',event:entry,exposure:'facility_detail',importance:.6})];
  }};
}
