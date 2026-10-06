import { locationDefinition } from '../../entityQueries.js';
import { fact } from '../narrativeFacts.js';
export function locationFactProvider({world}) {
  return {id:'location',provide(state,scope) {
    const def=locationDefinition(state,world,scope.locationId);
    const body=def.bodyCharacter;
    // Local observation derives wording from frozen structured facts. Neither
    // generated prose nor regional/deposit knowledge is stored by the generator.
    const bodyText=body?`${def.name} is a ${body.scale} natural body with a ${body.dominant === 'metal'?'metallic':body.dominant === 'volatile'?'volatile-bearing':body.dominant+'-rich'} character.`:null;
    return [fact('location','location_identity',{type:'entity',id:scope.locationId},{name:def.name,
      baseText:bodyText ?? def.narrative?.base ?? (def.kind==='area' || def.type==='ship' ? def.description : null) ?? `${def.name} is your current location.`,dimensions:def.narrative?.dimensions ?? {}},scope)];
  }};
}
