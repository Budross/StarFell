import { startProcess, cancelUnconsumedExtraction } from './processing.js';
import { calculateProcessingReadiness,processingStartReadiness,processingWorkFailure } from './processingQuery.js';
import { advanceIndustrialInterval, nextIndustrialInterval } from './processingSimulation.js';

// Query-only execution on detached state. All allocation, energy, work,
// claims and output semantics come from the ordinary Processing implementation.
export function projectProcessingWork(state, request, services, actorId = 'player', { batches = 1, runId = null, handoffElapsed = 0 } = {}) {
  const projected = structuredClone(state), startedAt = services.clock.now(state);
  const scratch = { ...services, ledgerServices: { append() {}, withBatch: (_state, operation) => operation() } };
  let boundaries = 0;
  const fail = reason => ({ ok: false, reason });
  if (!Number.isSafeInteger(batches) || batches < 1 || batches > 10000 || !Number.isFinite(handoffElapsed) || handoffElapsed < 0) return fail('Invalid Processing projection bounds.');
  function step(limit = Infinity) {
    if (++boundaries > 10000) throw new Error('Processing projection exceeds its finite boundary budget.');
    const plan = calculateProcessingReadiness(projected,scratch);
    const interval = nextIndustrialInterval(projected,plan.hosts,limit);
    if (!(interval > 0) || !Number.isFinite(interval)) throw new Error('Processing cannot make further progress or recharge.');
    advanceIndustrialInterval(projected,interval,scratch);
  }
  try {
    for (let batch = 0; batch < batches; batch++) {
      let id = batch === 0 ? runId : null;
      if (id === null) {
        let preview = processingStartReadiness(projected,request,scratch,actorId);
        while (!preview.ok && preview.canWaitForPower) {
          const host = calculateProcessingReadiness(projected,scratch).hosts.find(h => h.hostId === request.hostId);
          step((host.capacity-host.power)/host.generation);
          preview = processingStartReadiness(projected,request,scratch,actorId);
        }
        if (!preview.ok) return fail(preview.reason);
        id = startProcess(projected,request,scratch,actorId);
      }
      let run = projected.processing.runs[id];
      if (!run) return fail('Accepted Processing work is unavailable.');
      while (run?.phase === 'working') {
        const failure=processingWorkFailure(projected,id,scratch);
        if (failure) {
          if (runId === null) return fail(failure);
          const disposition = cancelUnconsumedExtraction(projected,id,run.hostId,scratch,actorId);
          if (disposition.status !== 'CANCELLED') return fail(disposition.reason);
          break;
        }
        step(); run = projected.processing.runs[id];
      }
      if (projected.processing.runs[id]?.phase === 'delivery') return fail('Finished output would remain buffered in the machine.');
    }
    const completedAt = services.clock.now(projected);
    if (handoffElapsed) advanceIndustrialInterval(projected,handoffElapsed,scratch);
    return { ok: true, state: projected, startedAt, completedAt, duration: services.clock.elapsed(startedAt,completedAt), handoffAt: services.clock.now(projected) };
  } catch (error) { return fail(error.message); }
}
