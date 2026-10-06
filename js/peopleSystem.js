import { collectDiscoveryReferences, mergeDiscoveryReferences, conditionEntityReferences } from "./conditionReferences.js";
import { npcDefinitions } from "./npcContent.js";
import { dialogueDefinitions } from "./dialogueContent.js";
import { buildNpcCatalog } from "./npcs.js";
import { buildDialogueCatalog, isCompleted, suppliedConversations } from "./dialogue.js";
import { getLocationContext } from "./locations.js";

export function buildPeopleSystem(content, world, npcSource = npcDefinitions, dialogueSource = dialogueDefinitions) {
  const npcs = buildNpcCatalog(npcSource, world, content);
  const dialogue = buildDialogueCatalog(dialogueSource, npcs, world, content);
  const npcReferences = collectDiscoveryReferences(Object.values(npcs).flatMap(npc =>
    [npc.presenceConditions, npc.visibilityConditions, npc.interactionConditions]));
  const dialogueSources=dialogue.conditionSources.flatMap(source=>{
    const speakers=Object.values(npcs).filter(n=>suppliedConversations(n,dialogue).includes(source.path.split('.')[2]));
    return speakers.length?speakers.map(n=>({...source,npcId:n.id})):[source];
  });
  const conditionSources=[...dialogueSources,...Object.values(npcs).flatMap(n=>["presenceConditions","visibilityConditions","interactionConditions"].filter(k=>n[k]).map(k=>({path:`npcs.${n.id}.${k}`,conditions:n[k],npcId:n.id})))];
  const system = { conditionSources,content, world, npcs, dialogue,
    initialSpawns: Object.values(npcs).filter(npc => npc.spawn !== false).map(npc => ({ id: npc.id, definitionId: npc.id, locationId: npc.initialLocationId, lifecycle: npc.initialLifecycle })),
    entityReferences: [...dialogue.entityReferences, ...Object.values(npcs).flatMap(npc =>
      [npc.presenceConditions, npc.visibilityConditions, npc.interactionConditions].flatMap(c => conditionEntityReferences(c, `npcs:${npc.id}`)))],
    discoveryReferences: mergeDiscoveryReferences(npcReferences, dialogue.discoveryReferences),
    context(state, npcId, hostId = state.locationId) {
      return { root: state, npcId, local: getLocationContext(state, content, world, hostId, hostId===state.locationId?'player':npcId).actionState,
        isCompleted: id => isCompleted(state, system, id, npcId, hostId) };
    }
  };
  return system;
}
const cache = new WeakMap();
export function peopleFor(content, world) {
  if(world.peopleSystem?.content===content)return world.peopleSystem;
  let byContent = cache.get(world);
  if (!byContent) { byContent = new WeakMap(); cache.set(world, byContent); }
  if (!byContent.has(content)) byContent.set(content, buildPeopleSystem(content, world));
  return byContent.get(content);
}
