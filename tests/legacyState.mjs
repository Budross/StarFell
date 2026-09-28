// Explicit old-format fixture adapter; production never accepts mixed schemas.
export function legacyState(state, version = 7) {
  const legacy = structuredClone(state);
  for (const [id, local] of Object.entries(legacy.locations)) local.ownerId = state.entities[id].ownerId;
  delete legacy.entities; delete legacy.entityIds;
  delete legacy.worldLedger;
  legacy.saveVersion = version;
  return legacy;
}
export function withoutLocalOwners(locations) {
  const copy = structuredClone(locations);
  for (const local of Object.values(copy)) delete local.ownerId;
  return copy;
}
