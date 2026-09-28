import { transferOptions, locationTransferReason, getLocationContext } from "./locations.js";
import { parseQuantity, quantityKind, formatQuantity } from "./quantities.js";
import { maxReceivable, storageSummary, describeStorage } from "./storage.js";
import { capacity } from "./resources.js";
import { canUse } from "./authority.js";

export default function transferDisplay(world, content, onAction) {
  const form = document.querySelector("#location-transfer");
  const source = document.querySelector("#transfer-source");
  const destination = document.querySelector("#transfer-destination");
  const asset = document.querySelector("#transfer-asset");
  const amount = document.querySelector("#transfer-amount");
  const submit = document.querySelector("#transfer-submit");
  const reasonEl = document.querySelector("#transfer-reason");
  const space = document.querySelector("#transfer-space"), unit = document.querySelector("#transfer-unit");
  const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };

  for (const id of ["power", ...Object.keys(content.items)]) {
    asset.add(new Option(content.resources[id].name, id));
  }

  function payload() {
    return {
      sourceId: source.value,
      destinationId: destination.value,
      assetId: asset.value,
      amount: parseQuantity(amount.value, asset.value, content)
    };
  }

  let state = null;
  let endpointSignature = "";

  for (const input of [source, destination, asset, amount]) {
    input.addEventListener("input", () => { if (input === asset) amount.value = ""; updateTransfer(); });
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    updateTransfer();
    if (submit.disabled) return;
    onAction("transferLocations", payload());
  });

  function updateTransfer() {
    if (!state) return;
    const { accessible, reason: accessReason, endpoints: eligible } = transferOptions(state, world, content);
    for (const control of [source, destination, asset, amount]) control.disabled = !accessible;
    if (!accessible) {
      source.replaceChildren(); destination.replaceChildren(); endpointSignature = "";
      submit.disabled = true;
      setText(space, ""); setText(unit, ""); amount.value = "";
      setText(reasonEl, accessReason);
      return;
    }
    const signature = JSON.stringify([state.locationId, eligible.map(d => d.id)]);
    if (signature !== endpointSignature) {
      endpointSignature = signature;
      for (const select of [source, destination]) {
        const old = select.value;
        select.replaceChildren(...eligible.map(def => new Option(def.name, def.id)));
        if (eligible.some(def => def.id === old)) select.value = old;
      }
      source.value = state.locationId;
      destination.value = eligible.find(def => def.id !== state.locationId)?.id ?? "";
    }
    const kind = quantityKind(asset.value, content);
    setText(unit, kind === "bulk" ? "(m³)" : kind === "count" ? "(count)" : "(power)");
    setText(space, "");
    if (eligible.some(def => def.id === source.value) && eligible.some(def => def.id === destination.value) && source.value !== destination.value &&
      canUse(state, "player", source.value, "viewCargo") && canUse(state, "player", destination.value, "viewCargo")) {
      const from = getLocationContext(state, content, world, source.value).store;
      const to = getLocationContext(state, content, world, destination.value).store;
      const free = kind === "utility" ? Math.max(0, capacity(to, asset.value, content) - to.resources[asset.value]) : maxReceivable(to, asset.value, content);
      const maximum = Math.min(from.resources[asset.value], free);
      setText(space, `Transfer maximum: ${formatQuantity(maximum, asset.value, content)} · Receiving ${describeStorage(storageSummary(to, content))}`);
    }
    let reason;
    try { reason = locationTransferReason(state, payload(), world, content); } catch (error) { reason = error.message; }
    setText(reasonEl, reason || "Ready. The complete amount will move between these stores.");
    submit.disabled = Boolean(reason);
  }

  return function renderTransfer(nextState) {
    state = nextState;
    updateTransfer();
  };
}
