import { canUse, permissionReason } from './authority.js';
import { isOperational } from './equipment.js';
import { getLocationContext } from './locations.js';
import { locationDefinition } from './entityQueries.js';
import { conditionReason } from './conditionContext.js';
import { previewExchange, transfer, quantity } from './resources.js';
import { record, validId } from './conditions.js';
import { validateQuantity, quantityKind, checkedAdd } from './quantities.js';
import { entityReference } from './entityReferences.js';

export const createProcessingState = () => ({ nextRunId: 1, runs: {} });
export const processingRuns = state => Object.values(state.processing.runs).sort((a,b) => a.id - b.id);
export const amountMap = lines => Object.fromEntries(lines.map(l => [l.itemId, l.amount]));
const active = (state, id) => state.entities[id]?.lifecycle === 'active';
export function extractionAccess(state, hostId, sourceId) {
  const host = state.locations[hostId], source = state.locations[sourceId];
  return active(state, hostId) && active(state, sourceId) && state.entities[sourceId]?.type === 'site' && !!host && !!source &&
    (hostId === sourceId || state.entities[hostId]?.type === 'ship' && !host.journey && host.dockedAtId === sourceId && host.areaId === source.areaId);
}
export function claimedReserve(state, sourceId, nodeId) {
  return processingRuns(state).filter(r => r.kind === 'extraction' && r.phase === 'working' && r.sourceLocationId === sourceId && r.nodeId === nodeId)
    .reduce((sum,r) => checkedAdd(sum,r.sourceClaim), 0);
}
export function positiveInitialWork(work, rate, power) {
  if (rate === 0) return true;
  const possible = Math.min(work, power / rate), debit = possible * rate;
  return Number.isFinite(possible) && possible > 0 && debit > 0 && debit <= power && work - possible < work && power - debit < power;
}
export function previewStartProcess(state, request, services, actorId = 'player') {
  let parameters = {};
  try {
    if (!record(request) || Object.keys(request).some(k => !['hostId','equipmentId','processId','sourceLocationId','nodeId'].includes(k))) throw new Error('Choose a machine and process.');
    const { content, world, catalog } = services, { hostId, equipmentId, processId } = request;
    const def = catalog.definitions[processId];
    if (!def || !active(state,hostId) || !def.hostKinds.includes(state.entities[hostId]?.type)) throw new Error('Host or process unavailable.');
    const ctx = getLocationContext(state, content, world, hostId, actorId), machine = content.infrastructure[equipmentId];
    if (!machine?.capabilities.includes(def.capability)) throw new Error('Required machine is unavailable.');
    const workTotal = def.duration / (machine.processing?.speedMultiplier ?? 1), powerRate = def.powerRate * (machine.processing?.powerMultiplier ?? 1);
    if (!Number.isFinite(workTotal) || workTotal <= 0 || !Number.isFinite(powerRate) || powerRate < 0) throw new Error('Invalid effective processing parameters.');
    parameters = { workTotal,powerRate };
    if (!isOperational(ctx.store.infrastructure,equipmentId)) throw new Error('Required machine is unavailable.');
    if (processingRuns(state).filter(r => r.hostId === hostId && r.equipmentId === equipmentId).length >= ctx.store.infrastructure[equipmentId].quantity) throw new Error('Machine occupied. Unload or abort its batch first.');
    for (const p of ['useFacilities','depositCargo', ...(def.kind === 'refining' ? ['withdrawCargo'] : [])]) {
      const reason = permissionReason(state,actorId,hostId,p); if (reason) throw new Error(reason);
    }
    const condition = conditionReason(ctx.actionState,def.startConditions,content); if (condition) throw new Error(condition);
    let committedInputs = [], pendingOutputs, source = {};
    if (def.kind === 'refining') {
      if (request.sourceLocationId !== undefined || request.nodeId !== undefined) throw new Error('Refining needs no source.');
      committedInputs = def.inputs; pendingOutputs = def.outputs;
      const input = previewExchange(ctx.store,amountMap(committedInputs),{},content); if (!input.ok) throw new Error(input.reason);
    } else {
      const { sourceLocationId, nodeId } = request;
      const nodeDef = locationDefinition(state,world,sourceLocationId)?.resourceNodes?.[nodeId], node = state.locations[sourceLocationId]?.resourceNodes?.[nodeId];
      if (!extractionAccess(state,hostId,sourceLocationId) || !nodeDef || !node || !def.sourceRequirements.tags.every(t => nodeDef.tags.includes(t))) throw new Error('Compatible extraction source unavailable.');
      const reason = permissionReason(state,actorId,sourceLocationId,'useFacilities'); if (reason) throw new Error(reason);
      if (node.remaining - claimedReserve(state,sourceLocationId,nodeId) < def.batchAmount) throw new Error('Source depleted or already claimed.');
      source = { sourceLocationId, nodeId, sourceAmount: def.batchAmount, sourceClaim: def.batchAmount };
      pendingOutputs = [{ itemId: node.resourceId, amount: def.batchAmount }];
    }
    if (!positiveInitialWork(workTotal,powerRate,quantity(ctx.store,'power',content))) throw new Error('Cannot start — insufficient power.');
    if (!Number.isSafeInteger(state.processing.nextRunId) || state.processing.nextRunId >= Number.MAX_SAFE_INTEGER) throw new Error('Process run IDs exhausted.');
    const output = previewExchange(ctx.store,amountMap(committedInputs),amountMap(pendingOutputs),content);
    return { ok: true, reason: '', ...parameters, warning: output.ok ? '' : 'Finished output will wait inside the machine if storage remains full.',
      contract: { processId, kind: def.kind, hostId, equipmentId, requiredCapability: def.capability, initiatorId: actorId,
        startedAt: state.simulationTime, phase: 'working', blockedReason: null, workTotal, workRemaining: workTotal, powerRate,
        committedInputs: structuredClone(committedInputs), pendingOutputs: structuredClone(pendingOutputs), ...source } };
  } catch (error) { return { ok: false, reason: error.message, ...parameters }; }
}
export function recordProcess(state, run, type, services, extra = {}, actorId = run.hostId) {
  const line = l => ({ ...l, quantityKind: quantityKind(l.itemId,services.content) });
  const data = { runId: run.id, processId: run.processId, kind: run.kind, equipmentId: run.equipmentId,
    ...(run.kind === 'extraction' ? { sourceLocationId: run.sourceLocationId, nodeId: run.nodeId, sourceAmount: run.sourceAmount } : {}), ...extra };
  for (const k of ['inputs','outputs','lostInputs','lostOutputs']) if (data[k]) data[k] = data[k].map(line);
  services.ledgerServices.append(state,{ type, actorId, targetId: type === 'RESOURCE_NODE_DEPLETED' ? run.sourceLocationId : run.hostId, locationId: run.hostId,
    areaId: state.locations[run.hostId]?.areaId ?? state.entities[run.hostId]?.retained?.location.areaId ?? null, data });
}
export function startProcess(state, request, services, actorId = 'player') {
  const preview = previewStartProcess(state,request,services,actorId); if (!preview.ok) throw new Error(preview.reason);
  const run = { id: state.processing.nextRunId, ...preview.contract };
  transfer(getLocationContext(state,services.content,services.world,run.hostId,actorId).store,amountMap(run.committedInputs),{},services.content);
  state.processing.runs[run.id] = run; state.processing.nextRunId++;
  recordProcess(state,run,'PROCESS_STARTED',services,{ inputs: run.committedInputs },actorId);
  return run.id;
}
export function previewAbortProcess(state, runId, services, actorId = 'player') {
  if (!Number.isSafeInteger(runId) || runId < 1) return { ok: false, reason: 'Invalid process run ID.' };
  const run = state.processing.runs[runId];
  if (!run) return { ok: false, reason: 'Process run unavailable.' };
  const ok = canUse(state,actorId,run.hostId,'manageEquipment') || run.initiatorId === actorId && canUse(state,actorId,run.hostId,'useFacilities');
  return { ok, reason: ok ? '' : 'Requires current facility access for your own batch, or equipment management.', phase: run.phase,
    lostInputs: run.phase === 'working' && run.kind === 'refining' ? run.committedInputs : [], lostOutputs: run.phase === 'delivery' ? run.pendingOutputs : [] };
}
function removeRun(state, run, services, actorId, reason) {
  recordProcess(state,run,'PROCESS_ABORTED',services,{ phase: run.phase, reason,
    lostInputs: run.phase === 'working' && run.kind === 'refining' ? run.committedInputs : [], lostOutputs: run.phase === 'delivery' ? run.pendingOutputs : [] },actorId);
  delete state.processing.runs[run.id];
}
export function abortProcess(state, runId, services, actorId = 'player', reviewedPhase) {
  const preview = previewAbortProcess(state,runId,services,actorId); if (!preview.ok) throw new Error(preview.reason);
  if (reviewedPhase !== undefined && reviewedPhase !== preview.phase) throw new Error('Batch changed. Review the finished material before discarding it.');
  removeRun(state,state.processing.runs[runId],services,actorId,'manual');
}
export function abortHostedRuns(state, hostId, services, actorId = null) {
  for (const run of processingRuns(state).filter(r => r.hostId === hostId)) removeRun(state,run,services,actorId,'host_terminal');
}
export function setProcessBlock(state, run, reason, services, progressed = false) {
  const previous = run.blockedReason;
  run.blockedReason = reason;
  if (!previous && reason) recordProcess(state,run,'PROCESS_BLOCKED',services,{ phase: run.phase, reasonCode: reason });
  else if (previous && !reason && progressed && run.phase === 'working') recordProcess(state,run,'PROCESS_RESUMED',services,{ previousReasonCode: previous });
}
export function workingBlocker(state, run, services, rank) {
  if (!active(state,run.hostId)) return 'HOST_INACTIVE';
  const machine = state.locations[run.hostId].infrastructure[run.equipmentId];
  if (!isOperational(state.locations[run.hostId].infrastructure,run.equipmentId) || !services.content.infrastructure[run.equipmentId]?.capabilities.includes(run.requiredCapability) || rank >= machine.quantity) return 'EQUIPMENT_UNAVAILABLE';
  if (run.kind === 'extraction' && (!extractionAccess(state,run.hostId,run.sourceLocationId) || !state.locations[run.sourceLocationId]?.resourceNodes?.[run.nodeId])) return 'SOURCE_UNAVAILABLE';
  return null;
}
export function finishWork(state, run, services) {
  if (run.kind === 'extraction') {
    const node = state.locations[run.sourceLocationId].resourceNodes[run.nodeId];
    if (node.remaining < run.sourceAmount || run.sourceClaim !== run.sourceAmount) throw new Error('Extraction claim invalid.');
    node.remaining -= run.sourceAmount; run.sourceClaim = 0;
    if (node.remaining === 0) recordProcess(state,run,'RESOURCE_NODE_DEPLETED',services,{ resourceId: node.resourceId, amount: run.sourceAmount, quantityKind: 'bulk' });
  }
  run.workRemaining = 0; run.phase = 'delivery';
  // Working blockers cannot survive into the finished-material phase. Preserve
  // blocked overlay when delivery remains blocked, without a spurious resume.
  if (run.blockedReason) run.blockedReason = 'OUTPUT_FULL';
  return { type: 'PROCESS_PHASE_CHANGED', hostId: run.hostId, equipmentId: run.equipmentId,
    runId: run.id, fromPhase: 'working', toPhase: 'delivery', time: state.simulationTime,
    ...(run.kind === 'extraction' ? { sourceLocationId: run.sourceLocationId, nodeId: run.nodeId } : {}) };
}
export function deliverOutput(state, run, services) {
  if (!active(state,run.hostId)) { setProcessBlock(state,run,'HOST_INACTIVE',services); return false; }
  const store = getLocationContext(state,services.content,services.world,run.hostId).store;
  const preview = previewExchange(store,{},amountMap(run.pendingOutputs),services.content);
  if (!preview.ok) { if (!['cargoFull','overflow'].includes(preview.code)) throw new Error(preview.reason); setProcessBlock(state,run,'OUTPUT_FULL',services); return false; }
  Object.assign(store.resources,preview.resources);
  recordProcess(state,run,'PROCESS_COMPLETED',services,{ inputs: run.committedInputs, outputs: run.pendingOutputs });
  delete state.processing.runs[run.id]; return true;
}
export function reconcileProcessingNodes(state, content, world) {
  for (const [id, local] of Object.entries(state.locations)) {
    const def = locationDefinition(state,world,id); if (!def) continue;
    if (local.resourceNodes === undefined) local.resourceNodes = {};
    if (!record(local.resourceNodes)) throw new Error('Invalid resource nodes.');
    for (const [nodeId, node] of Object.entries(def.resourceNodes ?? {})) if (!Object.hasOwn(local.resourceNodes,nodeId)) local.resourceNodes[nodeId] = { resourceId: node.resourceId, remaining: node.initialReserve };
  }
}
export function validateProcessingState(state, content, world) {
  const fail = () => { throw new Error('Invalid processing state.'); };
  const p = state.processing;
  if (!record(p) || Object.keys(p).some(k => !['nextRunId','runs'].includes(k)) || !Number.isSafeInteger(p.nextRunId) || p.nextRunId < 1 || !record(p.runs)) fail();
  for (const [id,local] of Object.entries(state.locations)) {
    const def = locationDefinition(state,world,id);
    if (!record(local.resourceNodes)) fail();
    for (const [nodeId,node] of Object.entries(local.resourceNodes)) {
      const authored = def?.resourceNodes?.[nodeId], terminal = ['retired','destroyed'].includes(state.entities[id]?.lifecycle);
      if (!record(node) || Object.keys(node).some(k => !['resourceId','remaining'].includes(k)) || content.items[node.resourceId]?.category !== 'resource' || !Number.isSafeInteger(node.remaining) || node.remaining < 0 || (authored ? authored.resourceId !== node.resourceId : !terminal)) fail();
    }
    if (Object.keys(def?.resourceNodes ?? {}).some(n => !Object.hasOwn(local.resourceNodes,n))) fail();
  }
  const claims = new Map();
  for (const [key,r] of Object.entries(p.runs)) {
    const common = ['id','processId','kind','hostId','equipmentId','requiredCapability','initiatorId','startedAt','phase','blockedReason','workTotal','workRemaining','powerRate','committedInputs','pendingOutputs'];
    const allowed = [...common,...(r?.kind === 'extraction' ? ['sourceLocationId','nodeId','sourceAmount','sourceClaim'] : [])];
    if (!record(r) || Object.keys(r).some(k => !allowed.includes(k)) || allowed.some(k => !Object.hasOwn(r,k)) || String(r.id) !== key || !Number.isSafeInteger(r.id) || r.id < 1 || r.id >= p.nextRunId || !validId(r.processId) || !validId(r.requiredCapability) || !content.infrastructure[r.equipmentId] || !['site','ship'].includes(state.entities[r.hostId]?.type) || ['retired','destroyed'].includes(state.entities[r.hostId]?.lifecycle) || !['npc','principal'].includes(state.entities[r.initiatorId]?.type) || !['extraction','refining'].includes(r.kind)) fail();
    if (!Number.isFinite(r.startedAt) || r.startedAt < 0 || r.startedAt > state.simulationTime || !Number.isFinite(r.workTotal) || r.workTotal <= 0 || !Number.isFinite(r.workRemaining) || r.workRemaining < 0 || r.workRemaining > r.workTotal || !Number.isFinite(r.powerRate) || r.powerRate < 0 || !['working','delivery'].includes(r.phase) || (r.phase === 'working' ? r.workRemaining <= 0 : r.workRemaining !== 0)) fail();
    if (r.blockedReason !== null && !(r.phase === 'working' ? ['HOST_INACTIVE','EQUIPMENT_UNAVAILABLE','SOURCE_UNAVAILABLE','NO_POWER'] : ['HOST_INACTIVE','OUTPUT_FULL']).includes(r.blockedReason) || r.kind === 'refining' && r.blockedReason === 'SOURCE_UNAVAILABLE') fail();
    for (const lines of [r.committedInputs,r.pendingOutputs]) {
      if (!Array.isArray(lines) || lines.length > 8 || new Set(lines.map(l => l?.itemId)).size !== lines.length) fail();
      for (const l of lines) { if (!record(l) || Object.keys(l).length !== 2 || !['resource','component'].includes(content.items[l.itemId]?.category) || !Number.isSafeInteger(l.amount) || l.amount <= 0) fail(); validateQuantity(l.amount,l.itemId,content); }
    }
    if (!r.pendingOutputs.length || r.kind === 'refining' && !r.committedInputs.length) fail();
    if (r.kind === 'extraction') {
      if (r.committedInputs.length || !Number.isSafeInteger(r.sourceAmount) || r.sourceAmount <= 0 || r.sourceClaim !== (r.phase === 'working' ? r.sourceAmount : 0) || !validId(r.nodeId) || state.entities[r.sourceLocationId]?.type !== 'site' || r.pendingOutputs.length !== 1 || content.items[r.pendingOutputs[0].itemId]?.category !== 'resource' || r.pendingOutputs[0].amount !== r.sourceAmount) fail();
      if (r.phase === 'working') {
        const n = state.locations[r.sourceLocationId]?.resourceNodes?.[r.nodeId];
        if (!n || n.resourceId !== r.pendingOutputs[0].itemId) fail();
        const k = `${r.sourceLocationId}/${r.nodeId}`, total = checkedAdd(claims.get(k) ?? 0,r.sourceClaim); claims.set(k,total); if (total > n.remaining) fail();
      }
    }
  }
}
export function collectProcessingReferences(state) {
  return Object.values(state.processing?.runs ?? {}).flatMap(r => [entityReference(`processing.${r.id}.host`,r.hostId,'historyLocation'),
    entityReference(`processing.${r.id}.initiator`,r.initiatorId,'principal'), ...(r.kind === 'extraction' ? [entityReference(`processing.${r.id}.source`,r.sourceLocationId,'historyLocation')] : [])]);
}
