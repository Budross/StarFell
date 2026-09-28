// Ordered construction-time capabilities only. Transactions belong to runtime.
export function composeSimulationSteps(steps) {
  if (!Array.isArray(steps)) throw new Error('Simulation steps must be an array.');
  const ids = new Set();
  return Object.freeze(steps.map(step => {
    if (!step || typeof step.id !== 'string' || !step.id.trim() || typeof step.advance !== 'function')
      throw new Error('Invalid simulation step descriptor.');
    if (ids.has(step.id)) throw new Error(`Duplicate simulation step: ${step.id}.`);
    ids.add(step.id);
    return Object.freeze({ id: step.id, advance: step.advance });
  }));
}

export function advanceSimulation(state, elapsedSeconds, steps, context) {
  const output = {};
  let saveRequested = false;
  for (const step of steps) {
    try {
      const result = step.advance(state, elapsedSeconds, context);
      if (result === undefined) continue;
      if (result === null || typeof result !== 'object' || Array.isArray(result) || typeof result.then === 'function' ||
          Object.keys(result).some(key => !['saveRequested', 'output'].includes(key)) ||
          (result.saveRequested !== undefined && typeof result.saveRequested !== 'boolean'))
        throw new Error('Simulation steps must return a synchronous report or undefined.');
      saveRequested ||= result.saveRequested === true;
      if (result.output === undefined) continue;
      if (result.output === null || typeof result.output !== 'object' || Array.isArray(result.output) || typeof result.output.then === 'function')
        throw new Error('Simulation output must be a record.');
      for (const [key, value] of Object.entries(result.output)) {
        if (['previous', 'state', '__proto__', 'constructor', 'prototype'].includes(key) || Object.hasOwn(output, key))
          throw new Error(`Reserved or duplicate simulation output: ${key}.`);
        output[key] = value;
      }
    } catch (cause) {
      const error = new Error(`Simulation step "${step.id}" failed: ${cause?.message ?? String(cause)}`, { cause });
      error.participantId = step.id;
      error.phase = 'advance';
      throw error;
    }
  }
  return { saveRequested, output };
}
