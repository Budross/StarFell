import { collectDiscoveryReferences, mergeDiscoveryReferences, conditionEntityReferences } from "./conditionReferences.js";
import { npcDefinitions } from "./npcContent.js";
import { dialogueDefinitions } from "./dialogueContent.js";
import { buildNpcCatalog } from "./npcs.js";
import { buildDialogueCatalog, isCompleted } from "./dialogue.js";
import { getLocationContext } from "./locations.js";

export function buildPeopleSystem(content, world, npcSource = npcDefinitions, dialogueSource = dialogueDefinitions) {
  const npcs = buildNpcCatalog(npcSource, world, content);
  const dialogue = buildDialogueCatalog(dialogueSource, npcs, world, content);
  const npcReferences = collectDiscoveryReferences(Object.values(npcs).flatMap(npc =>
    [npc.presenceConditions, npc.visibilityConditions, npc.interactionConditions]));
  const system = { content, world, npcs, dialogue,
    initialSpawns: Object.values(npcs).filter(npc => npc.spawn !== false).map(npc => ({ id: npc.id, definitionId: npc.id, locationId: npc.initialLocationId, lifecycle: npc.initialLifecycle })),
    entityReferences: [...dialogue.entityReferences, ...Object.values(npcs).flatMap(npc =>
      [npc.presenceConditions, npc.visibilityConditions, npc.interactionConditions].flatMap(c => conditionEntityReferences(c, `npcs:${npc.id}`)))],
    discoveryReferences: mergeDiscoveryReferences(npcReferences, dialogue.discoveryReferences),
    context(state, npcId) {
      return { root: state, npcId, local: getLocationContext(state, content, world).actionState,
        isCompleted: id => isCompleted(state, system, id, npcId) };
    }
  };
  return system;
}
const cache = new WeakMap();
export function peopleFor(content, world) {
  let byContent = cache.get(world);
  if (!byContent) { byContent = new WeakMap(); cache.set(world, byContent); }
  if (!byContent.has(content)) byContent.set(content, buildPeopleSystem(content, world));
  return byContent.get(content);
}
