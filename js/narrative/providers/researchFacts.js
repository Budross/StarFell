import { fact } from '../narrativeFacts.js';
import { historyAge } from '../narrativeContext.js';
export function researchFactProvider({research}) {
  return {id:'research',provide:()=>[],interpret(entry,scope,state) {
    if (entry.type!=='RESEARCH_COMPLETED' || scope.equipmentId || entry.actorId!==scope.actorId || entry.locationId!==scope.locationId || state.knowledge.discoveries[entry.data.discoveryId]!==true) return [];
    return [fact('research','recent_research',{type:'entity',id:entry.actorId},{name:research.catalog.discoveries[entry.data.discoveryId]?.name ?? 'a discovery',ageBand:historyAge(scope,entry.time)},scope,{basis:'history',event:entry,exposure:'participant_private',importance:entry.importance})];
  }};
}
