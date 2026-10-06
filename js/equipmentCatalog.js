import { requireCapability } from './equipmentCapabilityContracts.js';
import { describeShipEquipment } from './shipEquipment.js';

export function compileEquipmentCatalog(content) {
  const definitions = {};
  for (const [id, definition] of Object.entries(content.infrastructure)) definitions[id] = Object.freeze({
    id, productId: definition.itemId ?? null, name: definition.name,
    installationMode: definition.assemblyOwned ? 'vesselModule' : definition.itemId ? 'ordinary' : 'builtIn',
    capabilities: Object.freeze(definition.capabilities)
  });
  return Object.freeze(definitions);
}
export function definitionHasCapability(content, equipmentId, type) {
  type = requireCapability(type, content.equipmentContracts);
  return !!content.equipment&&Object.hasOwn(content.equipment,equipmentId)&&content.equipment[equipmentId].capabilities.some(c => c.type === type);
}
export function equipmentCapabilityTypes(content, equipmentId) {
  return (Object.hasOwn(content.equipment??{},equipmentId)?content.equipment[equipmentId].capabilities:[]).map(c => c.type);
}
export function describeEquipmentDefinition(content, id, uses = {}) {
  const definition = Object.hasOwn(content.equipment??{},id)?content.equipment[id]:null;
  if (!definition) return null;
  const physical = content.infrastructure[id], contributions = describeShipEquipment(physical, content);
  if (physical.powerPerSecond) contributions.push({ domain: 'power', kind: 'powerRate', label: 'Power Flow', summary: 'Contributes to the host power flow.', rate: physical.powerPerSecond, availabilityBasis: 'enabledQuantityAndCondition' });
  for (const [utilityId, amount] of Object.entries(physical.capacityBonus ?? {})) contributions.push({ domain: 'power', kind: 'reserveCapacity', label: 'Power Reserve', summary: 'Adds installed utility reserve capacity.', utilityId, amount, availabilityBasis: 'installedQuantity' });
  if (physical.storageBonusVolumeUnits) contributions.push({ domain: 'storage', kind: 'cargoCapacity', label: 'Cargo Storage', summary: 'Adds installed cargo capacity.', volumeUnits: physical.storageBonusVolumeUnits, availabilityBasis: 'installedQuantity' });
  return structuredClone({ ...definition, equipmentId: id, installable: true, contributions,
    capabilities: definition.capabilities.map(c => ({ id: c.type, ...c, ...content.equipmentContracts[c.type], usedBy: uses[c.type] ?? [] })) });
}
export function describeEquipmentProduct(content, productId, uses) {
  const item = Object.hasOwn(content.items,productId)?content.items[productId]:null;
  if (!item) return null;
  const group = item.installation?.group ?? content.vesselModules?.[productId]?.group;
  return group ? describeEquipmentDefinition(content, group, uses) : { productId, name: item.name, installable: false, capabilities: [], contributions: [] };
}
