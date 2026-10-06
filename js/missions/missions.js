import { check, fields, identity } from './missionCatalog.js';
import { validateMissionResults,archiveRevision,refreshLifetime } from './missionResults.js';

export const emptyMissions = () => ({ nextId: 1, instances: {} });
export const unfinished = m => m.phase !== 'COMPLETED';
export function currentMission(state, vesselId) { return Object.values(state.missions?.instances ?? {}).find(m => m.vesselId === vesselId && unfinished(m)); }
const instruction = m => ({ name:m.name, homeLocationId:m.homeLocationId, objectives:m.objectives, returnPolicy:m.returnPolicy });

export function validateMissions(state, catalog) {
  fields(state.missions, ['nextId','instances']);
  const { nextId, instances } = state.missions;
  check(Number.isSafeInteger(nextId) && nextId > 0 && instances && typeof instances === 'object' && !Array.isArray(instances), 'invalid mission slice');
  check(Object.keys(instances).length <= 200, 'mission history too large');
  const vessels = new Set();
  for (const [id,m] of Object.entries(instances)) {
    fields(m, ['id','schemaVersion','vesselId','issuerId','sourceDefinitionId','name','acceptedAt','homeLocationId','objectives','returnPolicy','objectiveIndex','phase','progress','pendingOrders','objectiveOutcomes','outcome','finishedAt','revision','instructionRevision','revisionHistory','priorResults','lifetimeOutcome']);
    check(id === m.id && /^mission[1-9]\d*$/.test(id) && Number(id.slice(7)) < nextId && m.schemaVersion === 2, 'invalid saved mission ID');
    validateMissionResults(m);
    check(identity(m.vesselId) && identity(m.issuerId) && (m.sourceDefinitionId === undefined || identity(m.sourceDefinitionId)), 'invalid mission references');
    catalog.compile(instruction(m), true);
    check(Number.isFinite(m.acceptedAt) && m.acceptedAt >= 0 && m.acceptedAt <= state.simulationTime, 'invalid acceptance time');
    check(['ACTIVE','RETURNING','COMPLETED','STRANDED'].includes(m.phase), 'invalid mission phase');
    check(Number.isSafeInteger(m.objectiveIndex) && m.objectiveIndex >= 0 && m.objectiveIndex <= m.objectives.length && Number.isSafeInteger(m.revision) && m.revision >= 0, 'invalid objective index/revision');
    const o = m.objectives[m.objectiveIndex];
    check(m.progress === null || !!o, 'progress without objective');
    if (o) catalog.resolve(o.action,o.actionVersion).validate(o,m.progress);
    if (unfinished(m)) { check(!vessels.has(m.vesselId), 'multiple unfinished missions for vessel'); vessels.add(m.vesselId); }
    check(m.finishedAt === null || Number.isFinite(m.finishedAt) && m.finishedAt >= m.acceptedAt && m.finishedAt <= state.simulationTime, 'invalid completion time');
    check((m.phase === 'COMPLETED') === (m.finishedAt !== null), 'inconsistent completion');
    fields(m.outcome,['status','reasonCode']);
    check(['PENDING','SUCCEEDED','PARTIAL','FAILED','RECALLED'].includes(m.outcome.status) && (m.outcome.reasonCode === null || typeof m.outcome.reasonCode === 'string' && m.outcome.reasonCode.length <= 256), 'invalid outcome');
    check(Array.isArray(m.objectiveOutcomes) && m.objectiveOutcomes.length <= 32, 'invalid objective history');
    for (const result of m.objectiveOutcomes) { fields(result,['objectiveId','status']); check(identity(result.objectiveId) && ['COMPLETE','BLOCKED'].includes(result.status), 'invalid objective result'); }
    if (m.pendingOrders !== null) {
      fields(m.pendingOrders,['kind','instructions']); check(['replace','recall'].includes(m.pendingOrders.kind), 'invalid pending orders');
      if (m.pendingOrders.kind === 'replace') catalog.compile(m.pendingOrders.instructions,true);
      else check(m.pendingOrders.instructions === null, 'invalid recall');
    }
  }
}

