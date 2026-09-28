import { canUse } from '../authority.js';
import { locationDefinition,npcDefinition } from '../entityQueries.js';
import { npcVisible,contactReason } from '../npcs.js';
import { recentLedgerEntries } from '../worldLedger.js';
import { canonical,compareKeys,freezeDetached,validateFacts } from './narrativeFacts.js';
import { narrativeKnowledge } from './narrativeKnowledge.js';
export const canObserve = (scope,topic,metadata) => scope.local && (scope.observableTopics.includes(topic) || metadata?.observableTopics?.includes(topic));
export const historyAge = (scope,time) => scope.simulationTime-time<15?'moments':scope.simulationTime-time<60?'recent':'earlier';
export function createContextBuilder({world,people,content,providers,surfaces}) {
  const manifest=Object.freeze([...providers]);
  return (state,request) => {
    if (!request || Object.keys(request).some(k=>!['surface','subjectId','equipmentId','actorId','triggers'].includes(k)) || !Object.hasOwn(surfaces,request.surface)) throw new Error('Invalid narrative request.');
    const policy=surfaces[request.surface],speech=request.surface.startsWith('npc_'),actorId=request.actorId ?? 'player';
    if (request.equipmentId !== undefined && request.surface!=='inspect_equipment' || request.triggers!==undefined && request.surface!=='operations_update') throw new Error('Invalid narrative subject fields.');
    const speaker=speech ? npcDefinition(state,people,request.subjectId) : null;
    const locationId=speech ? state.npcs[request.subjectId]?.locationId : request.subjectId;
    const def=locationDefinition(state,world,locationId),local=state.locations[locationId];
    if (!def || !local || state.entities[locationId]?.lifecycle!=='active' || locationId!==state.locationId || actorId!=='player' ||
        speech && (!speaker || !npcVisible(state,speaker.id,people) || contactReason(state,speaker.id,people))) return freezeDetached({status:'unavailable',surface:request.surface,facts:[]});
    if (request.surface==='inspect_equipment' && (!Object.hasOwn(content.infrastructure,request.equipmentId ?? '') ||
        !local.infrastructure[request.equipmentId]?.quantity && !Object.values(state.processing.runs).some(r=>r.hostId===locationId && r.equipmentId===request.equipmentId))) return freezeDetached({status:'unavailable',surface:request.surface,facts:[]});
    const observerId=speech?speaker.id:actorId;
    // Existing domain authority is the sole permission decision. Speech intersects
    // speaker and listener access; observability can supply only a coarse projection.
    const allowed=permission=>canUse(state,actorId,locationId,permission) && (!speech || canUse(state,observerId,locationId,permission));
    const facilityRead=id=>canUse(state,id,locationId,'useFacilities') || canUse(state,id,locationId,'manageEquipment');
    const triggers=request.triggers ?? [];
    if (!Array.isArray(triggers) || triggers.length>200 || triggers.some(t=>!t || !['PROCESS_BLOCKED','PROCESS_RESUMED','PROCESS_COMPLETED','PROCESS_ABORTED','PROCESS_STARTED','PROCESS_PHASE_CHANGED','RESOURCE_NODE_DEPLETED','EQUIPMENT_REPAIRED','SHIP_ARRIVED','SHIP_DEPARTED','VESSEL_ASSEMBLED','LOCATION_ENTERED'].includes(t.type) || Object.keys(t).some(k=>!['type','ledgerId','hostId','equipmentId','runId','nodeId','entityId'].includes(k)))) throw new Error('Invalid narrative trigger references.');
    const scope=freezeDetached({locationId,areaId:local.areaId,local:true,actorId,observerId,observerLocationId:speech?state.npcs[speaker.id].locationId:locationId,
      speaker:speaker?{id:speaker.id,name:speaker.name,tone:speaker.narrative?.tone ?? 'neutral',greeting:speaker.narrative?.greeting ?? 'Hello.',interests:speaker.narrative?.observationInterests ?? []}:null,
      facilities:facilityRead(actorId) && (!speech || facilityRead(observerId)),cargo:allowed('viewCargo'),equipmentId:request.equipmentId ?? null,
      observableTopics:def.narrative?.observableTopics ?? [],simulationTime:state.simulationTime});
    const records=recentLedgerEntries(state,{since:Math.max(0,state.simulationTime-policy.window),until:state.simulationTime,limit:200});
    const collected=manifest.flatMap(p=>[...p.provide(state,scope),...records.flatMap(e=>p.interpret?.(e,scope,state) ?? [])]);
    const admitted=collected.filter(f=>narrativeKnowledge(f,scope));
    validateFacts(admitted);
    const facts=admitted.sort((a,b)=>compareKeys(a.key,b.key));
    return freezeDetached({status:'available',surface:request.surface,subject:speech?{type:'entity',id:speaker.id}:request.equipmentId?{type:'equipment_group',hostId:locationId,equipmentId:request.equipmentId}:{type:'entity',id:locationId},
      subjectKey:canonical([locationId,request.equipmentId ?? null,speaker?.id ?? null]),locationId,areaId:local.areaId,actorId,observerId,listenerId:speech?actorId:null,speaker:scope.speaker,triggers,facts});
  };
}
