import { advanceGame } from './game.js';
import { advanceJourneys } from './ships.js';
import { setProcessBlock, extractionAccess, finishWork, deliverOutput } from './processing.js';
import { calculateProcessingReadiness } from './processingQuery.js';
export { calculateProcessingReadiness as planIndustrialReadiness } from './processingQuery.js';

// Piecewise-linear battery/work integration: split at empty/full, completion,
// or arrival. No persistent clock, millisecond loop, or inner state clones.
export function advanceIndustrialInterval(state, elapsed, services, stats = {}) {
  return services.ledgerServices.withBatch(state,() => integrate(state,elapsed,services,stats));
}
function integrate(state, elapsed, services, stats) {
  if (!Number.isFinite(elapsed) || elapsed <= 0) return { saveRequested: false, arrivals: [], processingTransitions: [] };
  const contexts = new Map(), arrivals = [], processingTransitions = [];
  for (const id of Object.keys(state.locations)) if (state.entities[id].lifecycle === 'active') contexts.set(id,services.contextFor(state,id));
  let remaining = elapsed, saveRequested = false;
  Object.assign(stats,{ intervals: 0, runVisits: 0, acceptedGeneration: 0, energySpent: 0 });
  const plans = () => {
    const plan = calculateProcessingReadiness(state, { ...services, contextFor: (_state,id) => contexts.get(id) });
    for (const entry of plan.runs) if (entry.phase==='delivery') {
      const delivered=deliverOutput(state,state.processing.runs[entry.runId],services);
      if (delivered!==entry.deliverable) throw new Error('Processing delivery disagrees with its allocation plan.');
      saveRequested=delivered || saveRequested;
    }
    stats.runVisits += plan.runs.length;
    for (const entry of plan.runs) if (entry.phase === 'working' && entry.blocker && entry.blocker !== 'NO_POWER')
      setProcessBlock(state,state.processing.runs[entry.runId],entry.blocker,services);
    return new Map(plan.hosts.map(h => [h.hostId, { ...h, ctx: contexts.get(h.hostId), cap: h.capacity,
      runs: h.runs.map(e => ({ ...e, run: state.processing.runs[e.runId] })) }]));
  };
  while (remaining > 0) {
    const hosts = plans(); let interval = remaining;
    for (const local of Object.values(state.locations)) if (local.journey?.remaining > 0) interval = Math.min(interval,local.journey.remaining);
    for (const h of hosts.values()) {
      const power = h.ctx.store.resources.power, slope = h.slope;
      h.emptyAt = slope < 0 && power > 0 ? power/-slope : Infinity;
      h.fullAt = slope > 0 && power < h.cap ? (h.cap-power)/slope : Infinity;
      interval = Math.min(interval,h.emptyAt,h.fullAt);
      for (const e of h.runs) if (e.speed > 0) interval = Math.min(interval,e.run.workRemaining/e.speed);
    }
    if (!(interval > 0) || !Number.isFinite(interval)) throw new Error('Invalid industrial integration boundary.');
    stats.intervals++;
    for (const h of hosts.values()) {
      const before = h.ctx.store.resources.power;
      const after = interval === h.emptyAt ? 0 : interval === h.fullAt ? h.cap : Math.max(0,Math.min(h.cap,before+h.slope*interval));
      stats.energySpent += h.demand*interval;
      stats.acceptedGeneration += Math.max(0,after-before+h.demand*interval);
      h.ctx.store.resources.power = after;
    }
    state.simulationTime += interval;
    arrivals.push(...advanceJourneys(state,interval,services.world,services.ledgerServices));
    for (const h of hosts.values()) for (const e of h.runs) {
      const r = e.run;
      if (e.speed === 0) { setProcessBlock(state,r,'NO_POWER',services); continue; }
      if (!e.access || r.kind === 'extraction' && !extractionAccess(state,r.hostId,r.sourceLocationId)) { setProcessBlock(state,r,'SOURCE_UNAVAILABLE',services); continue; }
      setProcessBlock(state,r,e.speed < 1 ? 'NO_POWER' : null,services,true);
      r.workRemaining = Math.max(0,r.workRemaining-e.speed*interval);
      if (r.workRemaining <= 1e-9) {
        processingTransitions.push(finishWork(state,r,services)); saveRequested = true; deliverOutput(state,r,services);
      }
    }
    const next = remaining-interval;
    if (next === remaining) throw new Error('Industrial interval is too small to advance accurately.');
    remaining = Math.max(0,next);
  }
  for (const h of plans().values()) for (const e of h.runs) if (e.speed < 1) setProcessBlock(state,e.run,'NO_POWER',services);
  return { saveRequested: saveRequested || arrivals.length > 0, arrivals, processingTransitions };
}
export function industrialSimulationSteps(services) {
  const reports = new WeakMap();
  return [
    { id: 'power', advance(state,elapsed) {
      if (!Object.keys(state.processing.runs).length) return advanceGame(state,elapsed,services.content,services.contextFor);
      const result = advanceIndustrialInterval(state,elapsed,services); reports.set(state,result);
      return { saveRequested: result.saveRequested };
    } },
    { id: 'journeys', advance(state,elapsed) {
      const result = reports.get(state); reports.delete(state);
      const arrivals = result ? result.arrivals : advanceJourneys(state,elapsed,services.world,services.ledgerServices);
      return { saveRequested: arrivals.length > 0, output: { arrivals, ...(result?.processingTransitions.length ? {processingTransitions:result.processingTransitions} : {}) } };
    } }
  ];
}
