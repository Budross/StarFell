import { npcDefinition, npcInstances, locationDefinition } from './entityQueries.js';
import { isEntityActive } from './entities.js';
import { permissionReason } from './authority.js';
import { conditionReason } from './conditionContext.js';
import { isKnown } from './locations.js';

// Communications owns contact policy. Equipment only answers provision queries.
// Bootstrap supplies the Dialogue-owned conversation read, avoiding a second topic resolver.
export function createCommunications({ content, world, people, equipment, topics }) {
  function contactReason(state, npcId, {receiverLocationId,requireConversation=true} = {}) {
    const npc = state.npcs?.[npcId], definition = npcDefinition(state, people, npcId);
    if (!definition?.remoteContact?.enabled || state.dialogue.met[npcId] !== true) return 'Radio conversation requires a prior physical introduction and an available contact.';
    if (!isEntityActive(state,'player') || !isEntityActive(state,npcId) || !npc || !definition.interactions.includes('talk')) return 'This radio contact is unavailable.';
    const senderId=state.locationId, receiverId=npc.locationId;
    if (receiverLocationId !== undefined && receiverLocationId !== receiverId) return 'The radio contact has moved.';
    if (senderId===receiverId) return 'This person is here; speak to them in person.';
    const sender=state.locations[senderId], receiver=state.locations[receiverId];
    if (!sender || !receiver || !isEntityActive(state,senderId) || !isEntityActive(state,receiverId) || !isKnown(state,world,content,receiverId)) return 'The radio endpoint is unavailable.';
    if (sender.areaId!==receiver.areaId || sender.journey?.kind==='area' || receiver.journey?.kind==='area') return 'Radio contacts must be in the same area, outside inter-area travel.';
    if (!equipment.hasCapability(state,senderId,'radioCommunication') || !equipment.hasCapability(state,receiverId,'radioCommunication')) return 'Radio conversation requires operational radio equipment at both ends.';
    const access=permissionReason(state,'player',senderId,'useFacilities') || permissionReason(state,npcId,receiverId,'useFacilities');
    if (access) return access;
    const senderContext=people.context(state,npcId,senderId), receiverContext=people.context(state,npcId,receiverId);
    for (const [context,conditions] of [[senderContext,locationDefinition(state,world,senderId).accessConditions],
      [receiverContext,locationDefinition(state,world,receiverId).accessConditions],
      ...['presenceConditions','visibilityConditions','interactionConditions'].map(key=>[receiverContext,definition[key]])]) {
      if (conditionReason(context.local,conditions,content,context)) return 'This radio contact is unavailable right now.';
    }
    if (requireConversation && !topics(state,npcId,'radio').some(c=>!c.reason)) return 'There are no radio conversations available right now.';
    return '';
  }
  return Object.freeze({contactReason,
    contacts: state=>npcInstances(state,people).filter(n=>{
      const active=state.dialogue.active;
      return !contactReason(state,n.id,active?.mode==='radio'&&active.npcId===n.id?{receiverLocationId:active.receiverLocationId,requireConversation:false}:{});
    }).map(n=>({npcId:n.id,name:n.name,mode:'radio'}))
  });
}