export function advanceMissions(state, catalog, transport, recordTransition, clock) {
  let changed = false;
  for (const mission of Object.values(state.missions.instances).sort((a,b) => Number(a.id.slice(7))-Number(b.id.slice(7)))) {
    if (!unfinished(mission)) continue;
    const before = JSON.stringify(mission);
    // Accepted journeys finish before either new instructions or return routing.
    if (transport.read(state,mission.vesselId).journey) continue;
    let objective = mission.objectives[mission.objectiveIndex];
    let action = objective && catalog.resolve(objective.action,objective.actionVersion);
    let retirement={};
    if (mission.pendingOrders || mission.phase === 'RETURNING') {
      if (action && mission.progress !== null) {
        // Observe completed work before retiring its progress, including same-frame results.
        const ready = action.safeToReplace?.(state,objective,mission.progress,mission) ?? true;
        check(typeof ready==='boolean'||ready&&typeof ready.ready==='boolean'&&typeof ready.useful==='boolean'&&typeof ready.complete==='boolean','invalid safe replacement result');
        if(typeof ready==='object')fields(ready,['ready','useful','complete']);
        if (!(typeof ready==='boolean'?ready:ready.ready)) continue;
        if(typeof ready==='object')retirement=ready;
        if(retirement.complete&&!mission.objectiveOutcomes.some(o=>o.objectiveId===objective.id&&o.status==='COMPLETE'))mission.objectiveOutcomes.push({objectiveId:objective.id,status:'COMPLETE'});
      }
      if (mission.pendingOrders) {
        const pending = mission.pendingOrders; mission.pendingOrders = null;
        if (pending.kind === 'recall') { mission.phase='RETURNING'; mission.outcome={ status:'RECALLED', reasonCode:null }; }
        else { archiveRevision(mission,retirement);Object.assign(mission,pending.instructions); mission.objectiveIndex=0; mission.progress=null; mission.phase='ACTIVE'; mission.outcome={status:'PENDING',reasonCode:null}; }
        objective=mission.objectives[mission.objectiveIndex]; action=objective && catalog.resolve(objective.action,objective.actionVersion);
      }
    }
    for (let count=0; count<66; count++) {
      if (mission.phase === 'STRANDED') break;
      const destination = mission.phase === 'RETURNING' ? mission.homeLocationId : mission.objectives[mission.objectiveIndex]?.destinationId;
      if (!destination) { mission.phase='RETURNING'; mission.outcome={status:'SUCCEEDED',reasonCode:null}; continue; }
      if (mission.phase === 'ACTIVE') {
        objective=mission.objectives[mission.objectiveIndex]; action=catalog.resolve(objective.action,objective.actionVersion);
        if (mission.progress === null) mission.progress=action.activate?.(state,objective,mission) ?? {};
      }
      const route = transport.next(state,mission.vesselId,mission.issuerId,destination);
      if (route.status === 'BLOCKED') {
        if (mission.phase === 'RETURNING') { mission.phase='STRANDED'; mission.outcome.reasonCode=route.reason; recordTransition(state,mission,'STRANDED'); }
        else { mission.outcome={status:mission.objectiveOutcomes.some(r=>r.status==='COMPLETE') ? 'PARTIAL':'FAILED',reasonCode:route.reason}; mission.phase='RETURNING'; recordTransition(state,mission,'BLOCKED'); }
        break;
      }
      if (route.status === 'WAITING') break;
      if (route.status === 'ACTION') { transport.execute(state,mission.vesselId,mission.issuerId,route.leg); break; }
      if (mission.phase === 'RETURNING') { mission.phase='COMPLETED'; mission.finishedAt=clock ? clock.now(state) : state.simulationTime; recordTransition(state,mission,'RETURNED'); break; }
      const result=action.advance(state,objective,mission.progress,mission);
      check(result && ['COMPLETE','ACTION','WAITING','BLOCKED'].includes(result.status), 'invalid action result');
      action.validate(objective,mission.progress);
      if (result.status === 'COMPLETE') { mission.objectiveOutcomes.push({objectiveId:objective.id,status:'COMPLETE'}); mission.objectiveOutcomes=mission.objectiveOutcomes.slice(-32); mission.objectiveIndex++; mission.progress=null; continue; }
      if (result.status === 'BLOCKED') {
        mission.objectiveOutcomes.push({objectiveId:objective.id,status:'BLOCKED'});
        mission.objectiveOutcomes=mission.objectiveOutcomes.slice(-32);
        mission.outcome={status:result.partial || mission.objectiveOutcomes.some(r=>r.status==='COMPLETE') ? 'PARTIAL':'FAILED',reasonCode:result.reason ?? 'OBJECTIVE_BLOCKED'};
        mission.phase='RETURNING'; recordTransition(state,mission,'BLOCKED');
      }
      break;
    }
    refreshLifetime(mission,retirement);changed ||= before !== JSON.stringify(mission);
  }
  const completed=Object.values(state.missions.instances).filter(m=>!unfinished(m)).sort((a,b)=>a.finishedAt-b.finishedAt || a.id.localeCompare(b.id));
  for (const m of completed.slice(0,Math.max(0,completed.length-100))) { delete state.missions.instances[m.id]; changed=true; }
  return { saveRequested:changed };
}

export function missionReferences(state,catalog,reference) {
  const refs=[];
  for (const m of Object.values(state.missions?.instances ?? {})) {
    const root=`missions.instances.${m.id}`;
    refs.push(reference(`${root}.vesselId`,m.vesselId,'historyVessel'),reference(`${root}.issuerId`,m.issuerId,'principal'));
    function collect(instructions,path,activeProgress) {
      refs.push(reference(`${path}.homeLocationId`,instructions.homeLocationId,'historyLocation'));
      for (const [i,o] of instructions.objectives.entries()) {
        refs.push(reference(`${path}.objectives.${i}.destinationId`,o.destinationId,'historyLocation'));
        refs.push(...(catalog.resolve(o.action,o.actionVersion).references?.(o,activeProgress && i===m.objectiveIndex ? m.progress : null,`${path}.objectives.${i}`,reference) ?? []));
      }
    }
    collect(m,root,true);
    if (m.pendingOrders?.kind==='replace') collect(m.pendingOrders.instructions,`${root}.pendingOrders.instructions`,false);
  }
  return refs;
}
