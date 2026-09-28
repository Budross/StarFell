import { npcInstances } from '../../entityQueries.js';
import { npcVisible } from '../../npcs.js';
import { fact } from '../narrativeFacts.js';
export function npcFactProvider({people}) {
  return {id:'npcs',provide(state,scope) {
    if (scope.equipmentId) return [];
    return npcInstances(state,people).filter(n=>npcVisible(state,n.id,people)).map(n=>fact('npcs','npc_presence',{type:'entity',id:n.id},{name:n.name,subtitle:n.subtitle ?? ''},scope,{importance:.35}));
  }};
}
