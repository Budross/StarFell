import { decimalRatio, fromBigInt, volumeUnits, checkedAdd, checkedMultiply, record } from './quantities.js';
import { validId } from './conditions.js';

export const SHIPYARD_CELL_SIZE_METERS = 1;
export const VESSEL_REFERENCE_MASS_KG = 250;
export const MODULE_CATEGORIES = Object.freeze(['Core', 'Propulsion', 'Logistics', 'Systems', 'Industrial']);
const equipmentCapabilities = ['radio', 'surfaceExtraction', 'thermalRefining', 'fabrication', 'benchAnalysis'];
const check = (ok, message) => { if (!ok) throw new Error(`Invalid vessel module: ${message}.`); };
function fields(value, allowed, label) {
  check(record(value) && Object.keys(value).every(k => allowed.includes(k)), label);
}
function positive(value, label) { check(Number.isSafeInteger(value) && value > 0, label); return value; }
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

// A projection of the existing Product catalog, with equipment definitions for
// existing domain consumers. It never creates Workshop installation directives.
export function compileVesselModules(items, infrastructure) {
  const modules = {};
  for (const item of Object.values(items)) {
    if (item.vesselModule === undefined) continue;
    const value = item.vesselModule;
    fields(value, ['role', 'category', 'footprint', 'dryMassKg', 'designDiscoveryId', 'core', 'capabilities'], item.id);
    check(item.category === 'product' && !item.installation, `${item.id} must be a Product without ordinary installation`);
    check(['core', 'attachment'].includes(value.role) && MODULE_CATEGORIES.includes(value.category), `${item.id} role/category`);
    check((value.role === 'core') === (value.category === 'Core'), `${item.id} core category`);
    fields(value.footprint, ['width', 'height'], `${item.id} footprint`);
    const area = checkedMultiply(positive(value.footprint.width, 'width'), positive(value.footprint.height, 'height'));
    check(item.unitVolumeUnits > 0 && area > 0, `${item.id} envelope`);
    const mass = decimalRatio(value.dryMassKg, true), grams = mass.numerator * 1000n;
    check(grams % mass.denominator === 0n, `${item.id} mass must use whole grams`);
    const dryMassGrams = positive(fromBigInt(grams / mass.denominator, 'dry mass'), `${item.id} dry mass`);
    check(validId(value.designDiscoveryId), `${item.id} design discovery`);
    for (const recipe of item.recipes) check(recipe.conditions?.discoveries?.includes(value.designDiscoveryId), `${item.id} recipe must require its fabrication design`);
    if (value.role === 'core') {
      fields(value.core, ['vesselClass', 'controlMode', 'boardable'], `${item.id} core contract`);
      const crewed = value.core.vesselClass === 'crewed';
      check(['crewed', 'autonomous'].includes(value.core.vesselClass) && value.core.controlMode === (crewed ? 'direct' : 'commanded') && value.core.boardable === crewed, `${item.id} operating model`);
    } else check(value.core === undefined, `${item.id} attachment cannot be a core`);
    const caps = value.capabilities ?? {};
    fields(caps, ['cargoStorage', 'fuelStorage', 'propulsion', 'equipment'], `${item.id} capabilities`);
    const group = `vessel_${item.id}`;
    check(!Object.hasOwn(infrastructure, group), `${item.id} equipment collision`);
    const equipment = { name: item.name, itemId: item.id, assemblyOwned: true, initialQuantity: 0, powerPerSecond: 0, capabilities: [] };
    let cargoVolumeUnits = 0, fuelVolumeUnits = 0;
    if (caps.cargoStorage) {
      fields(caps.cargoStorage, ['capacityM3'], `${item.id} cargo`);
      cargoVolumeUnits = positive(volumeUnits(caps.cargoStorage.capacityM3), 'cargo capacity');
      equipment.storageBonusM3 = caps.cargoStorage.capacityM3;
    }
    if (caps.fuelStorage) {
      fields(caps.fuelStorage, ['capacityM3', 'acceptedFuelItemIds'], `${item.id} fuel storage`);
      fuelVolumeUnits = positive(volumeUnits(caps.fuelStorage.capacityM3), 'fuel capacity');
      const ids = caps.fuelStorage.acceptedFuelItemIds;
      check(Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length && ids.every(id => items[id]?.category === 'component'), `${item.id} accepted fuel`);
    }
    check(checkedAdd(cargoVolumeUnits, fuelVolumeUnits) <= item.unitVolumeUnits, `${item.id} usable storage exceeds envelope`);
    if (caps.propulsion) {
      fields(caps.propulsion, ['travelSpeed', 'fuelItemId', 'distancePerFuelUnit'], `${item.id} propulsion`);
      check(items[caps.propulsion.fuelItemId]?.category === 'component', `${item.id} propulsion fuel`);
      for (const key of ['travelSpeed', 'distancePerFuelUnit']) check(Number.isFinite(caps.propulsion[key]) && caps.propulsion[key] > 0, `${item.id} ${key}`);
      equipment.travelSpeed = caps.propulsion.travelSpeed;
      equipment.capabilities.push('propulsion');
    }
    if (caps.equipment) {
      fields(caps.equipment, ['powerPerSecond', 'capacityBonus', 'capabilities', 'processing'], `${item.id} equipment`);
      const extra = caps.equipment;
      check(extra.powerPerSecond === undefined || Number.isFinite(extra.powerPerSecond), `${item.id} power rate`);
      check(extra.capabilities === undefined || Array.isArray(extra.capabilities) && new Set(extra.capabilities).size === extra.capabilities.length && extra.capabilities.every(id => equipmentCapabilities.includes(id)), `${item.id} unsupported equipment capability`);
      if (extra.capacityBonus) { fields(extra.capacityBonus, ['power'], `${item.id} reserve`); positive(extra.capacityBonus.power, 'power capacity'); }
      Object.assign(equipment, structuredClone(extra), { capabilities: [...equipment.capabilities, ...(extra.capabilities ?? [])] });
    }
    infrastructure[group] = equipment;
    modules[item.id] = freeze({ ...structuredClone(value), id: item.id, group, dryMassGrams, cargoVolumeUnits, fuelVolumeUnits });
  }
  return Object.freeze(modules);
}
