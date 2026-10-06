import {record,getEntity} from './entities.js';
import {containsPosition} from './worldSpace.js';
export const emptyMapKnowledge=()=>({areas:{}});
export const areaKnowledge=(state,id)=>state.mapKnowledge?.areas[id]?.level ?? 'UNKNOWN';
// Trusted mutation APIs: call only during initial installation or on an admitted
// runtime candidate. These are not exposed as player payload actions.
export function admitKnownArea(state,areaId) {
  if(getEntity(state,areaId)?.type!=='area')throw new Error('Map admission requires an Area.');
  if(areaKnowledge(state,areaId)==='KNOWN')return false;
  state.mapKnowledge.areas[areaId]={level:'KNOWN',areaId};return true;
}
export function admitDetectedArea(state,areaId,approximatePosition,source) {
  if(areaKnowledge(state,areaId)!=='UNKNOWN')return false;
  if(getEntity(state,areaId)?.type!=='area'||!containsPosition(state.worldGeography.space,approximatePosition)||typeof source!=='string'||!source.trim())throw new Error('Invalid detected map contact.');
  state.mapKnowledge.areas[areaId]={level:'DETECTED',approximatePosition:approximatePosition.map(v=>v||0),source};return true;
}
export function validateMapKnowledge(state) {
  const m=state.mapKnowledge;
  if(!record(m)||Object.keys(m).length!==1||!record(m.areas))throw new Error('Invalid Map Knowledge.');
  for(const [id,r] of Object.entries(m.areas)) {
    if(getEntity(state,id)?.type!=='area'||!record(r))throw new Error('Invalid map reference.');
    if(r.level==='KNOWN') {
      if(r.areaId!==id||Object.keys(r).sort().join(',')!=='areaId,level')throw new Error('Invalid known map record.');
    }else if(r.level==='DETECTED') {
      if(Object.keys(r).sort().join(',')!=='approximatePosition,level,source'||!containsPosition(state.worldGeography.space,r.approximatePosition)||typeof r.source!=='string'||!r.source.trim())throw new Error('Invalid detected map record.');
    }else throw new Error('Unknown Areas have no map record.');
  }
}
export function detectedContacts(state) {
  // Deliberately anonymous: internal Area identities never enter UI projections.
  return Object.values(state.mapKnowledge?.areas??{}).filter(r=>r.level==='DETECTED').map((r,i)=>({id:`contact_${i}`,kind:'contact',name:'Unknown body',knowledge:'DETECTED',position:[...r.approximatePosition],description:`Approximate position · ${r.source}`,reason:'Identity unknown; navigation unavailable.'}));
}
