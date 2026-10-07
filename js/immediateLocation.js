import { locationDefinition, locationInstances, npcDefinition, npcInstances } from './entityQueries.js';
import { isEntityActive } from './entities.js';
import { canUse } from './authority.js';
import { isKnown, physicalLinks } from './locations.js';
import { navigationView, shipStatus } from './ships.js';
import { detectedContacts } from './mapKnowledge.js';
import { npcVisible, contactReason } from './npcs.js';
import { localSpaceFor, playerPlaceId, localConnections, localConditionReason } from './localSpace.js';

export const subjectKey = ref => JSON.stringify([ref.hostId,ref.kind,ref.id]);
const conditionStatus = g => !g.enabled?'DISABLED':g.health===0?'INOPERATIVE':g.health<1?'DEGRADED':'';
const serviceMode = binding => binding?.serviceAccess??'local';

export function createImmediateLocationViews(services) {
  const {world,content,people}=services;
  const allowed=(state,conditions,hostId)=>!localConditionReason(state,services,conditions,hostId);
  function presentSubjects(state) {
    const hostId=state.locationId,def=locationDefinition(state,world,hostId),placeId=playerPlaceId(state,world),host=state.locations[hostId];
    if(!def||!isEntityActive(state,hostId))return [];
    // Legacy scenes remain discoverable. Installed assets do not automatically
    // become spatial subjects; split hosts require explicit meaningful bindings.
    const bindings=def.localSpace?.subjects??def.sceneObjects.filter(s=>!s.locationId).map(s=>({kind:'scene',id:s.id,placeId}));
    const result=[];
    for(const b of bindings) {
      if(b.placeId!==placeId||!allowed(state,b.conditions)||!allowed(state,b.presentWhen))continue;
      const ref={hostId,kind:b.kind,id:b.id};let name=b.name,status='',identified=!b.identityConditions||allowed(state,b.identityConditions);
      if(b.kind==='scene'){
        const scene=def.sceneObjects.find(s=>s.id===b.id&&!s.locationId);
        if(!scene||!allowed(state,scene.conditions))continue;
        name ||=scene.name;status=host.flags[`examined:${b.id}`]?'EXAMINED':'';
      }else if(b.kind==='equipment'){
        if(!canUse(state,'player',hostId,'useFacilities')&&!canUse(state,'player',hostId,'manageEquipment'))continue;
        const g=host.infrastructure[b.id];if(!g?.quantity)continue;
        name ||=content.infrastructure[b.id].name;status=conditionStatus(g);
        if(g.quantity>1&&identified)name+=` ×${g.quantity}`;
      }else if(b.kind==='resource'){
        const node=def.resourceNodes[b.id];if(!node||!host.resourceNodes[b.id])continue;
        const known=state.knowledge.itemEntries?.[node.resourceId]?.facts[`node:${hostId}:${b.id}`]===true;
        identified=identified&&known;
        name ||=content.items[node.resourceId].name;
        if(identified&&canUse(state,'player',hostId,'useFacilities'))status=host.resourceNodes[b.id].remaining===0?'DEPLETED':'';
      }
      if(!identified){name=b.unknownName??'Mineral exposure';status='UNIDENTIFIED';}
      result.push({ref,name,status,identified});
    }
    for(const npc of npcInstances(state,people))if(npcVisible(state,npc.id,people))result.push({ref:{hostId,kind:'npc',id:npc.id},name:npc.name,status:npc.subtitle??'',identified:true});
    return result;
  }
  function nearbyDestinations(state) {
    const hostId=state.locationId,def=locationDefinition(state,world,hostId),local=state.locations[hostId],refs=new Map();
    const add=(id,relation)=>{
      if(id===hostId||!isKnown(state,world,content,id))return;
      const target=locationDefinition(state,world,id);if(!target||target.controlMode==='commanded')return;
      if(target.kind==='site'&&state.locations[id].areaId!==local.areaId)return;
      if(target.kind==='area'&&!physicalLinks(state,world).some(([a,b])=>a===local.areaId&&b===id||b===local.areaId&&a===id))return;
      refs.set(id,{ref:{hostId,kind:'destination',id},name:target.name,status:relation});
    };
    if(def.mobile&&local.dockedAtId)add(local.dockedAtId,'CURRENT BERTH');
    // A known Area's primary berth is one immediate return/approach relation,
    // not an enumeration of its sites. It remains usable after undocking.
    if(def.mobile)add(locationDefinition(state,world,local.areaId)?.primaryLocalId,'LOCAL BERTH');
    for(const ship of locationInstances(state,world))if(ship.mobile&&ship.boardable!==false&&state.locations[ship.id].dockedAtId===hostId&&!state.locations[ship.id].journey)add(ship.id,'DOCKED HERE');
    for(const n of def.localSpace?.nearby??[])if(allowed(state,n.conditions))add(n.targetId,locationDefinition(state,world,n.targetId)?.kind==='area'?'CONNECTED AREA':'SAME AREA');
    if(local.journey){refs.clear();const id=local.journey.targetId;const target=locationDefinition(state,world,id);if(target&&isKnown(state,world,content,id))refs.set(id,{ref:{hostId,kind:'destination',id},name:target.name,status:'EN ROUTE'});}
    // Anonymous observations are included only within the existing local reach.
    const origin=locationDefinition(state,world,local.areaId)?.position;
    const contacts=origin&&!local.journey?detectedContacts(state).filter(c=>Math.hypot(c.position[0]-origin[0],c.position[1]-origin[1])<=world.connectionDistance):[];
    if(contacts.length>1)refs.set('localContacts',{ref:{hostId,kind:'contact',id:'localContacts',observation:JSON.stringify(contacts.map(c=>[c.position,c.description]))},name:'Unknown bodies',count:contacts.length,status:`${contacts.length} DETECTED · APPROXIMATE`});
    else for(const c of contacts)refs.set(c.id,{ref:{hostId,kind:'contact',id:c.id,observation:JSON.stringify([c.position,c.description])},name:c.name,status:'DETECTED · APPROXIMATE'});
    return [...refs.values()];
  }
  function immediateLocationView(state) {
    const def=locationDefinition(state,world,state.locationId),local=state.locations[state.locationId],area=locationDefinition(state,world,local.areaId),place=localSpaceFor(def).places[playerPlaceId(state,world)];
    const transit=def.mobile&&local.journey;
    const breadcrumbs=[transit?`${area.name} → ${locationDefinition(state,world,local.journey.targetId).name}`:area.name,def.name,...(place?.name?[place.name]:[])];
    return {position:{hostId:state.locationId,placeId:playerPlaceId(state,world),breadcrumbs,title:place?.name||def.name,
      status:def.mobile?shipStatus(state,world):''},here:localConnections(state,services),present:presentSubjects(state),nearby:nearbyDestinations(state)};
  }
  function subjectInteractionView(state, ref, getActionStatus) {
    const unavailable={available:false,name:'No longer present',description:'The selected subject is no longer available in this context.',actions:[],links:[]};
    if(!ref||ref.hostId!==state.locationId)return unavailable;
    const spatial=immediateLocationView(state),entry=[...spatial.present,...spatial.nearby].find(e=>subjectKey(e.ref)===subjectKey(ref));
    if(!entry||ref.kind==='contact'&&entry.ref.observation!==ref.observation)return unavailable;
    const result={available:true,name:entry.name,status:entry.status,description:'',actions:[],links:[],serviceAccess:null};
    const def=locationDefinition(state,world,ref.hostId),binding=def.localSpace?.subjects.find(b=>b.kind===ref.kind&&b.id===ref.id),host=state.locations[ref.hostId];
    const add=(id,payload,label)=>{let status;try{status=getActionStatus(id,payload);}catch{return;}if(status.visible)result.actions.push({...status,payload,name:label??status.name});};
    if(ref.kind==='destination'){
      const nav=navigationView(state,ref.id,world,content);result.description=nav.detail||nav.reason||entry.status;
      if(def.mobile&&host.dockedAtId&&ref.id!==host.dockedAtId)add('undock',undefined,'Undock');
      add(nav.actionId,undefined,nav.actionLabel);
      result.links.push({tab:'locations',name:'Locations',targetId:ref.id});return result;
    }
    if(ref.kind==='contact'){result.description=entry.count?`${entry.count} approximate detections. Browse individual contacts in Locations. Identities remain unknown; navigation unavailable.`:'Approximate detection. Identity unknown; navigation unavailable.';result.links.push({tab:'locations',name:'Locations'});return result;}
    if(!entry.identified){
      if(ref.kind==='scene')add(`inspect:${ref.hostId}:${ref.id}`,undefined,`Inspect ${entry.name.toLowerCase()}`);
      else result.description='Its identity has not been established.';
      return result;
    }
    if(ref.kind==='scene'){
      const scene=def.sceneObjects.find(s=>s.id===ref.id);
      if(host.flags[`examined:${ref.id}`])result.description=scene.description;
      else add(`inspect:${ref.hostId}:${ref.id}`,undefined,`Inspect ${entry.name.toLowerCase()}`);
      if(ref.id==='reactionWreckage'&&!host.flags[`examined:${ref.id}`])result.description='Recovery needs 0.80 m³ of cargo space.';
      if(['fitting','solarHardware'].includes(ref.id)&&host.flags[`examined:${ref.id}`])result.links.push({tab:'research',name:'Open Research'});
    }else if(ref.kind==='npc'){
      const npc=npcDefinition(state,people,ref.id);result.description=npc.description;
      if(npc.interactions.includes('talk')){
        const reason=contactReason(state,ref.id,people)|| (state.dialogue.active?'Finish the current conversation first.':'');
        result.actions.push({id:'dialogue:start',name:'Talk',payload:{npcId:ref.id},visible:true,available:!reason,reason});
      }
      result.links.push({tab:'people',name:'Open People'});
    }else if(ref.kind==='equipment'){
      result.actions.push({id:'spatial:observeEquipment',name:'Inspect equipment',visible:true,available:true,reason:'',request:{surface:'inspect_equipment',subjectId:ref.hostId,equipmentId:ref.id}});
      result.links.push({tab:'systems',name:'Open Systems'});
      const capabilities=content.infrastructure[ref.id].capabilities??[];
      if(capabilities.some(c=>c.type==='fabrication'))result.links.push({tab:'workshop',name:'Open Workshop'});
      if(capabilities.some(c=>c.type==='benchAnalysis'))result.links.push({tab:'research',name:'Open Research'});
    }else if(ref.kind==='resource'||ref.kind==='feature')result.links.push({tab:'workshop',name:'Open Workshop'});
    if(binding){result.serviceAccess={mode:serviceMode(binding),compatibility:serviceMode(binding)!=='local',providerPlaceId:binding.placeId};
      for(const id of binding.actions??[])add(id);
    }
    return result;
  }
  return {immediateLocationView,subjectInteractionView};
}
