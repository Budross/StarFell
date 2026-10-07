import { record, validEntityId, isEntityActive, isTerminal } from './entities.js';
import { locationDefinition } from './entityQueries.js';
import { validateConditions, conditionContracts } from './conditions.js';
import { conditionReason } from './conditionContext.js';

const check = (ok, message) => { if (!ok) throw new Error(`Invalid local space: ${message}`); };
const fields = (value, allowed, path) => check(record(value) && Object.keys(value).every(k => allowed.includes(k)), path);
const text = value => typeof value === 'string' && !!value.trim();
export const compatibilitySpace = Object.freeze({ entryPlaceId:'main', places:{main:{name:''}}, connections:[], subjects:[], nearby:[] });
export const localSpaceFor = def => def?.localSpace ?? compatibilitySpace;
export const entryPlaceId = def => localSpaceFor(def).entryPlaceId;
export const playerPlaceId = (state, world) => state.localPlaceId ?? entryPlaceId(locationDefinition(state,world,state.locationId));

// Compile optional physical vocabulary, never infer it from facility queries.
export function validateLocalSpace(def, content, world, conditionSources) {
  if (def.localSpace===undefined) return;
  const s=def.localSpace, path=`locations.${def.id}.localSpace`;
  fields(s,['entryPlaceId','places','connections','subjects','nearby'],path);
  check(def.kind==='site' && record(s.places) && Object.keys(s.places).length,`${path}.places`);
  check(validEntityId(s.entryPlaceId) && Object.hasOwn(s.places,s.entryPlaceId),`${path}.entryPlaceId`);
  const conditions=(value,at)=>validateConditions(value,{content,world,contract:conditionContracts.state,conditionSources,locationId:def.id},at);
  for(const [id,p] of Object.entries(s.places)) {
    check(validEntityId(id),`${path}.places.${id}`);fields(p,['name','conditions','accessConditions','blockedReason'],`${path}.places.${id}`);
    check(text(p.name)||(p.name===''&&Object.keys(s.places).length===1),`${path}.places.${id}.name`);
    for(const key of ['conditions','accessConditions'])conditions(p[key],`${path}.places.${id}.${key}`);
    check(p.blockedReason===undefined||text(p.blockedReason),`${path}.places.${id}.blockedReason`);
  }
  const edges=new Set();
  check(Array.isArray(s.connections??=[]),`${path}.connections`);
  for(const [i,e] of s.connections.entries()) {
    fields(e,['from','to','conditions','accessConditions','blockedReason'],`${path}.connections.${i}`);
    check(Object.hasOwn(s.places,e.from)&&Object.hasOwn(s.places,e.to)&&e.from!==e.to,`${path}.connections.${i}.endpoints`);
    const key=JSON.stringify([e.from,e.to]);check(!edges.has(key),`${path}.duplicate connection`);edges.add(key);
    for(const k of ['conditions','accessConditions'])conditions(e[k],`${path}.connections.${i}.${k}`);
    check(e.blockedReason===undefined||text(e.blockedReason),`${path}.connections.${i}.blockedReason`);
  }
  check(Array.isArray(s.subjects??=[]),`${path}.subjects`);
  const refs=new Set();
  for(const [i,b] of s.subjects.entries()) {
    const at=`${path}.subjects.${i}`;
    fields(b,['kind','id','placeId','name','unknownName','conditions','identityConditions','presentWhen','actions','serviceAccess'],at);
    check(['scene','equipment','resource','feature'].includes(b.kind)&&validEntityId(b.id)&&Object.hasOwn(s.places,b.placeId),`${at}.reference`);
    check(b.kind==='feature'?text(b.name):b.kind==='scene'?def.sceneObjects.some(o=>o.id===b.id&&!o.locationId):b.kind==='equipment'?Object.hasOwn(content.infrastructure,b.id):Object.hasOwn(def.resourceNodes,b.id),`${at}.subject`);
    const key=`${b.kind}:${b.id}`;check(!refs.has(key),`${at}.duplicate`);refs.add(key);
    for(const key of ['name','unknownName'])check(b[key]===undefined||text(b[key]),`${at}.${key}`);
    for(const key of ['conditions','identityConditions','presentWhen'])conditions(b[key],`${at}.${key}`);
    check(!b.identityConditions||text(b.unknownName),`${at}.unknownName required`);
    check(b.actions===undefined||Array.isArray(b.actions)&&b.actions.every(text),`${at}.actions`);
    check(b.serviceAccess===undefined||['local','facility','remote'].includes(b.serviceAccess),`${at}.serviceAccess`);
  }
  check(Array.isArray(s.nearby??=[]),`${path}.nearby`);
  for(const [i,n] of s.nearby.entries()) {
    fields(n,['targetId','conditions'],`${path}.nearby.${i}`);
    check(validEntityId(n.targetId)&&!!world.definitions[n.targetId]&&n.targetId!==def.id,`${path}.nearby.${i}.targetId`);
    conditions(n.conditions,`${path}.nearby.${i}.conditions`);
  }
}
export function localSpaceConditions(def) {
  const s=def.localSpace;if(!s)return [];
  return [...Object.values(s.places),...s.connections,...s.subjects,...s.nearby].flatMap(v=>['conditions','accessConditions','identityConditions','presentWhen'].map(k=>v[k]).filter(Boolean));
}
export function atSubjectPlace(state, world, hostId, kind, id) {
  const def=locationDefinition(state,world,hostId),binding=def?.localSpace?.subjects.find(b=>b.kind===kind&&b.id===id);
  return state.locationId===hostId && (!binding || playerPlaceId(state,world)===binding.placeId);
}
export function scenePerceived(state, world, content, hostId, scene) {
  if(!atSubjectPlace(state,world,hostId,'scene',scene.id))return false;
  const b=locationDefinition(state,world,hostId)?.localSpace?.subjects.find(b=>b.kind==='scene'&&b.id===scene.id);
  return !b||!localConditionReason(state,{world,content},b.conditions,hostId)&&!localConditionReason(state,{world,content},b.presentWhen,hostId);
}
export function perceivedSceneName(state, world, content, hostId, scene) {
  const b=locationDefinition(state,world,hostId)?.localSpace?.subjects.find(b=>b.kind==='scene'&&b.id===scene.id);
  return b?.identityConditions&&localConditionReason(state,{world,content},b.identityConditions,hostId)?b.unknownName:b?.name??scene.name;
}
export function localConditionReason(state, services, conditions, hostId=state.locationId) {
  // Spatial conditions read flags/knowledge/equipment, never cargo or services.
  return conditionReason({...state,locationId:hostId,localFlags:state.locations[hostId].flags},conditions,services.content);
}
export function localConnections(state, services) {
  const def=locationDefinition(state,services.world,state.locationId),s=localSpaceFor(def),from=playerPlaceId(state,services.world);
  return s.connections.filter(e=>e.from===from).flatMap(e=>{
    const p=s.places[e.to],known=state.locations[state.locationId].localKnowledge?.places[e.to]===true;
    const observable=!localConditionReason(state,services,e.conditions)&&!localConditionReason(state,services,p.conditions);
    if(!observable&&!known)return [];
    const unavailable=state.locations[state.locationId].localPlaceStates?.[e.to];
    const reason=unavailable==='destroyed'?'This place is destroyed.':unavailable==='sealed'?'This passage is sealed.':
      !observable?'This passage is not currently accessible.':localConditionReason(state,services,e.accessConditions)||localConditionReason(state,services,p.accessConditions);
    return [{id:e.to,name:p.name,reason:reason?(e.blockedReason??p.blockedReason??reason):'',status:unavailable==='destroyed'?'DESTROYED':reason?'INACCESSIBLE':''}];
  });
}
export function learnLocalPlaces(state, services) {
  const host=state.locations[state.locationId];if(!host?.localKnowledge)return false;
  let changed=false;
  for(const id of [playerPlaceId(state,services.world),...localConnections(state,services).map(e=>e.id)]) {
    if(!host.localKnowledge.places[id]){host.localKnowledge.places[id]=true;changed=true;}
  }
  return changed;
}
export function initializeLocalPosition(state, world, preserveNpcPlaces=false) {
  state.localPlaceId=entryPlaceId(locationDefinition(state,world,state.locationId));
  for(const [id,npc] of Object.entries(state.npcs))if(!isTerminal(state.entities[id])) {
    const def=locationDefinition(state,world,npc.locationId);
    if(!preserveNpcPlaces||!Object.hasOwn(localSpaceFor(def).places,npc.localPlaceId))npc.localPlaceId=entryPlaceId(def);
  }
}
export function validateLocalPosition(state, world) {
  const checkPlace=(hostId,placeId,label)=>check(validEntityId(placeId)&&Object.hasOwn(localSpaceFor(locationDefinition(state,world,hostId)).places,placeId),label);
  checkPlace(state.locationId,state.localPlaceId,'player position');
  for(const [id,npc] of Object.entries(state.npcs))if(!isTerminal(state.entities[id]))checkPlace(npc.locationId,npc.localPlaceId,`NPC ${id} position`);
  for(const [id,host] of Object.entries(state.locations)) {
    const def=locationDefinition(state,world,id);if(def?.kind!=='site'||isTerminal(state.entities[id]))continue;
    if(host.localKnowledge!==undefined){fields(host.localKnowledge,['places'],`knowledge ${id}`);check(record(host.localKnowledge.places),`knowledge places ${id}`);
      for(const [place,v] of Object.entries(host.localKnowledge.places)){checkPlace(id,place,`knowledge ${id}/${place}`);check(v===true,`knowledge ${id}/${place}`);}}
    if(host.localPlaceStates!==undefined){check(record(host.localPlaceStates),`place states ${id}`);for(const [place,v]of Object.entries(host.localPlaceStates)){
      checkPlace(id,place,`state ${id}/${place}`);check(['sealed','destroyed'].includes(v),`state ${id}/${place}`);
      if(v==='destroyed')check(!(state.locationId===id&&state.localPlaceId===place)&&!Object.entries(state.npcs).some(([npcId,n])=>!isTerminal(state.entities[npcId])&&n.locationId===id&&n.localPlaceId===place),`occupied destroyed place ${id}/${place}`);
    }}
  }
}
export function createLocalMovementAction(world, content) {
  const services={world,content};
  return {id:'moveLocal',name:'Move locally',scope:'global',group:'localMovement',
    targets:state=>localConnections(state,services).map(e=>({id:`moveLocal:${e.id}`,name:`Move to ${e.name}`,payload:{placeId:e.id}})),
    requirement:(state,_ctx,payload)=>localConnections(state,services).find(e=>e.id===payload?.placeId)?.reason??'This passage is no longer available.',
    execute(state,_ctx,payload){
      const edge=localConnections(state,services).find(e=>e.id===payload?.placeId);
      if(!isEntityActive(state,state.locationId)||!edge||edge.reason)throw new Error(edge?.reason||'This passage is no longer available.');
      state.localPlaceId=edge.id;learnLocalPlaces(state,services);return `Entered ${edge.name}.`;
    }};
}
