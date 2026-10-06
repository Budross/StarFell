import { check, fields } from '../../missions/missionCatalog.js';

export function createExtractResourceMissionAction({compileQuantity,validateQuantity,candidates,candidatesAt,availableEquipment,previewStartProcess,startProcess,getRun,readCompletionResult,
  readQuantity,readWorkFailure,previewOutput,formatQuantity,projectWork,cancelWork,readBuffered}) {
  function choices(state,destinationId) { return state ? candidatesAt(state,destinationId) : candidates.filter(c=>c.destinationId===destinationId); }
  function choice(o,state) { return choices(state,o.destinationId).find(c=>c.nodeId===o.parameters.nodeId && c.resourceId===o.parameters.resourceId && c.processId===o.parameters.processId); }
  function request(state,o,m) {
    const c=choice(o,state); if(!c) return null;
    const equipment=c.equipmentIds.filter(id=>(!o.parameters.equipmentId || id===o.parameters.equipmentId) && availableEquipment(state,m.vesselId,id)).sort();
    return equipment.map(equipmentId=>({hostId:m.vesselId,equipmentId,processId:c.processId,sourceLocationId:o.destinationId,nodeId:c.nodeId}))
      .find(r=>previewStartProcess(state,r,m.issuerId).ok) ?? {hostId:m.vesselId,equipmentId:o.parameters.equipmentId ?? equipment[0] ?? c.equipmentIds[0],processId:c.processId,sourceLocationId:o.destinationId,nodeId:c.nodeId};
  }
  function credit(state,o,p,m) {
    if(p.runId===null)return null;
    const run=getRun(state,p.runId);
    if(run?.phase==='delivery' || readCompletionResult(state,p.runId)) { p.acquiredQuantity+=p.expectedQuantity; p.runId=null; p.expectedQuantity=0; return null; }
    if(!run)return {status:'BLOCKED',reason:'Referenced extraction batch did not complete.',partial:p.acquiredQuantity>0};
    const failed=readWorkFailure(state,p.runId);
    if (failed) {
      const disposition=cancelWork(state,p.runId,m.vesselId,m.issuerId);
      if(disposition.status!=='CANCELLED')return {status:'WAITING',reason:disposition.reason};
      p.runId=null;p.expectedQuantity=0;
      return {status:'BLOCKED',reason:failed,partial:p.acquiredQuantity>0};
    }
    return {status:'WAITING'};
  }
  return {id:'extractResource',semanticVersion:1,authoring:{label:'Extract resource',
    parameters:{resourceId:{type:'reference',required:true,catalog:'resources'},nodeId:{type:'reference',required:true,catalog:'nodes',destinationScoped:true},quantity:{type:'quantity',required:true,itemField:'resourceId'},processId:{type:'reference',required:false,catalog:'processes'},equipmentId:{type:'reference',required:false,catalog:'equipment'}},
    catalogs:{nodes:candidates.map(c=>({id:c.nodeId,name:c.nodeId,destinationId:c.destinationId,resourceId:c.resourceId})),resources:[...new Map(candidates.map(c=>[c.resourceId,{id:c.resourceId,name:c.resourceName}])).values()],processes:[...new Map(candidates.map(c=>[c.processId,{id:c.processId,name:c.processName ?? c.processId}])).values()],equipment:[...new Map(candidates.flatMap(c=>c.equipmentIds.map(id=>[id,{id,name:c.equipmentNames?.[id] ?? id}]))).values()]}},
    compileParameters(raw,destinationId,state) {
      fields(raw,['resourceId','nodeId','quantity','processId','equipmentId']);
      const c=choices(state,destinationId).find(c=>c.resourceId===raw.resourceId && c.nodeId===raw.nodeId && (!raw.processId || c.processId===raw.processId) && (!raw.equipmentId || c.equipmentIds.includes(raw.equipmentId)));
      if(!c)throw Object.assign(new Error('Mission: no compatible resource/node/process.'),{reference:{catalog:'locations',id:destinationId,field:'resourceNodes'}});
      const quantity=compileQuantity(raw.quantity,raw.resourceId);
      check(quantity>0,'quantity must be positive');
      const normalized=Math.ceil(quantity/c.batchAmount)*c.batchAmount; check(Number.isSafeInteger(normalized),'quantity overflow');
      return {resourceId:raw.resourceId,nodeId:raw.nodeId,quantity:normalized,processId:c.processId,...(raw.equipmentId?{equipmentId:raw.equipmentId}:{})};
    },
    validate(o,p,state) {
      fields(o.parameters,['resourceId','nodeId','quantity','processId','equipmentId']);
      check(['resourceId','nodeId','processId'].every(k=>typeof o.parameters[k]==='string') && (o.parameters.equipmentId===undefined || typeof o.parameters.equipmentId==='string'),'invalid extraction references');
      validateQuantity(o.parameters.quantity,o.parameters.resourceId); check(o.parameters.quantity>0,'quantity must be positive');
      if(state)check(!!choice(o,state),'no compatible concrete runtime resource/node/process');
      if(p!==null) { fields(p,['baselineQuantity','acquiredQuantity','runId','expectedQuantity']); check(['baselineQuantity','acquiredQuantity','expectedQuantity'].every(k=>Number.isSafeInteger(p[k]) && p[k]>=0) && (p.runId===null || Number.isSafeInteger(p.runId) && p.runId>0) && (p.runId===null ? p.expectedQuantity===0:p.expectedQuantity>0),'invalid extraction progress'); }
    },
    activate:(s,o,m)=>({baselineQuantity:readQuantity(s,m.vesselId,o.parameters.resourceId),acquiredQuantity:0,runId:null,expectedQuantity:0}),
    preview(plan,o,m) {
      const r=request(plan,o,m); if(!r)return {ok:false,reason:'Extraction process/source unavailable.'};
      const c=choice(o,plan),result=projectWork(plan,r,m.issuerId,{batches:o.parameters.quantity/c.batchAmount});
      if(result.ok)Object.assign(plan,result.state);
      return result;
    },
    advance(state,o,p,m) {
      const pending=credit(state,o,p,m); if(pending)return pending;
      if(p.acquiredQuantity>=o.parameters.quantity)return {status:'COMPLETE'};
      const r=request(state,o,m); if(!r)return {status:'BLOCKED',reason:'Extraction process/source unavailable.',partial:p.acquiredQuantity>0};
      const preview=previewStartProcess(state,r,m.issuerId);
      if(!preview.ok) { if(preview.canWaitForPower)return {status:'WAITING'}; return {status:'BLOCKED',reason:preview.reason,partial:p.acquiredQuantity>0}; }
      if((o.parameters.quantity-p.acquiredQuantity)%preview.contract.sourceAmount!==0)return {status:'BLOCKED',reason:'Remaining quantity no longer matches the available batch size.',partial:p.acquiredQuantity>0};
      const output=previewOutput(state,m.vesselId,o.parameters.resourceId,preview.contract.sourceAmount); if(!output.ok)return {status:'BLOCKED',reason:output.reason,partial:p.acquiredQuantity>0};
      p.runId=startProcess(state,r,m.issuerId); p.expectedQuantity=preview.contract.sourceAmount; return {status:'ACTION'};
    },
    safeToReplace(state,o,p,m) { const result=credit(state,o,p,m); return {ready:result?.status!=='WAITING',useful:p.acquiredQuantity>0,complete:p.acquiredQuantity>=o.parameters.quantity}; },
    projectPendingWork(plan,o,p,m) {
      const run=p?.runId && getRun(plan,p.runId); if(!run || run.phase!=='working')return;
      const result=projectWork(plan,null,m.issuerId,{runId:run.id});
      check(result.ok,result.reason);Object.assign(plan,result.state);
    },
    report(o,p,state,m,result) {
      const item=o.parameters.resourceId,amount=p?.acquiredQuantity ?? (result?.status==='COMPLETE'?o.parameters.quantity:0),buffer=state&&m?readBuffered(state,m.vesselId,item):{amount:0,runIds:[]};
      const resourceName=choice(o)?.resourceName ?? candidates.find(c=>c.resourceId===item)?.resourceName ?? item;
      return `Mined ${formatQuantity(amount,item)} / requested ${formatQuantity(o.parameters.quantity,item)} ${resourceName}${state&&m?`; current cargo ${formatQuantity(readQuantity(state,m.vesselId,item),item)}`:''}${buffer.amount?`; buffered in machine ${formatQuantity(buffer.amount,item)} (Processing batch ${buffer.runIds.join(', ')}). Use berth transfers to make cargo room; Processing unloads the buffer automatically.`:''}`;
    }
  };
}
