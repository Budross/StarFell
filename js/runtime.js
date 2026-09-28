import { advanceSimulation, composeSimulationSteps } from "./simulationRegistry.js";

// Owns the current state and commit policy. No DOM or notifications occur here.
// Callers supply elapsed visible time; the browser owns visibility/clock sampling.
export function createGameRuntime({ initialState, save, simulationSteps, simulationContext, reconcileAction, validate }) {
  if (!Array.isArray(simulationSteps) || typeof reconcileAction !== 'function' || typeof validate !== 'function' || typeof save !== 'function')
    throw new Error('Runtime requires composed simulation, reconciliation, validation, and save capabilities.');
  const steps = composeSimulationSteps(simulationSteps);
  let state = initialState;
  let secondsSinceSave = 0;
  let paused = false;

  function applyAction(execute) {
    const candidate = structuredClone(state);
    let message = execute(candidate);
    const closure = reconcileAction(candidate);
    if (closure) message = [message, closure].filter(Boolean).join(" ");
    validate(candidate);
    save(candidate);
    const previous = state;
    state = candidate;
    paused = false;
    secondsSinceSave = 0;
    return { previous, state, message };
  }

  function advance(elapsedSeconds) {
    if (paused || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return null;
    try {
      const candidate = structuredClone(state);
      const report = advanceSimulation(candidate, elapsedSeconds, steps, simulationContext);
      const shouldSave = report.saveRequested || secondsSinceSave + elapsedSeconds >= 5;
      if (shouldSave) { validate(candidate); save(candidate); }
      const previous = state;
      state = candidate;
      secondsSinceSave = shouldSave ? 0 : secondsSinceSave + elapsedSeconds;
      return { previous, state, ...report.output };
    } catch (error) {
      paused = true;
      throw error;
    }
  }

  return {
    getState: () => state,
    applyAction,
    advance,
    flush: () => save(state),
    isPaused: () => paused,
    pause: () => { paused = true; }
  };
}
