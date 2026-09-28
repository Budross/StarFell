import { cargoBonus } from "./equipment.js";
import { checkedAdd, checkedMultiply, quantityKind, safeInteger, validateQuantity, formatVolume } from "./quantities.js";
export function entryVolume(id, amount, content) {
  validateQuantity(amount, id, content);
  const kind = quantityKind(id, content);
  return kind === "utility" ? 0 : kind === "bulk" ? amount : checkedMultiply(amount, content.items[id].unitVolumeUnits);
}
export function storageSummary(store, content) {
  const capacityVolumeUnits = checkedAdd(safeInteger(store.capacityVolumeUnits, "cargo capacity"), cargoBonus(store.infrastructure, content));
  const usedVolumeUnits = Object.entries(store.resources).reduce((sum, [id, amount]) => checkedAdd(sum, entryVolume(id, amount, content)), 0);
  return { capacityVolumeUnits, usedVolumeUnits, freeVolumeUnits: Math.max(0, capacityVolumeUnits - usedVolumeUnits),
    overloadVolumeUnits: Math.max(0, usedVolumeUnits - capacityVolumeUnits) };
}
export function assessStorageChange(before, after) {
  return after.usedVolumeUnits <= after.capacityVolumeUnits ||
    (before.overloadVolumeUnits > 0 && after.usedVolumeUnits <= before.usedVolumeUnits);
}
export function maxReceivable(store, id, content) {
  const kind = quantityKind(id, content);
  if (kind === "utility") throw new Error("Utility capacity is separate from cargo.");
  const free = storageSummary(store, content).freeVolumeUnits;
  return kind === "bulk" ? free : Number(BigInt(free) / BigInt(content.items[id].unitVolumeUnits));
}
export function describeStorage(summary) {
  return `Cargo: ${formatVolume(summary.usedVolumeUnits)} / ${formatVolume(summary.capacityVolumeUnits)} · ` +
    (summary.overloadVolumeUnits ? `${formatVolume(summary.overloadVolumeUnits)} overloaded. Reduce or discard cargo to receive more.` : `${formatVolume(summary.freeVolumeUnits)} free`);
}
