import { equipmentCapabilityTypes } from '../../equipmentCatalog.js';
import { calculateProcessingReadiness } from '../../processingQuery.js';
import { fact } from '../narrativeFacts.js';
import { canObserve,historyAge } from '../narrativeContext.js';
export function processingFactProvider(services) {
  const group=(scope,id)=>({type:'equipment_group',hostId:scope.locationId,equipmentId:id});
  return {id:'processing',provide(state,scope) {
    const attached=Object.values(state.processing.runs).filter(r=>r.hostId===scope.locationId);
    const groups=Object.entries(state.locations[scope.locationId].infrastructure).filter(([id,m])=>
      (m.quantity>0 && services.catalog.byCapability && equipmentCapabilityTypes(services.content,id).some(c=>services.catalog.byCapability[c]) || attached.some(r=>r.equipmentId===id)) && (!scope.equipmentId || id===scope.equipmentId));
    if (!scope.facilities && !groups.some(([id])=>canObserve(scope,'industrial_activity',services.content.infrastructure[id].narrative))) return [];
    const plan=calculateProcessingReadiness(state,services),facts=[];
    for (const [id,machine] of groups) {
      const def=services.content.infrastructure[id],runs=plan.runs.filter(r=>r.hostId===scope.locationId && r.equipmentId===id);
      if (!scope.facilities && !canObserve(scope,'industrial_activity',def.narrative)) continue;
      const data={equipmentId:id,name:def.name,activity:runs.some(r=>r.phase==='working' && r.speed>0)?'working':runs.length?'waiting':'idle'};
      if (scope.facilities) Object.assign(data,{quantity:machine.quantity,attachedRuns:runs.length,workingCount:runs.filter(r=>r.phase==='working' && r.speed===1).length,powerLimitedCount:runs.filter(r=>r.phase==='working' && r.blocker==='NO_POWER').length,deliveryCount:runs.filter(r=>r.phase==='delivery').length,freeSlots:Math.max(0,machine.quantity-runs.length)});
      facts.push(fact('processing','equipment_activity',group(scope,id),data,scope,{exposure:scope.facilities?'facility_detail':'coarse_local',importance:.45}));
      if (!scope.facilities) continue;
      for (const read of runs) {
        const run=state.processing.runs[read.runId];
        const data={runId:run.id,processId:run.processId,processName:services.catalog.definitions[run.processId]?.name ?? 'Industrial process',equipmentId:id,equipmentName:def.name,phase:read.phase,blocker:read.blocker,
          workState:read.phase==='delivery'?'delivery':read.speed===1?'working':read.speed>0?'power_limited':read.blocker==='NO_POWER'?'no_power':'blocked'};
        if (scope.cargo) data.pendingOutputs=structuredClone(run.pendingOutputs);
        facts.push(fact('processing','process_activity',{type:'process_run',hostId:scope.locationId,equipmentId:id,runId:run.id},data,scope,{exposure:'facility_detail',importance:.7,severity:read.blocker ? .8 : 0}));
      }
    }
    return facts;
  },interpret(entry,scope) {
    if (!entry.type.startsWith('PROCESS_') || entry.locationId!==scope.locationId || !scope.facilities || scope.equipmentId && scope.equipmentId!==entry.data.equipmentId) return [];
    // Completion entails delivery. Work-finished phase hints are never interpreted as history.
    const outcomes={PROCESS_STARTED:'started',PROCESS_BLOCKED:'blocked',PROCESS_RESUMED:'resumed',PROCESS_COMPLETED:'completed',PROCESS_ABORTED:'aborted'};
    const outcome=outcomes[entry.type]; if (!outcome) return [];
    const data={eventType:entry.type,runId:entry.data.runId,equipmentId:entry.data.equipmentId,name:services.content.infrastructure[entry.data.equipmentId]?.name ?? 'Industrial equipment',outcome,ageBand:historyAge(scope,entry.time)};
    return [fact('processing','recent_process_activity',group(scope,entry.data.equipmentId),data,scope,{basis:'history',event:entry,exposure:'facility_detail',importance:outcome==='completed'?.75:entry.importance})];
  }};
}
