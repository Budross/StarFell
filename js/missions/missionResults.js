import { check,fields } from './missionCatalog.js';
const useful = outcome => ['SUCCEEDED','PARTIAL'].includes(outcome.status);
const unsuccessful = outcome => ['FAILED','PARTIAL','RECALLED'].includes(outcome.status);
export function initializeMissionResults(m) {
  m.schemaVersion=2;m.instructionRevision=1;m.revisionHistory=[];
  m.priorResults={useful:0,unsuccessful:0};m.lifetimeOutcome={...m.outcome};
}
export function refreshLifetime(m,evidence={}) {
  const work=m.priorResults.useful+(evidence.useful||useful(m.outcome)||m.objectiveOutcomes.some(o=>o.status==='COMPLETE')?1:0);
  const failures=m.priorResults.unsuccessful+(unsuccessful(m.outcome)?1:0);
  m.lifetimeOutcome={status:work&&failures?'PARTIAL':m.outcome.status==='PENDING'?'PENDING':work?'SUCCEEDED':m.outcome.status,reasonCode:m.outcome.reasonCode};
}
export function archiveRevision(m,evidence={}) {
  const work=evidence.useful || m.objectiveOutcomes.some(o=>o.status==='COMPLETE') || useful(m.outcome);
  const outcome=m.outcome.status!=='PENDING'?{...m.outcome}:{status:evidence.complete&&m.objectiveIndex===m.objectives.length-1?'SUCCEEDED':work?'PARTIAL':'SUPERSEDED',reasonCode:'REPLACED'};
  m.revisionHistory.push({instructionRevision:m.instructionRevision,outcome,objectiveOutcomes:structuredClone(m.objectiveOutcomes)});
  m.revisionHistory=m.revisionHistory.slice(-8);
  m.priorResults.useful+=work?1:0;m.priorResults.unsuccessful+=unsuccessful(outcome)?1:0;
  m.instructionRevision++;m.objectiveOutcomes=[];
}
export function migrateMissionResults(state) {
  for(const m of Object.values(state.missions?.instances ?? {})) {
    fields(m,['id','schemaVersion','vesselId','issuerId','sourceDefinitionId','name','acceptedAt','homeLocationId','objectives','returnPolicy','objectiveIndex','phase','progress','pendingOrders','objectiveOutcomes','outcome','finishedAt','revision']);
    check(m.schemaVersion===1,'unsupported legacy result schema');
    const outcome=structuredClone(m.outcome),objectiveOutcomes=structuredClone(m.objectiveOutcomes);
    initializeMissionResults(m);
    // v1 mixed result scopes cannot be reconstructed from saved domain facts.
    m.revisionHistory=[{instructionRevision:null,outcome,objectiveOutcomes}];
    m.priorResults={useful:useful(outcome)||objectiveOutcomes.some(o=>o.status==='COMPLETE')?1:0,unsuccessful:unsuccessful(outcome)?1:0};
    m.objectiveOutcomes=[];m.outcome={status:'PENDING',reasonCode:'LEGACY_UNSCOPED'};m.lifetimeOutcome=outcome;
  }
}
export function validateMissionResults(m) {
  check(Number.isSafeInteger(m.instructionRevision)&&m.instructionRevision>0,'invalid instruction revision');
  fields(m.priorResults,['useful','unsuccessful']);check(['useful','unsuccessful'].every(k=>Number.isSafeInteger(m.priorResults[k])&&m.priorResults[k]>=0&&m.priorResults[k]<=m.instructionRevision),'invalid lifetime counters');
  fields(m.lifetimeOutcome,['status','reasonCode']);check(['PENDING','SUCCEEDED','PARTIAL','FAILED','RECALLED'].includes(m.lifetimeOutcome.status)&&(m.lifetimeOutcome.reasonCode===null||typeof m.lifetimeOutcome.reasonCode==='string'&&m.lifetimeOutcome.reasonCode.length<=256),'invalid lifetime outcome');
  check(Array.isArray(m.revisionHistory)&&m.revisionHistory.length<=8,'invalid revision history');
  let prior=0,legacy=false;
  for(const [index,r] of m.revisionHistory.entries()) {
    fields(r,['instructionRevision','outcome','objectiveOutcomes']);
    check(r.instructionRevision===null||Number.isSafeInteger(r.instructionRevision)&&r.instructionRevision>prior&&r.instructionRevision<m.instructionRevision,'invalid historical revision');
    if(r.instructionRevision===null){check(index===0&&!legacy,'invalid legacy result scope');legacy=true;}
    if(r.instructionRevision!==null)prior=r.instructionRevision;
    fields(r.outcome,['status','reasonCode']);check(['PENDING','SUCCEEDED','PARTIAL','FAILED','RECALLED','SUPERSEDED'].includes(r.outcome.status)&&(r.outcome.reasonCode===null||typeof r.outcome.reasonCode==='string'&&r.outcome.reasonCode.length<=256),'invalid historical outcome');
    check(Array.isArray(r.objectiveOutcomes)&&r.objectiveOutcomes.length<=32,'invalid historical objectives');
    for(const o of r.objectiveOutcomes){fields(o,['objectiveId','status']);check(typeof o.objectiveId==='string'&&['COMPLETE','BLOCKED'].includes(o.status),'invalid historical objective');}
  }
  check(m.priorResults.useful>=m.revisionHistory.filter(r=>useful(r.outcome)||r.instructionRevision===null&&r.objectiveOutcomes.some(o=>o.status==='COMPLETE')).length&&m.priorResults.unsuccessful>=m.revisionHistory.filter(r=>unsuccessful(r.outcome)).length,'historical results exceed lifetime counters');
}
export function migrateMissionReport(m) {
  if(!m)return;
  m.instructionRevision=null;m.currentRevisionOutcome={status:'PENDING',reasonCode:'LEGACY_UNSCOPED'};m.lifetimeOutcome=structuredClone(m.outcome);
}
