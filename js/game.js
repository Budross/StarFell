import { isEntityActive } from "./entities.js";
import { powerOutput } from "./equipment.js";
import { capacity, pay, quantity, receiveUtilityClamped } from "./resources.js";

export function powerRate(state, content) {
  return powerOutput(state.infrastructure, content);
}

export function advanceGame(state, elapsedSeconds, content, getContext) {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) {
    return;
  }

  for (const id of Object.keys(state.locations)) {
    if (state.entities && !isEntityActive(state, id)) continue;
    const local = getContext(state, id).store;
    const change = powerRate(local, content) * elapsedSeconds;

    if (change >= 0) {
      receiveUtilityClamped(local, { power: change }, content);
    } else {
      const availablePower = quantity(local, "power", content);
      const consumedPower = Math.min(availablePower, Math.abs(change));
      pay(local, { power: consumedPower }, content);
    }
  }
  state.simulationTime += elapsedSeconds;
}

export function createView(state, content) {
  return {
    power: quantity(state, "power", content),
    powerCapacity: capacity(state, "power", content),
    powerRate: powerRate(state, content),
    solarHealth: state.infrastructure.solar?.quantity > 0 ? state.infrastructure.solar.health : null,
    simulationTime: state.simulationTime
  };
}
