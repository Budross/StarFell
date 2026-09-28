import { getLocationContext } from "./locations.js";
import { discardReason } from "./cargoActions.js";
import { parseQuantity, quantityKind, formatQuantity, formatVolume } from "./quantities.js";
import { entryVolume } from "./storage.js";

export default function cargoDisplay(world, content, onAction) {
  const $ = id => document.querySelector(`#discard-${id}`);
  const form = $("form"), asset = $("asset"), amount = $("amount"), review = $("review");
  let state, locationId, owned, pending = null;
  asset.replaceChildren(...Object.values(content.items).map(item => new Option(item.name, item.id)));
  const clear = () => { pending = null; $("confirmation").hidden = true; $("preview").textContent = ""; };
  function payload() { return { locationId: state.locationId, assetId: asset.value, amount: parseQuantity(amount.value, asset.value, content) }; }
  function update() {
    if (!state) return;
    const local = getLocationContext(state, content, world);
    if (locationId !== state.locationId || owned !== (local.permissions.discardCargo && local.permissions.viewCargo)) { clear(); amount.value = ""; }
    locationId = state.locationId; owned = (local.permissions.discardCargo && local.permissions.viewCargo);
    asset.disabled = amount.disabled = !owned;
    $("unit").textContent = owned ? quantityKind(asset.value, content) === "bulk" ? "(m³)" : "(count)" : "";
    let reason = "Cargo is private.";
    if (owned) {
      try { reason = discardReason(state, payload(), world, content, false); } catch (error) { reason = error.message; }
    }
    $("reason").textContent = reason || "Review the exact amount before permanently removing it.";
    review.disabled = !!reason;
    if (pending && discardReason(state, { ...pending, confirmed: true }, world, content)) clear();
  }
  for (const control of [asset, amount]) control.addEventListener("input", () => { clear(); if (control === asset) amount.value = ""; update(); });
  form.addEventListener("submit", event => {
    event.preventDefault(); update();
    if (review.disabled) return;
    pending = payload();
    $("preview").textContent = `Permanently discard ${formatQuantity(pending.amount, pending.assetId, content)} ${content.items[pending.assetId].name.toLowerCase()} (${formatVolume(entryVolume(pending.assetId, pending.amount, content))} of cargo)? This cannot be undone.`;
    $("confirmation").hidden = false; $("confirm").focus();
  });
  $("cancel").addEventListener("click", () => { clear(); review.focus(); });
  $("confirm").addEventListener("click", () => {
    if (!pending) return;
    const request = { ...pending, confirmed: true };
    clear(); // Synchronous action dispatch cannot reuse this confirmation on a double click.
    onAction("discardCargo", request);
    amount.value = ""; update(); review.focus();
  });
  return next => { state = next; update(); };
}
