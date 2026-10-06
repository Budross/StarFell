import { matchesSlot } from "./itemCatalog.js";
import { checkedAdd, roleQuantity } from "./quantities.js";
import { conditionReason } from "./conditionContext.js";
import { describeAmounts, transfer, previewExchange, quantity } from "./resources.js";
// Compatibility exports; generic exchanges belong to resources.
export { describeAmounts, transfer, transferReason } from "./resources.js";

export function ingredientOptions(state, recipe, slot, content) {
  return Object.values(content.items).filter(item => matchesSlot(item, slot, content.items[recipe.output], recipe.id))
    .map(item => ({ id: item.id, name: item.name,
      quantity: slot.role ? roleQuantity(slot.quantity, item.roles[slot.role], item.category === "resource") : slot.quantity,
      reason: slot.role ? conditionReason(state, item.roles[slot.role].conditions, content) : "" }));
}

export function previewRecipe(state, recipeId, selections = {}, content) {
  try { return recipePreview(state, recipeId, selections, content); }
  catch (error) { return { reason: error.message, slots: [], cost: {}, rewards: {}, shortages: [] }; }
}
function recipePreview(state, recipeId, selections = {}, content) {
  const recipe = content.recipes[recipeId];
  if (!recipe) return { reason: "Select a recipe.", slots: [], cost: {}, rewards: {}, shortages: [] };
  let reason = (state.permissions ? !["useFacilities", "withdrawCargo", "depositCargo"].every(p => state.permissions[p]) : state.managedAccess === false) ? "Requires crafting permissions (ownership or grants)." : conditionReason(state, recipe.conditions, content);
  if(recipe.retiredWhen&&!conditionReason(state,recipe.retiredWhen,content))reason||='This recovery shortcut is replaced by the available industrial material route.';
  const cost = { ...recipe.cost };
  const slots = recipe.inputs.map(slot => {
    const options = ingredientOptions(state, recipe, slot, content);
    const selectedId = selections[slot.id] ?? slot.defaultItem ?? slot.item ?? options.find(option => !option.reason)?.id;
    const selected = options.find(option => option.id === selectedId);
    if (!selected) reason ||= `Select a compatible ingredient for ${slot.id}.`;
    else {
      reason ||= selected.reason;
      cost[selected.id] = checkedAdd(cost[selected.id] ?? 0, selected.quantity);
    }
    return { ...slot, options, selectedId, selected };
  });
  const rewards = { [recipe.output]: recipe.amount };
  const shortages = Object.entries(cost).flatMap(([itemId, required]) => {
    const owned = quantity(state, itemId, content);
    return owned < required ? [{ itemId, required, owned, missing: required - owned }] : [];
  });
  const requirementReason = reason;
  const exchange = previewExchange(state, cost, rewards, content);
  reason ||= exchange.reason;
  return { recipe, slots, cost, rewards, shortages, requirementReason, reason, storage: exchange };
}

export function craft(state, recipeId, selections, content, store = state) {
  const preview = previewRecipe(state, recipeId, selections, content);
  if (preview.reason) throw new Error(preview.reason);
  transfer(store, preview.cost, preview.rewards, content);
  return `Created ${describeAmounts(preview.rewards, content)}.`;
}

export function recipeVisible(state, recipe, content) {
  return !conditionReason(state, { ...recipe.conditions, equipment: [], capabilities: [] }, content);
}

export function visibleRecipes(state, content) {
  return Object.values(content.recipes).filter(recipe => recipeVisible(state, recipe, content));
}

// Match compiled outputs so contributed recipes work just like item-owned recipes.
export function ingredientRecipe(itemId, recipes, currentRecipeId) {
  return recipes.find(recipe => recipe.output === itemId && recipe.id !== currentRecipeId) ?? null;
}

export function selectRecipe(state, recipeId) {
  state.crafting = { recipeId, ingredients: {} };
}

export function selectIngredient(state, slotId, itemId) {
  state.crafting.ingredients[slotId] = itemId;
}
