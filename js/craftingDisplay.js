import { storageSummary, describeStorage, entryVolume } from "./storage.js";
import { formatQuantity, formatVolume } from "./quantities.js";
import { previewRecipe, visibleRecipes } from "./crafting.js";
import { describeAmounts } from "./resources.js";
import { getActionStatus as legacyGetActionStatus } from "./playerActions.js";

export default function craftingDisplay(content, onAction, getActionStatus = legacyGetActionStatus) {
  const inventory = document.querySelector("#item-inventory");
  const cargo = document.querySelector("#cargo-summary");
  const installed = document.querySelector("#installed-products");
  const recipeSelect = document.querySelector("#recipe-select");
  const slots = document.querySelector("#ingredient-slots");
  const previewText = document.querySelector("#craft-preview");
  const requirement = document.querySelector("#craft-requirement");
  const button = document.querySelector("#craft-button");
  const rows = new Map();
  const inventoryGroups = new Map([...inventory.querySelectorAll(".collapsible-section")]
    .map(section => [section.dataset.category, section.querySelector(".storage-readouts")]));
  for (const item of Object.values(content.items)) {
    const row = document.createElement("div");
    const label = document.createElement("dt");
    label.textContent = item.name;
    label.title = item.description ?? item.name;
    const value = document.createElement("dd");
    row.append(label, value);
    inventoryGroups.get(item.category).append(row);
    rows.set(item.id, value);
  }
  recipeSelect.addEventListener("change", () => {
    if (recipeSelect.value) onAction(`selectRecipe:${recipeSelect.value}`);
  });
  slots.addEventListener("change", event => {
    const select = event.target.closest("select[data-slot]");
    if (select) onAction(`selectIngredient:${recipeSelect.value}:${select.dataset.slot}:${select.value}`);
  });
  button.addEventListener("click", () => onAction("craftSelected"));
  let recipeSignature = null;
  let slotSignature = "";
  const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  return function renderCrafting(state) {
    if ((state.permissions ? !state.permissions.viewCargo : state.managedAccess === false)) {
      setText(cargo, "Cargo is private.");
      cargo.classList.remove("overloaded");
      for (const value of rows.values()) { setText(value, "Private"); value.title = "Private"; value.parentElement.hidden = true; }
      setText(installed, "Equipment is private.");
      recipeSelect.replaceChildren(new Option("Requires player ownership", ""));
      recipeSelect.disabled = true;
      slots.replaceChildren();
      recipeSignature = null; slotSignature = "";
      setText(previewText, "Local inventory and fabrication are unavailable.");
      setText(requirement, "Requires player ownership.");
      button.disabled = true;
      return;
    }
    const summary = storageSummary(state, content);
    setText(cargo, describeStorage(summary));
    cargo.classList.toggle("overloaded", summary.overloadVolumeUnits > 0);
    for (const item of Object.values(content.items)) {
      const amount = state.resources[item.id];
      rows.get(item.id).parentElement.hidden = item.category === 'product' && amount === 0;
      setText(rows.get(item.id), item.category === "resource" ? formatQuantity(amount, item.id, content)
        : `${amount} · ${formatVolume(entryVolume(item.id, amount, content))} total`);
      rows.get(item.id).title = item.category === "resource" ? "Bulk volume" : `${formatVolume(item.unitVolumeUnits)} per item`;
    }
    setText(installed, Object.entries(content.infrastructure)
      .filter(([id, def]) => state.infrastructure[id].quantity > 0)
      .map(([id, def]) => `${def.name}: ${state.infrastructure[id].quantity}`).join(" · ") || "No additional products installed.");
    const visible = visibleRecipes(state, content);
    recipeSelect.disabled = visible.length === 0;
    const nextRecipes = visible.map(recipe => recipe.id).join("|");
    if (recipeSignature !== nextRecipes) {
      recipeSignature = nextRecipes;
      const placeholder = new Option(visible.length ? "Choose a recipe…" : "No recipes yet — gather materials, then experiment in Research.", "");
      placeholder.disabled = visible.length > 0;
      recipeSelect.replaceChildren(placeholder, ...visible.map(recipe => new Option(recipe.name, recipe.id)));
    }
    recipeSelect.value = state.crafting.recipeId ?? "";
    const preview = previewRecipe(state, state.crafting.recipeId, state.crafting.ingredients, content);
    const nextSlots = JSON.stringify([state.crafting.recipeId, preview.slots.map(slot => [slot.id, slot.options])]);
    if (slotSignature !== nextSlots) {
      slotSignature = nextSlots;
      slots.replaceChildren();
      for (const slot of preview.slots) {
        const label = document.createElement("label");
        const title = document.createElement("span");
        title.textContent = slot.role ?? content.items[slot.item].name;
        const select = document.createElement("select");
        select.dataset.slot = slot.id;
        for (const option of slot.options) {
          const node = new Option(`${formatQuantity(option.quantity, option.id, content)} ${option.name}${option.reason ? " — " + option.reason : ""}`, option.id);
          node.disabled = Boolean(option.reason);
          select.add(node);
        }
        label.append(title, select);
        slots.append(label);
      }
    }
    preview.slots.forEach((slot, index) => { slots.children[index].querySelector("select").value = slot.selectedId ?? ""; });
    setText(previewText, preview.recipe
      ? `${describeAmounts(preview.cost, content)} → ${describeAmounts(preview.rewards, content)}${preview.storage?.after ? ` · Cargo after: ${formatVolume(preview.storage.after.usedVolumeUnits)}` : ""}`
      : visible.length ? "Fabricate components, then assemble finished products. Crafting completes immediately."
        : "Gather materials in Operations, then run experiments in Research to discover recipes.");
    const actionStatus = getActionStatus("craftSelected");
    setText(requirement, visible.length ? preview.reason || actionStatus.reason || "Materials ready. The complete output fits in storage."
      : "Research a design to unlock fabrication.");
    button.disabled = Boolean(preview.reason) || !actionStatus.available;
    setText(button, preview.recipe ? (content.items[preview.recipe.output].category === "product" ? "Assemble" : "Fabricate") : "Craft");
  };
}
