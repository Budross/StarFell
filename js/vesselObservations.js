import { vesselLinkReason } from './vesselAccess.js';
import { locationDefinition, getEntityLabel } from './entityQueries.js';
import { canUse } from './authority.js';
import { getLocationContext } from './locations.js';
import { storageSummary, describeStorage } from './storage.js';
import { vesselFuelSummary } from './vesselFuel.js';
import { encounterItem } from './itemKnowledgeState.js';
import { entityReference } from './entityReferences.js';

export const emptyVesselReports=()=>({byVessel:{}});
const record=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const text=(value,max=512)=>typeof value==='string' && value.length<=max;
const nullableId=value=>value===null || typeof value==='string' && /^[A-Za-z][\w-]{0,127}$/.test(value);
function requireFields(value,keys) {
  if(!record(value) || Object.keys(value).length!==keys.length || keys.some(k=>!Object.hasOwn(value,k)))throw new Error('Invalid vessel report fields.');
}
// Contact samples follow simulation time. Only meaningful changes request an
// immediate save; ticking clocks, battery levels and journey timers use runtime's
// ordinary save cadence rather than forcing browser storage on every frame.
function significantReports(slice) {
  const copy=structuredClone(slice);
  for(const entry of Object.values(copy.byVessel)) {
    if(entry.lastObservation)delete entry.lastObservation.observedAt;
    if(entry.lastReport) {
      delete entry.lastReport.observedAt;delete entry.lastReport.power;
      if(entry.lastReport.journey)delete entry.lastReport.journey.remaining;
      for(const equipment of Object.values(entry.lastReport.equipment))delete equipment.health;
    }
  }
  return JSON.stringify(copy);
}
export function createVesselObservations({world,content,missionFor,missionReport,validateMissionReport,migrateMissionReport}) {
  const services={world,content};
  function linked(state,id) { return !vesselLinkReason(state,id,services); }
  function localPresence(state,id) {
    const local=state.locations[id], occupied=state.locations[state.locationId], def=locationDefinition(state,world,state.locationId);
    return state.entities[id]?.lifecycle==='active' && local && occupied && !occupied.journey && !local.journey && local.areaId===occupied.areaId &&
      (local.dockedAtId===state.locationId || def?.narrative?.observableTopics?.includes('local_ship_presence'));
  }
  function capture(state) {
    const before=significantReports(state.vesselReports);
    for(const [id,local] of Object.entries(state.locations)) {
      const def=locationDefinition(state,world,id);
      if(def?.controlMode!=='commanded' || !canUse(state,'player',id,'viewCargo') && !state.vesselReports.byVessel[id])continue;
      // Ownership can establish a fleet identity without inventing a contact.
      const entry=state.vesselReports.byVessel[id] ??= {name:def.name,lastReport:null,lastObservation:null};
      const connected=linked(state,id),observed=localPresence(state,id);
      if(!connected && !observed)continue;
      if(!connected){entry.lastObservation={observedAt:state.simulationTime,areaId:local.areaId};continue;}
      // A detailed contact supersedes the coarse sighting. This also preserves
      // ordering when several committed actions share the same simulation time.
      entry.lastObservation=null;
      const detail=canUse(state,'player',id,'viewCargo'), equipment=canUse(state,'player',id,'useFacilities') || canUse(state,'player',id,'manageEquipment');
      const report={observedAt:state.simulationTime,via:local.dockedAtId===state.locationId?'localBerth':'radio',areaId:local.journey?.kind==='area'?null:local.areaId,
        dockedAtId:local.dockedAtId,journey:local.journey?{...local.journey}:null,mission:canUse(state,'player',id,'pilot') || equipment ? missionReport(missionFor(state,id),detail&&equipment?state:undefined):null,cargoText:'',fuelText:'',power:null,equipment:{}};
      if(detail) {
        report.cargoText=describeStorage(storageSummary(getLocationContext(state,content,world,id).store,content));
        const fuel=vesselFuelSummary(state,id,content);report.fuelText=Object.entries(fuel.items).map(([item,n])=>`${n} ${content.items[item].name}`).join(', ') || 'Empty tank';
        report.power=local.resources.power;
        for(const [item,n] of Object.entries(local.resources))if(n>0 && content.items[item])encounterItem(state,item);
      }
      if(equipment)for(const [group,machine] of Object.entries(local.infrastructure))if(machine.quantity>0)report.equipment[group]={quantity:machine.quantity,health:machine.health,enabled:machine.enabled};
      entry.lastReport=report;
    }
    return before!==significantReports(state.vesselReports);
  }
  function get(state,id) {
    const entry=state.vesselReports?.byVessel[id], detail=entry?.lastReport;
    const live=linked(state,id), observed=localPresence(state,id);
    // No authoritative location, task, equipment or failure is read below without contact.
    const observation=entry?.lastObservation;
    const newerObservation=observation && (!detail || observation.observedAt>=detail.observedAt);
    return structuredClone({id,name:entry?.name ?? (live || observed ? getEntityLabel(state,{world},id):id),
      classification:live?'LIVE':observed?'LOCALLY_OBSERVED':detail || observation?'LAST_KNOWN':'UNKNOWN',commandable:live && canUse(state,'player',id,'pilot'),
      areaId:live?detail?.areaId ?? null:observed?state.locations[id].areaId:newerObservation?observation.areaId:detail?.areaId ?? observation?.areaId ?? null,
      dockedAtId:newerObservation ? null:detail?.dockedAtId ?? null,observedAt:newerObservation?observation.observedAt:detail?.observedAt ?? observation?.observedAt ?? null,
      report:detail ?? null});
  }
  const lifecycle={id:'vessel-reports',initialize:state=>{state.vesselReports=emptyVesselReports();},reconcile:(state,context)=>{if(!Object.hasOwn(state,'vesselReports'))state.vesselReports=emptyVesselReports();if(context.migrateMissionResults)for(const e of Object.values(state.vesselReports.byVessel))migrateMissionReport?.(e.lastReport?.mission);},validate(state) {
    const slice=state.vesselReports;
    if(!slice || Object.keys(slice).length!==1 || !record(slice.byVessel) || Object.keys(slice.byVessel).length>200)throw new Error('Invalid vessel reports.');
    for(const [id,e] of Object.entries(slice.byVessel)) {
      requireFields(e,['name','lastReport','lastObservation']);
      if(state.entities[id]?.type!=='ship' || !text(e.name,128))throw new Error('Invalid vessel report identity.');
      for(const value of [e.lastReport,e.lastObservation])if(value && (!Number.isFinite(value.observedAt) || value.observedAt<0 || value.observedAt>state.simulationTime || JSON.stringify(value).length>16384))throw new Error('Invalid vessel report time/size.');
      if(e.lastObservation!==null) {
        requireFields(e.lastObservation,['observedAt','areaId']);
        if(!nullableId(e.lastObservation.areaId) || e.lastObservation.areaId===null)throw new Error('Invalid observed area.');
      }
      if(e.lastReport===null)continue;
      const r=e.lastReport;
      requireFields(r,['observedAt','via','areaId','dockedAtId','journey','mission','cargoText','fuelText','power','equipment']);
      if(!['radio','localBerth'].includes(r.via) || !nullableId(r.areaId) || !nullableId(r.dockedAtId) || !text(r.cargoText,4096) || !text(r.fuelText,4096) || !(r.power===null || Number.isFinite(r.power) && r.power>=0) || !record(r.equipment))throw new Error('Invalid vessel report fields.');
      for(const [group,equipment] of Object.entries(r.equipment)) {
        requireFields(equipment,['quantity','health','enabled']);
        if(!content.infrastructure[group] || !Number.isSafeInteger(equipment.quantity) || equipment.quantity<=0 || !Number.isFinite(equipment.health) || equipment.health<0 || equipment.health>1 || typeof equipment.enabled!=='boolean')throw new Error('Invalid reported equipment.');
      }
      if(r.journey!==null) {
        requireFields(r.journey,['kind','targetId','originAreaId','duration','remaining']);
        if(!['area','dock'].includes(r.journey.kind) || !nullableId(r.journey.targetId) || r.journey.targetId===null || !nullableId(r.journey.originAreaId) || r.journey.originAreaId===null || !Number.isFinite(r.journey.duration) || r.journey.duration<=0 || !Number.isFinite(r.journey.remaining) || r.journey.remaining<=0 || r.journey.remaining>r.journey.duration || r.dockedAtId!==null)throw new Error('Invalid reported journey.');
      }
      if(r.mission!==null) {
        const m=r.mission;
        requireFields(m,['id','name','phase','homeLocationId','objectiveIndex','revision','outcome','pending','destinationId','action','actionVersion','progressText','instructionRevision','currentRevisionOutcome','lifetimeOutcome']);
        for(const result of [m.currentRevisionOutcome,m.lifetimeOutcome]){requireFields(result,['status','reasonCode']);if(!['PENDING','SUCCEEDED','PARTIAL','FAILED','RECALLED'].includes(result.status)||!(result.reasonCode===null||text(result.reasonCode,256)))throw new Error('Invalid reported outcome.');}
        if(!(m.instructionRevision===null||Number.isSafeInteger(m.instructionRevision)&&m.instructionRevision>0))throw new Error('Invalid reported instruction revision.');
        requireFields(m.outcome,['status','reasonCode']);
        if(!/^mission[1-9]\d*$/.test(m.id) || !text(m.name,128) || !['ACTIVE','RETURNING','COMPLETED','STRANDED'].includes(m.phase) || !nullableId(m.homeLocationId) || m.homeLocationId===null || !nullableId(m.destinationId) || !nullableId(m.action) || !(m.actionVersion===null || Number.isSafeInteger(m.actionVersion) && m.actionVersion>0) || !Number.isSafeInteger(m.objectiveIndex) || m.objectiveIndex<0 || m.objectiveIndex>32 || !Number.isSafeInteger(m.revision) || m.revision<0 || typeof m.pending!=='boolean' || !text(m.progressText,4096) || !['PENDING','SUCCEEDED','PARTIAL','FAILED','RECALLED'].includes(m.outcome.status) || !(m.outcome.reasonCode===null || text(m.outcome.reasonCode,256)))throw new Error('Invalid reported mission.');
        validateMissionReport?.(m);
      }
    }
  }};
  return {get,capture,lifecycle,simulationStep:{id:'vessel-reports',advance:state=>({saveRequested:capture(state)})},collectReferences(state) {
    return Object.entries(state.vesselReports?.byVessel ?? {}).flatMap(([id,e])=>[
      entityReference(`vesselReports.${id}`,id,'historyVessel'),
      ...[e.lastReport,e.lastObservation].filter(Boolean).flatMap(r=>[
        ...(r.areaId?[entityReference(`vesselReports.${id}.area`,r.areaId,'historyArea')]:[]),
        ...(r.dockedAtId?[entityReference(`vesselReports.${id}.dock`,r.dockedAtId,'historyLocation')]:[]),
        ...(r.journey?[entityReference(`vesselReports.${id}.journey.target`,r.journey.targetId,r.journey.kind==='area'?'historyArea':'historyLocation'),entityReference(`vesselReports.${id}.journey.origin`,r.journey.originAreaId,'historyArea')]:[]),
        ...(r.mission?[entityReference(`vesselReports.${id}.mission.home`,r.mission.homeLocationId,'historyLocation'),...(r.mission.destinationId?[entityReference(`vesselReports.${id}.mission.destination`,r.mission.destinationId,'historyLocation')]:[])]:[])
      ])]);
  }};
}
