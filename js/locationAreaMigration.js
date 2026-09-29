// Consolidate the four former prospecting approaches into Shattered Asteroid.
// The outerReach identity stays stable for saved journeys and historical records.
const formerAreas = {
  metallicFragmentArea: { name: 'Metallic fragment approach', siteId: 'metallicFragment' },
  carbonaceousBodyArea: { name: 'Carbonaceous body approach', siteId: 'carbonaceousBody' },
  denseMetallicBodyArea: { name: 'Dense metallic body approach', siteId: 'denseMetallicBody' },
  icyBodyArea: { name: 'Icy body approach', siteId: 'icyBody' }
};

export function migrateConsolidatedAreas(state, world, notices = []) {
  if (world.definitions.outerReach?.kind !== 'area' || !state.locations || typeof state.locations !== 'object') return;
  const removed = Object.keys(formerAreas).filter(id => !world.definitions[id]);
  if (!removed.length) return;
  const remap = id => removed.includes(id) ? 'outerReach' : id;
  let changed = false;

  // Version 3 could save the player in an Area. Later saves require a site or ship.
  if (state.saveVersion === 3 && formerAreas[state.locationId] && removed.includes(state.locationId)) {
    state.locationId = formerAreas[state.locationId].siteId;
    changed = true;
  }

  for (const [id, local] of Object.entries(state.locations)) {
    if (!local || typeof local !== 'object') continue;
    if (local.areaId && remap(local.areaId) !== local.areaId) {
      local.areaId = remap(local.areaId);
      changed = true;
    }
    const journey = local.journey;
    if (!journey || typeof journey !== 'object') continue;
    const originAreaId = remap(journey.originAreaId);
    const targetId = journey.kind === 'area' ? remap(journey.targetId) : journey.targetId;
    if (originAreaId === journey.originAreaId && targetId === journey.targetId) continue;
    // The route has become movement within one Area. Its departure cost was paid.
    if (journey.kind === 'area' && originAreaId === targetId) {
      local.areaId = targetId;
      local.journey = null;
    } else {
      journey.originAreaId = originAreaId;
      journey.targetId = targetId;
    }
    changed = true;
  }

  for (const id of removed) {
    if (!Object.hasOwn(state.locations, id)) continue;
    const entity = state.entities?.[id];
    if (entity) {
      // Retain the identity and local state so ledger and other history still resolve.
      if (entity.lifecycle !== 'retired' && entity.lifecycle !== 'destroyed') {
        entity.retained = { name: formerAreas[id].name, location: { locationId: null, areaId: null } };
        entity.lifecycle = 'retired';
        entity.lifecycleChangedAt = state.simulationTime;
        entity.lifecycleReason = 'Area consolidated into Shattered Asteroid.';
        changed = true;
      }
    } else {
      // Pre-registry saves have no references to these Areas in the ledger.
      delete state.locations[id];
      changed = true;
    }
  }
  if (changed) notices.push('The prospecting approaches are now part of Shattered Asteroid. Ships and sites were moved without changing their cargo or progress.');
}
