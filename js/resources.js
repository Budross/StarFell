import { capacityWithEquipment } from "./equipment.js";
import { assessStorageChange, storageSummary } from "./storage.js";
import { quantityKind, validateQuantity, checkedAdd, formatQuantity, record } from "./quantities.js";

export function quantity(store, id, content) {
  quantityKind(id, content);
  return validateQuantity(store.resources[id] ?? 0, id, content);
}
export function capacity(store, id, content) {
  if (quantityKind(id, content) !== "utility") throw new Error("Physical items use shared cargo capacity.");
  return validateQuantity(capacityWithEquipment(store.capacities?.[id] ?? content.resources[id].baseCapacity, store.infrastructure, id, content), id, content);
}
export function describeAmounts(amounts, content) {
  return Object.entries(amounts).map(([id, amount]) => `${formatQuantity(amount, id, content)} ${content.resources[id].name.toLowerCase()}`).join(" + ");
}
export function previewExchange(store, cost, rewards, content, infrastructure = store.infrastructure) {
  const fail = (code, reason) => ({ ok: false, code, reason });
  try {
    if (!record(cost) || !record(rewards)) return fail("invalidAmount", "Invalid quantity map.");
    for (const amounts of [cost, rewards]) for (const [id, amount] of Object.entries(amounts)) validateQuantity(amount, id, content);
    const before = storageSummary(store, content);
    for (const [id, amount] of Object.entries(cost)) if (quantity(store, id, content) < amount)
      return fail("insufficientStock", `Requires ${describeAmounts(cost, content)}.`);
    const resources = { ...store.resources };
    for (const id of new Set([...Object.keys(cost), ...Object.keys(rewards)])) {
      const remaining = quantity(store, id, content) - (cost[id] ?? 0);
      resources[id] = quantityKind(id, content) === "utility" ? remaining + (rewards[id] ?? 0) : checkedAdd(remaining, rewards[id] ?? 0);
      validateQuantity(resources[id], id, content);
    }
    const projected = { ...store, resources, infrastructure };
    for (const id of content.utilities) if (quantity(projected, id, content) > capacity(projected, id, content))
      return fail("utilityFull", `Insufficient ${content.resources[id].name.toLowerCase()} capacity.`);
    const after = storageSummary(projected, content);
    if (!assessStorageChange(before, after)) return { ...fail("cargoFull", "Insufficient cargo capacity. Make room or discard cargo."), before, after };
    return { ok: true, reason: "", resources, before, after };
  } catch (error) { return fail(/overflow/.test(error.message) ? "overflow" : "invalidAmount", error.message); }
}
export const transferReason = (store, cost, rewards, content) => previewExchange(store, cost, rewards, content).reason;
export function transfer(store, cost, rewards, content) {
  const preview = previewExchange(store, cost, rewards, content);
  if (!preview.ok) throw new Error(preview.reason);
  Object.assign(store.resources, preview.resources);
}
export const canPay = (store, cost, content) => previewExchange(store, cost, {}, content).ok;
export const pay = (store, cost, content) => transfer(store, cost, {}, content);
// Inventory creation into the destination, with no source or debit and no clamping.
export function grantItemsChecked(store, rewards, content) {
  if (!record(rewards) || !Object.keys(rewards).length || Object.entries(rewards).some(([id, amount]) =>
    !Object.hasOwn(content.items, id) || !Number.isSafeInteger(amount) || amount <= 0)) throw new Error("Invalid item grant.");
  const preview = previewExchange(store, {}, rewards, content);
  if (!preview.ok) throw new Error(preview.reason);
  Object.assign(store.resources, preview.resources);
}
export function receiveUtilityClamped(store, rewards, content) {
  if (!record(rewards)) throw new Error("Invalid utility rewards.");
  const next = {}, overflow = {};
  for (const [id, amount] of Object.entries(rewards)) {
    if (quantityKind(id, content) !== "utility") throw new Error("Only utility production may clamp rewards.");
    validateQuantity(amount, id, content);
    const before = quantity(store, id, content), accepted = Math.min(amount, Math.max(0, capacity(store, id, content) - before));
    next[id] = before + accepted;
    if (accepted < amount) overflow[id] = amount - accepted;
  }
  Object.assign(store.resources, next);
  return overflow;
}
// Compatibility name deliberately rejects physical rewards instead of clipping them.
export const receive = receiveUtilityClamped;
function previewMove(source, destination, id, amount, content) {
  if (source === destination || source.resources === destination.resources) throw new Error("Choose two different stores.");
  validateQuantity(amount, id, content);
  if (amount <= 0) throw new Error("Enter a positive amount.");
  if (quantity(source, id, content) < amount) throw new Error("Insufficient stock at the source.");
  const debit = previewExchange(source, { [id]: amount }, {}, content);
  const credit = previewExchange(destination, {}, { [id]: amount }, content);
  if (!debit.ok) throw new Error(debit.reason);
  if (!credit.ok) throw new Error(`Insufficient receiving capacity. ${credit.reason}`);
  if (debit.resources[id] === source.resources[id] || credit.resources[id] === destination.resources[id]) throw new Error("Amount is too small to transfer accurately.");
  return { debit, credit };
}
export function moveReason(source, destination, id, amount, content) {
  try { previewMove(source, destination, id, amount, content); return ""; } catch (error) { return error.message; }
}
export function moveExact(source, destination, id, amount, content) {
  const { debit, credit } = previewMove(source, destination, id, amount, content);
  Object.assign(source.resources, debit.resources);
  Object.assign(destination.resources, credit.resources);
}
