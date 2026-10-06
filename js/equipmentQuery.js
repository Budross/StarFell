import { requireCapability } from './equipmentCapabilityContracts.js';
import { definitionHasCapability, describeEquipmentDefinition, describeEquipmentProduct } from './equipmentCatalog.js';
import { propulsionContributionOutput } from './shipEquipment.js';

const validId = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value);
export const equipmentReasonLabels = Object.freeze({ HOST_INACTIVE: 'Host unavailable', NO_INSTALLED_EQUIPMENT: 'No equipment installed', DISABLED: 'Equipment disabled', NO_CONDITION: 'Equipment inoperative' });
export function groupOperational(infrastructure, id) {
  const group = infrastructure?.[id];
  return !!(group?.quantity > 0 && group.enabled && group.health > 0);
}
export function storeHasCapability(infrastructure, type, content) {
  type = requireCapability(type, content.equipmentContracts);
  return Object.keys(content.equipment).some(id => groupOperational(infrastructure, id) && definitionHasCapability(content, id, type));
}
function refCheck(ref) {
  if (!ref || Array.isArray(ref) || Object.keys(ref).length !== 2 || !Object.hasOwn(ref,'hostId') || !Object.hasOwn(ref,'equipmentId') || !validId(ref.hostId) || !validId(ref.equipmentId)) throw new Error('Invalid Equipment reference.');
}
function hostActive(state, hostId) {
  if (!validId(hostId)) throw new Error('Invalid Equipment host.');
  const entity = state.entities?.[hostId];
  return !!state.locations?.[hostId] && (!state.entities || ['site', 'ship'].includes(entity?.type) && entity.lifecycle === 'active');
}
export function installedEquipmentOperational(state, ref) {
  refCheck(ref);
  return hostActive(state, ref.hostId) && groupOperational(state.locations[ref.hostId].infrastructure, ref.equipmentId);
}
export function instanceHasEquipmentCapability(state, ref, type, content) {
  refCheck(ref);
  return definitionHasCapability(content, ref.equipmentId, type) && installedEquipmentOperational(state, ref);
}
export function equipmentProviders(state, hostId, type, content) {
  type = requireCapability(type, content.equipmentContracts);
  if (!hostActive(state, hostId)) return [];
  return Object.keys(content.equipment).sort().filter(equipmentId => instanceHasEquipmentCapability(state, { hostId, equipmentId }, type, content))
    .map(equipmentId => ({ ref: { hostId, equipmentId }, declaration: structuredClone(content.equipment[equipmentId].capabilities.find(c => c.type === type)) }));
}
export function hasEquipmentCapability(state, hostId, type, content) {
  return equipmentProviders(state, hostId, type, content).length > 0;
}
export function describeInstalledEquipment(state, ref, content, uses) {
  refCheck(ref);
  const description = describeEquipmentDefinition(content, ref.equipmentId, uses), local = state.locations?.[ref.hostId], group = local?.infrastructure?.[ref.equipmentId];
  if (!description || !group?.quantity) return null;
  const reasons = !hostActive(state, ref.hostId) ? ['HOST_INACTIVE'] : !group.enabled ? ['DISABLED'] : group.health <= 0 ? ['NO_CONDITION'] : [];
  const placements = local.assembly ? [local.assembly.core, ...local.assembly.attachments].filter(p => p.moduleId === description.productId).map(p => p.key) : [];
  return { ...description, ref: { ...ref }, stateGranularity: 'group', basis: 'current', quantity: group.quantity, health: group.health, enabled: group.enabled,
    upgrades: [...group.upgrades], placements, operational: !reasons.length, reasons,
    contributions:description.contributions.map(c=>({...c,available:c.availabilityBasis==='installedQuantity'||!reasons.length,
      ...(c.kind==='propulsion'?{currentOutput:hostActive(state,ref.hostId)?propulsionContributionOutput(content.infrastructure[ref.equipmentId],group,content):0}:{})})),
    capabilities: description.capabilities.map(c => ({ ...c, available: !reasons.length })) };
}
export function createEquipmentQueries(content, uses = {}) {
  return Object.freeze({
    describeProduct: id => describeEquipmentProduct(content, id, uses), describeDefinition: id => describeEquipmentDefinition(content, id, uses),
    describeInstalled: (state, ref) => describeInstalledEquipment(state, ref, content, uses),
    isOperational: (state,ref)=>{refCheck(ref);return Object.hasOwn(content.equipment,ref.equipmentId)&&installedEquipmentOperational(state,ref);},
    instanceHasCapability: (state, ref, type) => instanceHasEquipmentCapability(state, ref, type, content),
    hasCapability: (state, hostId, type) => hasEquipmentCapability(state, hostId, type, content),
    getProviders: (state, hostId, type) => equipmentProviders(state, hostId, type, content),
    getCapabilities: (state, hostId) => Object.keys(content.equipmentContracts).sort().flatMap(type => {
      const providers = equipmentProviders(state, hostId, type, content);
      return providers.length ? [{ id: type, ...structuredClone(content.equipmentContracts[type]), usedBy: structuredClone(uses[type] ?? []), providers }] : [];
    })
  });
}
