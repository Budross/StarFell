import { locationDefinition } from '../../entityQueries.js';
import { fact } from '../narrativeFacts.js';
export function locationFactProvider({world}) {
  return {id:'location',provide(state,scope) {
    const def=locationDefinition(state,world,scope.locationId);
    return [fact('location','location_identity',{type:'entity',id:scope.locationId},{name:def.name,
      baseText:def.narrative?.base ?? `${def.name} is your current location.`,dimensions:def.narrative?.dimensions ?? {}},scope)];
  }};
}
