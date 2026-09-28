// Executes a fixed manifest. Fresh-slice hooks do not generalize seeding/migration.
export function createStateLifecycleRegistry(domains) {
  if (!Array.isArray(domains)) throw new Error('State domains must be an array.');
  const ids = new Set();
  const descriptors = Object.freeze(domains.map(domain => {
    if (!domain || typeof domain.id !== 'string' || !domain.id.trim() ||
        !['initialize', 'validate', 'reconcile'].some(phase => typeof domain[phase] === 'function') ||
        ['initialize', 'validate', 'reconcile'].some(phase => domain[phase] !== undefined && typeof domain[phase] !== 'function'))
      throw new Error('Invalid state domain descriptor.');
    if (ids.has(domain.id)) throw new Error(`Duplicate state domain: ${domain.id}.`);
    ids.add(domain.id);
    return Object.freeze({ id: domain.id, initialize: domain.initialize, validate: domain.validate, reconcile: domain.reconcile });
  }));

  function run(phase, state, context) {
    for (const domain of descriptors) {
      if (!domain[phase]) continue;
      try {
        const result = domain[phase](state, context);
        if (result && typeof result.then === 'function') throw new Error('State lifecycle hooks must be synchronous.');
      } catch (cause) {
        const label = { initialize: 'initialization', validate: 'validation', reconcile: 'reconciliation' }[phase];
        const error = new Error(`State ${label} failed in "${domain.id}": ${cause?.message ?? String(cause)}`, { cause });
        error.participantId = domain.id;
        error.phase = phase;
        throw error;
      }
    }
  }

  return Object.freeze({ domains: descriptors,
    initialize: (state, context) => run('initialize', state, context),
    validate: (state, context) => run('validate', state, context),
    reconcile: (state, context) => run('reconcile', state, context) });
}
