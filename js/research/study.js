import { definitionHasCapability } from '../equipmentCatalog.js';
import { record, validId } from '../conditions.js';
import { getLocationContext } from '../locations.js';
import { canUse } from '../authority.js';
import { isOperational } from '../equipment.js';
import { deriveVessel } from '../vessels.js';
import { grantDiscovery } from '../knowledge.js';
import { conditionReason } from '../conditionContext.js';
import { entityReference } from '../entityReferences.js';
import { getEntityLabel } from '../entityQueries.js';

export const STUDY_KINDS=Object.freeze(['installedEquipment','vessel']);
export const emptyDesignStudy=()=>({version:1,operations:{},evidence:{}});
const signature=assembly=>JSON.stringify([assembly.core.moduleId,...assembly.attachments.map(p=>p.moduleId).sort()]);
const fail=message=>{throw new Error(`Invalid design study: ${message}.`);};
export function createStudySystem(services,source={}){
  const {content,world,research,processing}=services,rules={};
  if(!record(source)||Object.keys(source).length>64)fail('bounded catalog');
  for(const [id,raw]of Object.entries(source)){
    if(!validId(id)||!record(raw)||Object.keys(raw).some(k=>!['name','revision','kind','itemId','processId','discoveryId','principles','family'].includes(k))||
      typeof raw.name!=='string'||!raw.name.trim()||!Number.isSafeInteger(raw.revision)||raw.revision<1||!STUDY_KINDS.includes(raw.kind)||
      !research.catalog.discoveries[raw.discoveryId]?.studyOnly||!Array.isArray(raw.principles)||raw.principles.length>16||new Set(raw.principles).size!==raw.principles.length||raw.principles.some(p=>!research.catalog.discoveries[p])||
      !['prospectorVessel','concentrateRefinery'].includes(raw.family))fail(`rule ${id}`);
    if(raw.kind==='installedEquipment'){
      const item=content.items[raw.itemId],process=processing.catalog.definitions[raw.processId];
      if(raw.family!=='concentrateRefinery'||!item?.installation||!process||process.kind!=='refining'||!definitionHasCapability(content,item.installation.group,process.capability))fail(`equipment/process ${id}`);
    }else if(raw.family!=='prospectorVessel'||raw.itemId!==undefined||raw.processId!==undefined)fail(`vessel ${id}`);
    const {name,...contract}=raw;rules[id]={...structuredClone(raw),id,contract:JSON.stringify(contract)};
  }
  const byDiscovery=Object.fromEntries(Object.values(rules).map(r=>[r.discoveryId,r]));
  function visit(id,active=new Set()){
    if(active.has(id))fail('cyclic study prerequisites');const rule=byDiscovery[id];if(!rule)return;
    for(const parent of rule.principles)visit(parent,new Set([...active,id]));
  }
  Object.keys(byDiscovery).forEach(id=>visit(id));
  function subject(state,rule,request){
    if(!record(request)||Object.keys(request).some(k=>!['ruleId','subjectId'].includes(k)))fail('typed request');
    const id=request.subjectId,local=state.locations[id];
    if(!local||state.entities[id]?.lifecycle!=='active'||!canUse(state,'player',id,'useFacilities'))fail('accessible active subject required');
    if(rule.kind==='installedEquipment'){
      if(id!==state.locationId)fail('visit the machine to study it');
      const group=content.items[rule.itemId].installation.group;
      if(!isOperational(local.infrastructure,group))fail('install and enable the study machine');
      return {signature:rule.itemId,group};
    }
    if(state.entities[id].type!=='ship'||!local.assembly||local.journey||local.dockedAtId!==state.locationId||!world.definitions[state.entities[state.locationId]?.definition?.id]?.shipyard)fail('return the vessel to your occupied Shipyard');
    const vessel=deriveVessel(local.assembly,content);
    if(vessel.core.boardable||vessel.warnings.length)fail('study requires a complete operational prospector');
    for(const moduleId of Object.keys(vessel.counts))if(!state.knowledge.discoveries[content.vesselModules[moduleId].designDiscoveryId])fail('understand every source module design first');
    if(Object.entries(vessel.equipment).some(([group,e])=>e.quantity&&!isOperational(local.infrastructure,group)))fail('restore source equipment before study');
    return {signature:signature(local.assembly)};
  }
  function preview(state,request){
    try{
      const rule=rules[request?.ruleId];if(!rule)fail('choose an authored study');
      if(state.knowledge.discoveries[rule.discoveryId]||state.designStudy.evidence[rule.id])fail('this design is already understood');
      const resolved=subject(state,rule,request),missing=rule.principles.filter(id=>!state.knowledge.discoveries[id]);
      if(missing.length)fail('first understand '+missing.map(id=>research.catalog.discoveries[id].name).join(', '));
      const eligibility=conditionReason(getLocationContext(state,content,world).actionState,research.catalog.discoveries[rule.discoveryId].eligibility,content);
      if(eligibility)fail(eligibility);
      const operation=state.designStudy.operations[rule.id];
      if(!operation||operation.subjectId!==request.subjectId||operation.signature!==resolved.signature||rule.kind==='vessel'&&operation.sourceId===state.locationId)fail(rule.kind==='vessel'?'complete an extraction batch away from the yard, then return':'complete the relevant process on this machine first');
      return {ok:true,reason:'',rule,operation};
    }catch(e){return {ok:false,reason:e.message};}
  }
  function study(state,request){
    const p=preview(state,request);if(!p.ok)throw new Error(p.reason);
    state.designStudy.evidence[p.rule.id]={revision:p.rule.revision,contract:p.rule.contract,discoveryId:p.rule.discoveryId,subjectId:request.subjectId,kind:p.rule.kind,occurredAt:p.operation.occurredAt,observedAt:state.simulationTime};
    grantDiscovery(state,p.rule.discoveryId);
    services.ledgerServices.append(state,{type:'DESIGN_STUDIED',actorId:'player',targetId:request.subjectId,locationId:state.locationId,data:{studyId:p.rule.id,revision:p.rule.revision,discoveryId:p.rule.discoveryId}});
    return `Understood ${research.catalog.discoveries[p.rule.discoveryId].name}. No materials or equipment were consumed.`;
  }
  // Explicit Processing completion boundary. Buffered/aborted work never counts.
  // One bounded slot per authored study; receipts survive ledger eviction.
  function recordDelivery(state,run){
    if(!state.designStudy||run.initiatorId!=='player'||!canUse(state,'player',run.hostId,'useFacilities'))return;
    for(const rule of Object.values(rules)){
      if(state.designStudy.evidence[rule.id])continue;
      const local=state.locations[run.hostId];let key;
      if(rule.kind==='installedEquipment'){
        if(run.processId!==rule.processId||run.equipmentId!==content.items[rule.itemId].installation.group)continue;key=rule.itemId;
      }else{
        if(run.kind!=='extraction'||!local.assembly)continue;
        const v=deriveVessel(local.assembly,content);if(v.core.boardable||v.warnings.length)continue;key=signature(local.assembly);
      }
      state.designStudy.operations[rule.id]={revision:rule.revision,contract:rule.contract,subjectId:run.hostId,sourceId:run.sourceLocationId??run.hostId,signature:key,occurredAt:state.simulationTime};
    }
  }
  function validate(state){
    const s=state.designStudy;if(!record(s)||s.version!==1||Object.keys(s).some(k=>!['version','operations','evidence'].includes(k))||!record(s.operations)||!record(s.evidence)||Object.keys(s.operations).length>64||Object.keys(s.evidence).length>64)fail('saved version/shape');
    for(const [id,o]of Object.entries(s.operations)){
      if(!validId(id)||!record(o)||Object.keys(o).length!==6||!Number.isSafeInteger(o.revision)||o.revision<1||typeof o.contract!=='string'||o.contract.length>8192||!state.entities[o.subjectId]||!state.entities[o.sourceId]||typeof o.signature!=='string'||o.signature.length>4096||!Number.isFinite(o.occurredAt)||o.occurredAt<0||o.occurredAt>state.simulationTime)fail('operation receipt');
      if(rules[id]&&(rules[id].revision!==o.revision||rules[id].contract!==o.contract))fail('used study contract changed; explicit migration required');
    }
    for(const [id,e]of Object.entries(s.evidence)){
      if(!validId(id)||!record(e)||Object.keys(e).length!==7||!STUDY_KINDS.includes(e.kind)||!state.entities[e.subjectId]||!validId(e.discoveryId)||!Number.isSafeInteger(e.revision)||e.revision<1||typeof e.contract!=='string'||e.contract.length>8192||!Number.isFinite(e.occurredAt)||!Number.isFinite(e.observedAt)||e.occurredAt<0||e.observedAt<e.occurredAt||e.observedAt>state.simulationTime||!state.knowledge.discoveries[e.discoveryId])fail('understanding receipt');
      if(rules[id]&&(rules[id].revision!==e.revision||rules[id].contract!==e.contract))fail('used study contract changed; explicit migration required');
    }
  }
  function options(state){
    return Object.values(rules).flatMap(rule=>{
      const ids=rule.kind==='installedEquipment'?[state.locationId]:Object.keys(state.locations).filter(id=>state.locations[id].assembly&&state.locations[id].dockedAtId===state.locationId&&canUse(state,'player',id,'useFacilities'));
      return ids.filter(id=>rule.kind==='vessel'||state.locations[id].infrastructure[content.items[rule.itemId].installation.group]?.quantity>0).map(subjectId=>({ruleId:rule.id,subjectId,name:rule.kind==='vessel'?`${rule.name}: ${getEntityLabel(state,{world},subjectId)}`:rule.name,...preview(state,{ruleId:rule.id,subjectId})}));
    });
  }
  return {rules,preview,study,recordDelivery,options,lifecycle:{id:'design-study',initialize:s=>{s.designStudy=emptyDesignStudy();},reconcile:s=>{if(!Object.hasOwn(s,'designStudy'))s.designStudy=emptyDesignStudy();},validate},
    collectReferences:s=>[...Object.values(s.designStudy?.operations??{}).flatMap(o=>[o.subjectId,o.sourceId]),...Object.values(s.designStudy?.evidence??{}).map(e=>e.subjectId)].map(id=>entityReference('research-study',id,'historyLocation')),
    actions:[{id:'research:study',name:'Study engineering design',group:'research',scope:'global',permissions:[],requirement:(s,c,r)=>preview(s,r).reason,execute:(s,c,r)=>study(s,r)}]};
}
