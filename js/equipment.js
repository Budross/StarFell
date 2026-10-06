import { checkedAdd, checkedMultiply } from "./quantities.js";
import { groupOperational, storeHasCapability } from './equipmentQuery.js';
export { propulsionOutput } from './shipEquipment.js';
// Equipment owns installed-group state. Passive storage and operating output
// deliberately use different rules.
export function equipmentUpgrades(definition, content) {
  return content.items[definition.itemId]?.upgrades ?? [];
}

export function isOperational(infrastructure, id) {
  return groupOperational(infrastructure, id);
}

export function hasCapability(infrastructure, capability, content) {
  return storeHasCapability(infrastructure, capability, content);
}

export function powerOutput(infrastructure, content) {
  return Object.entries(content.infrastructure).reduce((total, [id, definition]) => {
    const machine = infrastructure[id];
    if (!machine.enabled) return total;
    const bonus = equipmentUpgrades(definition, content)
      .filter(upgrade => machine.upgrades.includes(upgrade.id))
      .reduce((sum, upgrade) => sum + upgrade.powerBonus, 0);
    return total + (definition.powerPerSecond + bonus) * machine.quantity * machine.health;
  }, 0);
}

export function capacityWithEquipment(base, infrastructure, assetId, content) {
  // Start with base, preserving the original floating-point addition order.
  return Object.entries(content.infrastructure).reduce((total, [id, machine]) =>
    total + (machine.capacityBonus?.[assetId] ?? 0) * (infrastructure?.[id]?.quantity ?? 0), base);
}

export function installEquipment(infrastructure, group) {
  const machine = infrastructure[group];
  machine.health = (machine.health * machine.quantity + 1) / (machine.quantity + 1);
  machine.quantity += 1;
}

export function repairEquipment(infrastructure, group) {
  infrastructure[group].health = 1;
}

export function cargoBonus(infrastructure, content) {
  return Object.entries(content.infrastructure).reduce((total, [id, machine]) =>
    checkedAdd(total, checkedMultiply(machine.storageBonusVolumeUnits ?? 0, infrastructure?.[id]?.quantity ?? 0)), 0);
}

export function upgradeEquipment(infrastructure, group, upgradeId) {
  infrastructure[group].upgrades.push(upgradeId);
}

export function validateEquipment(infrastructure, content, fail) {
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  for (const [id, machine] of Object.entries(content.infrastructure)) {
    const value = infrastructure[id];
    const upgrades = equipmentUpgrades(machine, content).map(u => u.id);
    if (!record(value) || !Number.isSafeInteger(value.quantity) || value.quantity < 0 || value.quantity > (machine.limit ?? Number.MAX_SAFE_INTEGER) ||
        !Number.isFinite(value.health) || value.health < 0 || value.health > 1 || typeof value.enabled !== "boolean" || !Array.isArray(value.upgrades) ||
        new Set(value.upgrades).size !== value.upgrades.length || value.upgrades.some(id => !upgrades.includes(id))) fail(`${id} condition`);
  }
}
