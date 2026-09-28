import { powerRate } from './game.js';
import { capacity, previewExchange } from './resources.js';
import { processingRuns, workingBlocker, amountMap } from './processing.js';

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
