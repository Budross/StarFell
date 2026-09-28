// Apply after final step selection in bootstrap; runtime/runner stay generic.
export function withLedgerSaveRequest(step) {
  return { id: step.id, advance(state, elapsed, context) {
    const before = state.worldLedger.nextId;
    const report = step.advance(state, elapsed, context);
    if (state.worldLedger.nextId === before) return report;
    if (report === undefined) return { saveRequested: true };
    // Never sanitize an invalid/async report: let the runner reject it as usual.
    if (report === null || typeof report !== 'object' || Array.isArray(report) || typeof report.then === 'function' ||
      report.saveRequested !== undefined && typeof report.saveRequested !== 'boolean') return report;
    return { ...report, saveRequested: true };
  } };
}
