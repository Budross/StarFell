// Simulation-relative seconds. This capability has no state or scheduling API.
export function createSimulationClock() {
  const valid = value => Number.isFinite(value) && value >= 0;
  return Object.freeze({
    now(state) {
      if (!valid(state.simulationTime)) throw new Error('Invalid simulation time.');
      return state.simulationTime;
    },
    elapsed(from, to) {
      if (!valid(from) || !valid(to) || to < from) throw new Error('Invalid simulation interval.');
      return to - from;
    }
  });
}
