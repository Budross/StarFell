// Existing subsystem tests can isolate mechanics from the separately tested opening research route.
export function grantOpeningKnowledge(state) {
  for (const id of ["structuralFabrication", "electricalConduction", "circuitAssembly", "semiconductorBehavior", "photovoltaicFabrication", "radioAssembly"]) state.knowledge.discoveries[id] = true;
  return state;
}
