import { definitionHasCapability } from './equipmentCatalog.js';
import { powerRate } from './game.js';
import { capacity, previewExchange } from './resources.js';
import { processingRuns, workingBlocker, amountMap,previewStartProcess,positiveInitialWork } from './processing.js';
import { locationDefinition } from './entityQueries.js';

export function processingStartReadiness(state,request,services,actorId='player') {
  const preview=previewStartProcess(state,request,services,actorId);
  if(preview.ok||preview.code!=='POWER')return {...preview,canWaitForPower:false};
  const host=calculateProcessingReadiness(state,services).hosts.find(h=>h.hostId===request.hostId);
  return {...preview,canWaitForPower:!!host&&host.generation>0&&host.capacity>host.power&&positiveInitialWork(preview.workTotal,preview.powerRate,host.capacity)};
}
export function processingWorkFailure(state,runId,services) {
  const plan=calculateProcessingReadiness(state,services),entry=plan.runs.find(r=>r.runId===runId);
  if(!entry||!entry.blocker)return null;
  if(entry.blocker!=='NO_POWER')return entry.blocker;
  const host=plan.hosts.find(h=>h.hostId===entry.hostId);
  return host.generation<=0&&host.power<=0?'Extraction cannot recharge.':null;
}

export function extractionCandidates(definition, services) {
  if (!definition || definition.kind !== 'site' || definition.mobile) return [];
  return Object.entries(definition.resourceNodes ?? {}).flatMap(([nodeId,node]) =>
    Object.values(services.catalog.definitions).filter(p => p.kind === 'extraction' && p.hostKinds.includes('ship') && p.sourceRequirements.tags.every(t => node.tags.includes(t)))
      .map(p => ({ destinationId: definition.id, nodeId, resourceId: node.resourceId, resourceName: services.content.items[node.resourceId].name,
        processId: p.id, processName: p.name, batchAmount: p.batchAmount,
        equipmentIds: Object.entries(services.content.infrastructure).filter(([id]) => definitionHasCapability(services.content,id,p.capability)).map(([id]) => id),
        equipmentNames: Object.fromEntries(Object.entries(services.content.infrastructure).filter(([id]) => definitionHasCapability(services.content,id,p.capability)).map(([id,e]) => [id,e.name])) })));
}
export function runtimeExtractionCandidates(state, locationId, services) {
  if (state.entities[locationId]?.lifecycle !== 'active') return [];
  return extractionCandidates(locationDefinition(state,services.world,locationId),services)
    .filter(c => state.locations[locationId]?.resourceNodes?.[c.nodeId]?.resourceId === c.resourceId)
    .map(c => ({ ...c, destinationId: locationId }));
}
export function bufferedOutputObservation(state,hostId,itemId) {
  const runs=processingRuns(state).filter(r=>r.hostId===hostId&&r.phase==='delivery'&&r.pendingOutputs.some(l=>l.itemId===itemId));
  return {amount:runs.reduce((n,r)=>n+r.pendingOutputs.filter(l=>l.itemId===itemId).reduce((sum,l)=>sum+l.amount,0),0),runIds:runs.map(r=>r.id)};
}

// The single instantaneous allocation calculation. Both simulation and read
// projections consume this result. No delivery, work, blockers or RNG mutate.
export function calculateProcessingReadiness(state, services) {
  const hosts = new Map(), stores = new Map(), ranks = new Map(), runs = [], deliveries = new Map();
  for (const id of Object.keys(state.locations)) {
    if (state.entities[id].lifecycle !== 'active') continue;
    const ctx = services.contextFor(state, id);
    stores.set(id,ctx.store);
    hosts.set(id, { hostId: id, generation: powerRate(ctx.store, services.content),
      capacity: capacity(ctx.store, 'power', services.content), power: ctx.store.resources.power,
      runs: [], demand: 0 });
  }
  const ordered=processingRuns(state);
  // Plan immediate deliveries in the same run-ID order as simulation. Preview
  // resources are detached scratch values: cargo/IDs/ledger never mutate here.
  // A deliverable buffer releases its equipment slot before allocating work.
  for (const run of ordered) if (run.phase==='delivery') {
    const store=stores.get(run.hostId),preview=store && previewExchange(store,{},amountMap(run.pendingOutputs),services.content);
    const deliverable=!!preview?.ok;
    deliveries.set(run.id,{deliverable,blocker:!store?'HOST_INACTIVE':deliverable?null:'OUTPUT_FULL'});
    if (deliverable) stores.set(run.hostId,{...store,resources:preview.resources});
  }
  for (const run of ordered) {
    const key = JSON.stringify([run.hostId, run.equipmentId]);
    const rank = ranks.get(key) ?? 0;
    if (run.phase === 'delivery') {
      const delivery=deliveries.get(run.id);
      if (!delivery.deliverable) ranks.set(key,rank+1);
      runs.push({ runId: run.id, hostId: run.hostId, equipmentId: run.equipmentId, phase: run.phase, rank,...delivery,speed: 0 });
      continue;
    }
    ranks.set(key,rank+1);
    const blocker = workingBlocker(state, run, services, rank);
    const entry = { runId: run.id, hostId: run.hostId, equipmentId: run.equipmentId,
      phase: run.phase, rank, blocker, speed: blocker ? 0 : 1, powerRate: run.powerRate, access: !blocker };
    runs.push(entry);
    if (!blocker) hosts.get(run.hostId).runs.push(entry);
  }
  for (const host of hosts.values()) {
    let available = Math.max(0, host.generation);
    for (const entry of host.runs) {
      if (host.power <= 0 && entry.powerRate > 0) {
        entry.speed = Math.min(1, available / entry.powerRate);
        available = Math.max(0, available - entry.speed * entry.powerRate);
      }
      if (entry.speed < 1) entry.blocker = 'NO_POWER';
      host.demand += entry.speed * entry.powerRate;
    }
    const slope = host.generation - host.demand;
    host.slope = Math.abs(slope) <= 16 * Number.EPSILON * Math.max(1, Math.abs(host.generation), host.demand) ? 0 : slope;
  }
  return { hosts: [...hosts.values()], runs };
}

export function processingHostObservation(state, hostId, services, plan = calculateProcessingReadiness(state, services)) {
  return { host: plan.hosts.find(h => h.hostId === hostId) ?? null,
    runs: plan.runs.filter(r => r.hostId === hostId) };
}
