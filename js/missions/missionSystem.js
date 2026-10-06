import { createMissionCatalog, check, fields, identity } from './missionCatalog.js';
import { emptyMissions, currentMission, validateMissions, advanceMissions, missionReferences } from './missions.js';
import { initializeMissionResults,migrateMissionResults } from './missionResults.js';

export function createMissionSystem({ actions, definitions={}, destinations, transport, access, reference, clock, recordTransition=()=>{} }) {
  const catalog=createMissionCatalog(actions,destinations,definitions);
  function instructions(request,state) {
    fields(request,['vesselId','name','homeLocationId','objectives','returnPolicy','definitionId','revision','objectiveDestinations']);
    check(identity(request.vesselId),'invalid assigned vessel');
    if (request.definitionId) {
      const def=catalog.definitions[request.definitionId]; check(!!def,'unknown definition');
      const bindings=request.objectiveDestinations ?? {};fields(bindings,def.objectives.map(o=>o.id));check(Object.values(bindings).every(identity),'invalid runtime destination binding');
      const objectives=def.objectives.map(o=>({...o,destinationId:bindings[o.id] ?? o.destinationId}));
      return catalog.compile({name:def.name,homeLocationId:request.homeLocationId ?? def.homeLocationId,objectives,returnPolicy:def.returnPolicy},true,false,state);
    }
    check(request.objectiveDestinations===undefined,'runtime destination bindings require a definition');
    return catalog.compile({name:request.name,homeLocationId:request.homeLocationId,objectives:request.objectives,returnPolicy:request.returnPolicy},false,false,state);
  }
  function preflight(state,vesselId,issuerId,accepted) {
    const plan=transport.planningState(state,vesselId);
    const existing=currentMission(state,vesselId), current=existing?.objectives[existing.objectiveIndex];
    if(current)catalog.resolve(current.action,current.actionVersion).projectPendingWork?.(plan,current,existing.progress,existing);
    let fuel=0;const legs=[];
    for (const objective of [...accepted.objectives,null]) {
      const route=transport.previewRoute(plan,vesselId,issuerId,objective?.destinationId ?? accepted.homeLocationId);
      check(route.ok,route.reason); fuel+=route.fuel;legs.push(...(route.legs ?? []));
      if (objective) {
        const result=catalog.resolve(objective.action,objective.actionVersion).preview(plan,objective,{vesselId,issuerId});
        check(result.ok,result.reason);
      }
    }
    return {fuel,route:legs, message:'Mission currently feasible. World conditions can change before return.'};
  }
  function preview(state,request,issuerId='player',replacing=false) {
    try {
      const accepted=instructions(request,state);
      check(!access.commandReason(state,request.vesselId,issuerId),access.commandReason(state,request.vesselId,issuerId));
      const existing=currentMission(state,request.vesselId);
      if (replacing) check(!!existing && request.revision === existing.revision,'orders changed; refresh before updating');
      else { check(!existing,'vessel already has an unfinished mission'); check(!access.assignmentReason(state,request.vesselId,issuerId),access.assignmentReason(state,request.vesselId,issuerId)); }
      return {ok:true,accepted,...preflight(state,request.vesselId,issuerId,accepted)};
    } catch(error) { return {ok:false,reason:error.message}; }
  }
  function assign(state,request,issuerId='player') {
    const result=preview(state,request,issuerId); check(result.ok,result.reason);
    const id=`mission${state.missions.nextId++}`;
    check(Number.isSafeInteger(state.missions.nextId),'mission IDs exhausted');
    state.missions.instances[id]={id,schemaVersion:1,vesselId:request.vesselId,issuerId,...result.accepted,
      ...(request.definitionId ? {sourceDefinitionId:request.definitionId}:{}),acceptedAt:clock ? clock.now(state) : state.simulationTime,objectiveIndex:0,phase:'ACTIVE',progress:null,pendingOrders:null,
      objectiveOutcomes:[],outcome:{status:'PENDING',reasonCode:null},finishedAt:null,revision:0};
    initializeMissionResults(state.missions.instances[id]);recordTransition(state,state.missions.instances[id],'ASSIGNED'); return id;
  }
  function update(state,request,issuerId='player') {
    const result=preview(state,request,issuerId,true); check(result.ok,result.reason);
    const m=currentMission(state,request.vesselId); m.pendingOrders={kind:'replace',instructions:result.accepted}; m.revision++; recordTransition(state,m,'UPDATED');
  }
  function recall(state,request,issuerId='player') {
    fields(request,['vesselId','revision']); const m=currentMission(state,request.vesselId);
    check(!!m && m.revision===request.revision,'orders changed; refresh before recall');
    check(!access.commandReason(state,request.vesselId,issuerId),access.commandReason(state,request.vesselId,issuerId));
    m.pendingOrders={kind:'recall',instructions:null}; m.revision++; recordTransition(state,m,'RECALLED');
  }
  function report(m,state) {
    if (!m) return null;
    const o=m.objectives[m.objectiveIndex];
    return {id:m.id,name:m.name,phase:m.phase,homeLocationId:m.homeLocationId,objectiveIndex:m.objectiveIndex,revision:m.revision,outcome:{...m.outcome},
      instructionRevision:m.instructionRevision,currentRevisionOutcome:{...m.outcome},lifetimeOutcome:{...m.lifetimeOutcome},
      pending:!!m.pendingOrders,destinationId:m.phase==='RETURNING' ? m.homeLocationId:o?.destinationId ?? null, action:o?.action ?? null,actionVersion:o?.actionVersion ?? null,
      progressText:o ? catalog.resolve(o.action,o.actionVersion).report?.(o,m.progress,state,m) ?? '' : m.objectives.map(objective=>catalog.resolve(objective.action,objective.actionVersion).report?.(objective,null,state,m,m.objectiveOutcomes.find(r=>r.objectiveId===objective.id))??'').filter(Boolean).join('; ')};
  }
  return Object.freeze({catalog,preview,assign,update,recall,current:currentMission,report,getDestinations:state=>transport.destinations(state),
    getMissionActionAuthoringContracts:catalog.authoringContracts,
    lifecycle:{id:'missions',initialize:state=>{state.missions=emptyMissions();},reconcile:(state,context)=>{if(!Object.hasOwn(state,'missions'))state.missions=emptyMissions();if(context.migrateMissionResults)migrateMissionResults(state);},validate:state=>validateMissions(state,catalog)},
    collectReferences:state=>missionReferences(state,catalog,reference),
    definitionReferences:()=>Object.entries(catalog.definitions).flatMap(([id,d])=>[
      ...(d.homeLocationId?[reference(`missionDefinitions.${id}.homeLocationId`,d.homeLocationId,'historyLocation')]:[]),
      ...d.objectives.flatMap((o,i)=>[reference(`missionDefinitions.${id}.objectives.${i}.destinationId`,o.destinationId,'historyLocation'),
        ...(catalog.resolve(o.action,o.actionVersion).references?.(o,null,`missionDefinitions.${id}.objectives.${i}`,reference) ?? [])])]),
    simulationStep:{id:'missions',advance:state=>advanceMissions(state,catalog,transport,recordTransition,clock)},
    commands:[
      {id:'assignMission',name:'Assign drone mission',scope:'global',group:'vesselCommands',permissions:[],requirement:(state,_ctx,r)=>preview(state,r).reason ?? '',execute:(state,_ctx,r)=>`Mission ${assign(state,r)} accepted.`},
      {id:'updateMission',name:'Update drone orders',scope:'global',group:'vesselCommands',permissions:[],requirement:(state,_ctx,r)=>preview(state,r,'player',true).reason ?? '',execute:(state,_ctx,r)=>{update(state,r);return 'New orders accepted; current travel/work will finish first.';}},
      {id:'recallMission',name:'Return drone home',scope:'global',group:'vesselCommands',permissions:[],requirement:(state,_ctx,r)=>{const m=currentMission(state,r?.vesselId);return access.commandReason(state,r?.vesselId,'player') || (!m || m.revision!==r?.revision ? 'Refresh mission before recall.':'');},execute:(state,_ctx,r)=>{recall(state,r);return 'Return order accepted; current travel/work will finish first.';}}
    ]});
}
