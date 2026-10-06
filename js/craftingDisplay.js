import { storageSummary, describeStorage, entryVolume } from "./storage.js";
import { formatQuantity, formatVolume } from "./quantities.js";
import { previewRecipe, visibleRecipes, ingredientRecipe } from "./crafting.js";
import { describeAmounts } from "./resources.js";
import { getActionStatus as legacyGetActionStatus } from "./playerActions.js";

export default function craftingDisplay(content, onAction, getActionStatus = legacyGetActionStatus, openItem = () => {}) {
  const inventory = document.querySelector("#item-inventory");
  const cargo = document.querySelector("#cargo-summary");
  const installed = document.querySelector("#installed-products");
  const recipeSelect = document.querySelector("#recipe-select");
  const slots = document.querySelector("#ingredient-slots");
  const previewText = document.querySelector("#craft-preview");
  const requirement = document.querySelector("#craft-requirement");
  const button = document.querySelector("#craft-button");
  const rows = new Map();
  let selectedRow=null;
  function clearItemSelection() {
    if (!selectedRow) return;
    selectedRow.querySelector('.item-label-button').setAttribute('aria-pressed','false');
    selectedRow.classList.remove('item-selected'); selectedRow=null;
  }
  const inventoryGroups = new Map([...inventory.querySelectorAll(".collapsible-section")]
    .map(section => [section.dataset.category, section.querySelector(".storage-readouts")]));
  for (const item of Object.values(content.items)) {
    const row = document.createElement("div");
    row.dataset.item = item.id;
    const label = document.createElement("dt");
    const itemLabel=document.createElement('button'); itemLabel.type='button'; itemLabel.className='item-label-button';
    itemLabel.textContent=item.name; itemLabel.setAttribute('aria-pressed','false');
    itemLabel.setAttribute('aria-controls','item-context');
    itemLabel.setAttribute('aria-label',`${item.name}; double-click or press Enter to view details`);
    label.title = item.description ?? item.name;
    label.append(itemLabel);
    row.addEventListener('click',event => {
      clearItemSelection();
      selectedRow=row; itemLabel.setAttribute('aria-pressed','true'); row.classList.add('item-selected');
      if (event.detail===0) openItem(item.id,itemLabel);
    });
    row.addEventListener('dblclick',() => openItem(item.id,itemLabel));
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
  let currentState = null;
  previewText.addEventListener("click", event => {
    const target = event.target.closest("button[data-ingredient]");
    if (!target || !previewText.contains(target) || !currentState ||
      (currentState.permissions ? !currentState.permissions.viewCargo : currentState.managedAccess === false)) return;
    const preview = previewRecipe(currentState, currentState.crafting.recipeId, currentState.crafting.ingredients, content);
    if (!preview.shortages.some(shortage => shortage.itemId === target.dataset.ingredient)) return;
    const recipe = ingredientRecipe(target.dataset.ingredient, visibleRecipes(currentState, content), preview.recipe?.id);
    if (!recipe || recipe.id !== target.dataset.recipe || !getActionStatus(`selectRecipe:${recipe.id}`).available) return;
    const result = onAction(`selectRecipe:${recipe.id}`);
    if (result?.ok) recipeSelect.focus({ preventScroll: true });
  });
  let recipeSignature = null;
  let slotSignature = "";
  let previewSignature = "";
  const previewRows = new Map();
  let previewSuffix = null;
  const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const resetPreview = () => {
    const hadFocus = previewText.contains(document.activeElement);
    previewText.replaceChildren();
    previewRows.clear(); previewSuffix = null; previewSignature = "";
    if (hadFocus) recipeSelect.focus({ preventScroll: true });
  };
  const unavailableHint = id => content.items[id]?.category === "resource"
    ? "Must be gathered or acquired"
    : content.utilities.includes(id) ? "Must be supplied locally" : "No known fabrication recipe";
  return function renderCrafting(state) {
    if (currentState?.locationId !== state.locationId) clearItemSelection();
    currentState = state;
    if ((state.permissions ? !state.permissions.viewCargo : state.managedAccess === false)) {
      clearItemSelection();
      setText(cargo, "Cargo is private.");
      cargo.classList.remove("overloaded");
      for (const value of rows.values()) { setText(value, "Private"); value.title = "Private"; value.parentElement.hidden = true; }
      setText(installed, "Equipment is private.");
      recipeSelect.replaceChildren(new Option("Requires player ownership", ""));
      recipeSelect.disabled = true;
      slots.replaceChildren();
      recipeSignature = null; slotSignature = "";
      if (previewRows.size) resetPreview();
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
      if (rows.get(item.id).parentElement.hidden && selectedRow === rows.get(item.id).parentElement) clearItemSelection();
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
    if (preview.recipe) {
      const nextPreview = JSON.stringify([preview.recipe.id, Object.keys(preview.cost)]);
      if (previewSignature !== nextPreview) {
        resetPreview();
        previewSignature = nextPreview;
        for (const id of Object.keys(preview.cost)) {
          if (previewRows.size) previewText.append(" + ");
          const amount = document.createElement("span");
          const name = document.createElement("span");
          const holder = document.createElement("span");
          holder.append(amount, " ", name);
          previewText.append(holder);
          previewRows.set(id, { amount, name });
        }
        previewSuffix = document.createElement("span");
        previewText.append(previewSuffix);
      }
      for (const [id, amount] of Object.entries(preview.cost)) {
        const row = previewRows.get(id);
        const shortage = preview.shortages.find(entry => entry.itemId === id);
        const target = shortage && ingredientRecipe(id, visible, preview.recipe.id);
        const tag = target ? "BUTTON" : "SPAN";
        if (row.name.tagName !== tag) {
          const hadFocus = row.name === document.activeElement;
          const name = document.createElement(tag.toLowerCase());
          row.name.replaceWith(name); row.name = name;
          if (hadFocus) recipeSelect.focus({ preventScroll: true });
        }
        setText(row.amount, formatQuantity(amount, id, content));
        setText(row.name, content.resources[id].name.toLowerCase());
        row.name.classList.toggle("craft-missing", Boolean(shortage));
        row.name.title = shortage ? `Need ${formatQuantity(shortage.required, id, content)}; have ${formatQuantity(shortage.owned, id, content)}; short ${formatQuantity(shortage.missing, id, content)}.${target ? ` Select ${target.name}.` : ` ${unavailableHint(id)}.`}` : "";
        if (target) {
          row.name.type = "button";
          row.name.dataset.ingredient = id;
          row.name.dataset.recipe = target.id;
          row.name.setAttribute("aria-label", `Select ${target.name} recipe; missing ${formatQuantity(shortage.missing, id, content)} ${content.resources[id].name}`);
        }
      }
      setText(previewSuffix, ` → ${describeAmounts(preview.rewards, content)}${preview.storage?.after ? ` · Cargo after: ${formatVolume(preview.storage.after.usedVolumeUnits)}` : ""}`);
    } else {
      if (previewRows.size) resetPreview();
      setText(previewText, visible.length ? "Fabricate components, then assemble finished products. Crafting completes immediately."
        : "Gather materials in Operations, then run experiments in Research to discover recipes.");
    }
    const actionStatus = getActionStatus("craftSelected");
    const missingText = preview.shortages.map(shortage => {
      const id = shortage.itemId;
      const target = ingredientRecipe(id, visible, preview.recipe?.id);
      return `${content.resources[id].name}: need ${formatQuantity(shortage.required, id, content)}, have ${formatQuantity(shortage.owned, id, content)}, short ${formatQuantity(shortage.missing, id, content)}${target ? "" : ` (${unavailableHint(id)})`}`;
    }).join("; ");
    const distinctBlocker = preview.requirementReason || (actionStatus.reason !== preview.reason ? actionStatus.reason : "");
    setText(requirement, visible.length ? missingText
      ? `Missing: ${missingText}.${distinctBlocker ? ` ${distinctBlocker}` : ""}`
      : preview.reason || actionStatus.reason || "Materials ready. The complete output fits in storage."
      : "Research a design to unlock fabrication.");
    button.disabled = Boolean(preview.reason) || !actionStatus.available;
    setText(button, preview.recipe ? (content.items[preview.recipe.output].category === "product" ? "Assemble" : "Fabricate") : "Craft");
  };
}
