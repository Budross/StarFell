import { locationDefinition } from './entityQueries.js';
import { hasEquipmentCapability } from './equipmentQuery.js';
import { permissionReason } from './authority.js';

// Shared vessel-owned admission policy; location visibility is supplied by its owner.
export function vesselLinkReason(state, vesselId, services, actorId = 'player') {
  const entity = state.entities[vesselId], local = state.locations[vesselId], def = locationDefinition(state, services.world, vesselId);
  if (entity?.type !== 'ship' || entity.lifecycle !== 'active' || !local?.assembly || !def || !services.isKnown(state,vesselId)) return 'Choose a known active modular vessel.';
  const occupiedId = actorId === 'player' ? state.locationId : state.npcs[actorId]?.locationId;
  if (occupiedId === vesselId && def.boardable || local.dockedAtId === occupiedId && !local.journey) return '';
  const host = state.locations[occupiedId];
  if (!host || state.entities[occupiedId]?.lifecycle !== 'active' || !hasEquipmentCapability(state, occupiedId, 'radioCommunication', services.content) || !hasEquipmentCapability(state, vesselId, 'radioCommunication', services.content)) return 'Remote commands require operational radio at both ends.';
  return permissionReason(state, actorId, occupiedId, 'useFacilities');
}
