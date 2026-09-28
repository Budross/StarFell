import { previewStartProcess, startProcess, previewAbortProcess, abortProcess } from './processing.js';
export function createProcessingActions(services) {
  return [
    { id: 'startProcess', name: 'Start industrial batch', collection: 'processing', group: 'processing', permissions: [],
      requirement: (state,_ctx,payload) => payload?.hostId !== state.locationId ? 'Use a machine at your occupied site or ship.' : previewStartProcess(state,payload,services).reason,
      execute(state,_ctx,payload) { const id = startProcess(state,payload,services); return `Batch ${id} loaded. Machine processing has begun.`; } },
    { id: 'abortProcess', name: 'Abort industrial batch', collection: 'processing', group: 'processing', permissions: [],
      requirement(state,_ctx,payload) {
        if (!payload || Object.keys(payload).some(k => !['runId','phase','confirmed'].includes(k)) || payload.confirmed !== true || !['working','delivery'].includes(payload.phase)) return 'Review the batch loss before aborting.';
        const run = state.processing.runs[payload.runId];
        return !run || run.hostId !== state.locationId ? 'Batch unavailable at this location.' : previewAbortProcess(state,payload.runId,services).reason;
      },
      execute(state,_ctx,payload) { abortProcess(state,payload.runId,services,'player',payload.phase); return 'Batch aborted. Committed material was lost; the machine is free.'; } }
  ];
}
