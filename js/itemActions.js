import { registerAction } from "./playerActions.js";
import { matchesSlot } from "./itemCatalog.js";
import { conditionReason } from "./conditionContext.js";
import { craft, previewRecipe, ingredientOptions, recipeVisible, selectRecipe, selectIngredient } from "./crafting.js";
import { describeAmounts, transfer, transferReason, previewExchange } from "./resources.js";
import { installEquipment, repairEquipment, upgradeEquipment, validateEquipment } from "./equipment.js";
import { setScopedFlag } from "./flags.js";
import { applyEffects } from "./effects.js";
import { installItem } from './itemInstallation.js';

const storeFor = (state, context) => context?.store ?? state;
const viewFor = (state, context) => context?.actionState ?? state;

export function previewInstallation(store, item, content) {
  try {
    const group = item.installation.group;
    const infrastructure = structuredClone(store.infrastructure);
    if (infrastructure[group].quantity >= (item.installation.limit ?? Number.MAX_SAFE_INTEGER)) throw new Error("Installation limit reached.");
    installEquipment(infrastructure, group);
    validateEquipment(infrastructure, content, message => { throw new Error(`Invalid ${message}.`); });
    return previewExchange(store, { [item.id]: 1 }, {}, content, infrastructure);
  } catch (error) { return { ok: false, reason: error.message }; }
}

