import { deriveVessel } from './vessels.js';
import { checkedAdd, checkedMultiply, record, validateQuantity } from './quantities.js';
import { getLocationContext } from './locations.js';
import { moveExact, moveReason } from './resources.js';
import { permissionReason } from './authority.js';
import { vesselLinkReason } from './vesselAccess.js';

export function vesselFuelSummary(state, vesselId, content) {
  const local = state.locations[vesselId], derived = deriveVessel(local.assembly, content);
  let usedVolumeUnits = 0;
  for (const [id, n] of Object.entries(local.fuel.items)) usedVolumeUnits = checkedAdd(usedVolumeUnits, checkedMultiply(n, content.items[id].unitVolumeUnits));
  return { capacityVolumeUnits: derived.fuelVolumeUnits, usedVolumeUnits, overloadVolumeUnits: Math.max(0, usedVolumeUnits - derived.fuelVolumeUnits),
    acceptedFuelItemIds: derived.acceptedFuelItemIds, items: { ...local.fuel.items } };
}
function tankStore(state, vesselId, content) {
  return { resources: { power: 0, ...state.locations[vesselId].fuel.items }, infrastructure: {}, capacities: { power: 0 },
    capacityVolumeUnits: vesselFuelSummary(state, vesselId, content).capacityVolumeUnits };
}
function previewFuelMove(state, request, services, actorId) {
  if (!record(request) || Object.keys(request).some(k => !['vesselId', 'cargoId', 'fuelItemId', 'amount', 'direction'].includes(k)) || !['load', 'unload'].includes(request.direction)) throw new Error('Invalid fuel movement request.');
  const { vesselId, cargoId, fuelItemId, amount, direction } = request, { content, world } = services;
  const link = vesselLinkReason(state, vesselId, services, actorId); if (link) throw new Error(link);
  const local = state.locations[vesselId];
  if (local.journey || cargoId !== vesselId && cargoId !== local.dockedAtId) throw new Error('Fuel must move between the vessel tank and its own cargo or actual berth.');
  const summary = vesselFuelSummary(state, vesselId, content);
  if (content.items[fuelItemId]?.category !== 'component' || !summary.acceptedFuelItemIds.includes(fuelItemId)) throw new Error('No compatible tank for this fuel.');
  validateQuantity(amount, fuelItemId, content); if (amount <= 0) throw new Error('Enter a positive whole cartridge count.');
  for (const [id, permission] of [[vesselId, 'useFacilities'], [vesselId, direction === 'load' ? 'depositCargo' : 'withdrawCargo'], [cargoId, direction === 'load' ? 'withdrawCargo' : 'depositCargo']]) {
    const reason = permissionReason(state, actorId, id, permission); if (reason) throw new Error(reason);
  }
  const tank = tankStore(state, vesselId, content), cargo = getLocationContext(state, content, world, cargoId, actorId).store;
  const source = direction === 'load' ? cargo : tank, destination = direction === 'load' ? tank : cargo;
  const reason = moveReason(source, destination, fuelItemId, amount, content); if (reason) throw new Error(reason);
  return { source, destination, tank };
}
export function fuelMovementReason(state, request, services, actorId = 'player') {
  try { previewFuelMove(state, request, services, actorId); return ''; } catch (error) { return error.message; }
}
export function moveVesselFuel(state, request, services, actorId = 'player') {
  const { source, destination, tank } = previewFuelMove(state, request, services, actorId);
  moveExact(source, destination, request.fuelItemId, request.amount, services.content);
  const { power, ...items } = tank.resources;
  state.locations[request.vesselId].fuel.items = items;
}
export function consumeVesselFuel(state, vesselId, itemId, amount, content) {
  validateQuantity(amount, itemId, content);
  const items = state.locations[vesselId].fuel.items;
  if ((items[itemId] ?? 0) < amount) throw new Error('Insufficient loaded vessel fuel.');
  items[itemId] -= amount;
}
