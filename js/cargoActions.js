import { getLocationContext } from "./locations.js";
import { record, validateQuantity } from "./quantities.js";
import { pay, transferReason, describeAmounts } from "./resources.js";

export function discardReason(state, payload, world, content, requireConfirmation = true) {
  const local = getLocationContext(state, content, world);
  if (!local.permissions.discardCargo) return "Requires discardCargo permission (ownership or a grant). Cargo is private.";
  if (!record(payload) || payload.locationId !== state.locationId) return "Choose cargo at your current location in Workshop.";
  if (!Object.hasOwn(content.items, payload.assetId)) return "Choose stored cargo, not power or installed equipment.";
  try { validateQuantity(payload.amount, payload.assetId, content); } catch (error) { return error.message; }
  if (payload.amount <= 0) return "Enter a positive discard amount.";
  if (requireConfirmation && payload.confirmed !== true) return "Confirm the exact discard amount in Workshop.";
  return transferReason(local.store, { [payload.assetId]: payload.amount }, {}, content);
}
export function createCargoActions(world, content) {
  return [{ id: "discardCargo", name: "Discard cargo", group: "storage", scope: "global", access: "managed", permissions: ["discardCargo"],
    requirement: (state, _context, payload) => discardReason(state, payload, world, content),
    execute(state, _context, payload) {
      const reason = discardReason(state, payload, world, content);
      if (reason) throw new Error(reason);
      const cost = { [payload.assetId]: payload.amount };
      pay(getLocationContext(state, content, world).store, cost, content);
      return `Discarded ${describeAmounts(cost, content)}.`;
    } }];
}