// Return ordinary registry definitions; no second execution or persistence path.
export function createItemActions(content, effectServices, ledgerServices, world) {
  const actions = [];
  const allowed = (state, conditions) => !conditionReason(state, conditions, content);
  const add = action => actions.push({ access: "managed", ...action });
  for (const item of Object.values(content.items)) {
    for (const source of item.acquisition) {
      const cost = source.cost ?? {};
      const reward = { [item.id]: source.amount };
      add({ ...source, gathering: { itemId: item.id, amount: source.amount },
        description: `${describeAmounts(cost, content)}${Object.keys(cost).length ? " → " : "+"}${describeAmounts(reward, content)}`,
        visible: state => allowed(state, source.conditions),
        requirement: state => transferReason(state, cost, reward, content),
        execute(state, context) { transfer(storeFor(state, context), cost, reward, content); return `Recovered ${describeAmounts(reward, content)}.`; } });
    }
    if (item.installation) {
      const installation = item.installation;
      add({ id: `install:${item.id}`, name: `Install ${item.name.toLowerCase()}`, order: 70,
        description: `1 ${item.name.toLowerCase()}`,
        visible: state => state.resources[item.id] > 0 && allowed(state, installation.conditions) &&
          state.infrastructure[installation.group].quantity < (installation.limit ?? Infinity),
        requirement: state => previewInstallation(state, item, content).reason,
        execute(state, context) {
          if (world) {
            installItem(state,{ itemId:item.id,sourceLocationId:state.locationId,targetLocationId:state.locationId },{ content,world });
            return `Installed ${item.name.toLowerCase()}.`;
          }
          if (context?.local?.assembly) throw new Error('Vessel equipment must be installed through its module composition.');
          const store = storeFor(state, context);
          const preview = previewInstallation(store, item, content);
          if (!preview.ok) throw new Error(preview.reason);
          transfer(store, { [item.id]: 1 }, {}, content);
          installEquipment(store.infrastructure, installation.group);
          return `Installed ${item.name.toLowerCase()}.`;
        } });
    }
    for (const operation of item.operations) {
      const cost = operation.cost ?? {};
      add({ ...operation, order: operation.order ?? 80, description: describeAmounts(cost, content),
        visible: state => state.infrastructure[item.installation.group].quantity > 0 &&
          !(operation.once && (operation.completion.scope === "location" ? state.localFlags : state.flags)[operation.completion.flag]) && allowed(state, operation.conditions),
        requirement: state => conditionReason(state, { equipment: [item.installation.group] }, content) || transferReason(state, cost, {}, content),
        execute(state, context) {
          const trigger = { kind: "item", locationId: context?.id ?? state.locationId, actorId: 'player' };
          transfer(storeFor(state, context), cost, {}, content);
          applyEffects(state, operation.effects, effectServices, trigger);
          if (operation.once) setScopedFlag(state, operation.completion.scope, trigger.locationId, operation.completion.flag);
          return operation.message ?? `${operation.name} complete.`;
        } });
    }
    for (const repair of item.maintenance) {
      add({ ...repair, description: describeAmounts(repair.cost ?? {}, content),
        visible: state => state.infrastructure[repair.target].quantity > 0 && state.infrastructure[repair.target].health < 1 && (repair.showLocked || allowed(state, repair.conditions)),
        requirement: state => (conditionReason(state, repair.conditions, content) ? repair.blockedReason || conditionReason(state, repair.conditions, content) : "") || transferReason(state, repair.cost ?? {}, {}, content),
        execute(state, context) {
          const store = storeFor(state, context);
          const previousHealth = store.infrastructure[repair.target].health;
          transfer(store, repair.cost ?? {}, {}, content);
          repairEquipment(store.infrastructure, repair.target);
          if (previousHealth < 1) {
            const locationId = context?.id ?? state.locationId;
            ledgerServices?.append(state, { type: 'EQUIPMENT_REPAIRED', actorId: 'player', targetId: locationId,
              locationId, areaId: state.locations[locationId].areaId,
              data: { equipmentId: repair.target, previousHealth, health: 1 } });
          }
          return `${content.infrastructure[repair.target].name} is fully operational.`;
        } });
    }
    for (const upgrade of item.upgrades) {
      add({ ...upgrade, id: `upgrade:${item.id}:${upgrade.id}`, order: upgrade.order ?? 90,
        description: describeAmounts(upgrade.cost ?? {}, content),
        visible: state => state.infrastructure[item.installation.group].quantity > 0 &&
          !state.infrastructure[item.installation.group].upgrades.includes(upgrade.id) && allowed(state, upgrade.conditions),
        requirement: state => transferReason(state, upgrade.cost ?? {}, {}, content),
        execute(state, context) {
          const store = storeFor(state, context);
          transfer(store, upgrade.cost ?? {}, {}, content);
          upgradeEquipment(store.infrastructure, item.installation.group, upgrade.id);
          return `${upgrade.name} complete.`;
        } });
    }
  }
  for (const recipe of Object.values(content.recipes)) {
    add({ id: `selectRecipe:${recipe.id}`, name: `Select ${recipe.name} (${recipe.id})`, group: "selection", scope: "global",
      visible: state => recipeVisible(state, recipe, content),
      execute(state) { selectRecipe(state, recipe.id); } });
    if (recipe.directive) add({ ...recipe.directive,
      description: recipe.name,
      visible: state => recipe.directive.showLocked || allowed(state, recipe.conditions),
      requirement: state => (conditionReason(state, recipe.conditions, content) ? recipe.directive.blockedReason || conditionReason(state, recipe.conditions, content) : "") || previewRecipe(state, recipe.id, {}, content).reason,
      execute: (state, context) => craft(viewFor(state, context), recipe.id, {}, content, storeFor(state, context)) });
    for (const slot of recipe.inputs) {
      // Structural options are independent of knowledge; live checks gate their use.
      for (const item of Object.values(content.items).filter(item => matchesSlot(item, slot, content.items[recipe.output], recipe.id))) {
        add({ id: `selectIngredient:${recipe.id}:${slot.id}:${item.id}`,
          name: `Select ${item.id} for ${recipe.id} ${slot.id}`, group: "selection", scope: "global",
          visible: state => state.crafting.recipeId === recipe.id && recipeVisible(state, recipe, content) &&
            ingredientOptions(state, recipe, slot, content).some(option => option.id === item.id && !option.reason),
          execute(state) { selectIngredient(state, slot.id, item.id); } });
      }
    }
  }
  add({ id: "craftSelected", name: "Craft selected recipe", aliases: ["craft"], group: "crafting",
    requirement: state => previewRecipe(state, state.crafting.recipeId, state.crafting.ingredients, content).reason,
    execute: (state, context) => craft(viewFor(state, context), state.crafting.recipeId, state.crafting.ingredients, content, storeFor(state, context)) });
  // Validate the entire generated batch before registering any of it.

  const ids = new Set();
  for (const action of actions) {
    if (typeof action.id !== "string" || !action.id.trim() || typeof action.name !== "string" || !action.name.trim() || ids.has(action.id)) {
      throw new Error(`Invalid or duplicate generated action: ${action.id}`);
    }
    ids.add(action.id);
    if (action.aliases !== undefined && (!Array.isArray(action.aliases) || action.aliases.some(alias => typeof alias !== "string" || !alias.trim()))) {
      throw new Error(`Invalid aliases for ${action.id}`);
    }
    if ((action.shortcut && !/^[1-9]$/.test(action.shortcut)) || !Number.isFinite(action.order ?? 0)) throw new Error(`Invalid action metadata: ${action.id}`);
  }
  // Handlers receive an explicit local view; selection writes stay at root.
  return actions.map(action => ({ ...action,
    permissions: action.group === "selection" ? [] : action.id.startsWith("install:") || action.id.startsWith("upgrade:") || Object.values(content.items).some(i => [...i.operations, ...i.maintenance].some(a => a.id === action.id))
      ? ["manageEquipment", "withdrawCargo"] : ["useFacilities", "withdrawCargo", "depositCargo"],
    collection: action.group === "crafting" || Object.values(content.recipes).some(r => r.directive?.id === action.id) ? "crafting"
      : action.id.startsWith("install:") || action.id.startsWith("upgrade:") || Object.values(content.items).some(i => [...i.operations, ...i.maintenance].some(a => a.id === action.id)) ? "equipment" : undefined,
    visible: (state, context) => action.id.startsWith('install:') && context?.local?.assembly ? false : action.visible ? action.visible(context?.actionState ?? state) : true,
    requirement: (state, context) => action.requirement ? action.requirement(viewFor(state, context)) : ""
  }));
}

export function registerItemActions(content, effectServices, ledgerServices) {
  createItemActions(content, effectServices, ledgerServices).forEach(registerAction);
}
