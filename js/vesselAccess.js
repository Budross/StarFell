import { locationDefinition } from './entityQueries.js';
import { isKnown } from './locations.js';
import { hasCapability } from './equipment.js';
import { permissionReason } from './authority.js';

export function vesselLinkReason(state, vesselId, services, actorId = 'player') {
  const entity = state.entities[vesselId], local = state.locations[vesselId], def = locationDefinition(state, services.world, vesselId);
  if (entity?.type !== 'ship' || entity.lifecycle !== 'active' || !local?.assembly || !def || !isKnown(state, services.world, services.content, vesselId)) return 'Choose a known active modular vessel.';
  const occupiedId = actorId === 'player' ? state.locationId : state.npcs[actorId]?.locationId;
  if (occupiedId === vesselId && def.boardable || local.dockedAtId === occupiedId && !local.journey) return '';
  const host = state.locations[occupiedId];
  if (!host || state.entities[occupiedId]?.lifecycle !== 'active' || !hasCapability(host.infrastructure, 'radio', services.content) || !hasCapability(local.infrastructure, 'radio', services.content)) return 'Remote commands require operational radio at both ends.';
  return permissionReason(state, actorId, occupiedId, 'useFacilities');
}
