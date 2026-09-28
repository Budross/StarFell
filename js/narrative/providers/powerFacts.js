import { quantity,capacity } from '../../resources.js';
import { powerRate } from '../../game.js';
import { fact } from '../narrativeFacts.js';
export function powerFactProvider({content,contextFor}) {
  return {id:'power',provide(state,scope) {
    if (!scope.cargo) return [];
    const store=contextFor(state,scope.locationId).store,available=quantity(store,'power',content),maximum=capacity(store,'power',content),net=powerRate(store,content);
    return [fact('power','power_reserve',{type:'entity',id:scope.locationId},{available,capacity:maximum,
      reserveBand:available===0?'empty':available>=maximum?'full':'available',equipmentNetRate:net,flowBand:net<0?'draining':net>0?'charging':'steady'},scope,{exposure:'cargo_detail',severity:available===0?.4:0})];
  }};
}
