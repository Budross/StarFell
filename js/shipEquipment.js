// Ships owns propulsion data and quantitative output. Equipment only projects it.
export const SHIP_PROPULSION_SELECTORS = Object.freeze(['propulsion']);
export function compileShipEquipment(definition, path) {
  const declarations = definition.capabilities ?? [];
  if(!Array.isArray(declarations))throw new Error(`Invalid ${path}: expected capability declarations.`);
  if(definition.propulsionSelector!==undefined&&!(typeof definition.propulsionSelector==='string'&&/^[A-Za-z][A-Za-z0-9_-]*$/.test(definition.propulsionSelector)&&!['constructor','prototype','__proto__'].includes(definition.propulsionSelector)))throw new Error(`Invalid ${path}: propulsion selector.`);
  const markers = declarations.filter(c => c === 'propulsion' || c?.type === 'propulsion');
  if (markers.length > 1 || markers.some(c => typeof c === 'object' && Object.keys(c).length !== 1)) throw new Error(`Invalid ${path}: duplicate or invalid propulsion contribution.`);
  definition.capabilities = declarations.filter(c => c !== 'propulsion' && c?.type !== 'propulsion');
  if (markers.length || definition.travelSpeed > 0) definition.propulsionSelector ??= 'propulsion';
}
export function propulsionContributionOutput(definition, value, content) {
  if(!value?.enabled)return 0;
  const bonus=(content.items[definition.itemId]?.upgrades??[]).filter(upgrade=>value.upgrades.includes(upgrade.id)).reduce((total,upgrade)=>total+upgrade.travelSpeedBonus,0);
  return (definition.travelSpeed+bonus)*value.quantity*value.health;
}
export function propulsionOutput(infrastructure, selector, content) {
  return Object.entries(content.infrastructure).reduce((sum, [id, definition]) => {
    const value = infrastructure[id];
    if (!value?.enabled || definition.propulsionSelector !== selector) return sum;
    return sum + propulsionContributionOutput(definition,value,content);
  }, 0);
}
export function hasPropulsionDefinition(content, selector) {
  return Object.values(content.infrastructure).some(d => d.propulsionSelector === selector);
}
export function hasInstalledPropulsion(infrastructure, content) {
  return Object.entries(content.infrastructure).some(([id, definition]) => definition.propulsionSelector && infrastructure[id]?.quantity > 0 && infrastructure[id].enabled && infrastructure[id].health > 0);
}
export function describeShipEquipment(definition, content) {
  const module = content.vesselModules?.[definition.itemId];
  const result = [];
  if (definition.propulsionSelector) result.push({ domain: 'ships', kind: 'propulsion', label: 'Propulsion', summary: 'Contributes to Ships-owned propulsion performance; navigation and fuel requirements still apply.',
    selector: definition.propulsionSelector, travelSpeed: definition.travelSpeed, availabilityBasis: 'enabledQuantityAndCondition', ...(module?.capabilities.propulsion ?? {}) });
  if (module?.capabilities.fuelStorage) result.push({ domain: 'ships', kind: 'fuelStorage', label: 'Fuel Storage', summary: 'Provides compatible vessel fuel storage.', availabilityBasis: 'installedQuantity', ...structuredClone(module.capabilities.fuelStorage) });
  return result;
}
