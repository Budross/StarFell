import { validateConditions, conditionContracts, record, safeKey } from "./conditions.js";
import { collectDiscoveryReferences, conditionEntityReferences } from "./conditionReferences.js";
import { compileEffects, describeEffects } from "./effects.js";
import { volumeUnits, compileQuantity, decimalRatio, fromBigInt } from "./quantities.js";
import { validateNarrativeMetadata } from './narrative/narrativeMetadata.js';
import { validateKnowledgeEntry, validateLearningPolicy } from './itemKnowledgePolicy.js';
import { operationForCategory, manufacturingInputAllowed } from './manufacturing.js';
import { compileItemDesigns } from './itemDesignCatalog.js';
import { EQUIPMENT_CAPABILITY_CONTRACTS, createEquipmentCapabilityContracts, compileEquipmentCapabilities } from './equipmentCapabilityContracts.js';
import { compileEquipmentCatalog } from './equipmentCatalog.js';
import { compileShipEquipment } from './shipEquipment.js';
export { conditionReason } from "./conditionContext.js";
const categories = new Set(["resource", "component", "product"]);
export function itemProducerMetadata(content) {
  return Object.values(content.items).flatMap(item=>item.operations.filter(o=>o.once).map(o=>({kind:'flag',scope:o.completion.scope,targetId:o.completion.scope==='location'?'*':undefined,flag:o.completion.flag,value:true})));
}
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const idPattern = /^[A-Za-z][A-Za-z0-9_-]*$/;
function check(ok, message) { if (!ok) throw new Error(`Invalid catalog: ${message}`); }
function strings(value) { return Array.isArray(value) && value.every(entry => typeof entry === "string" && entry.length > 0); }
function positive(value) { return Number.isSafeInteger(value) && value > 0; }

// Compilation is independent of game state and runs once, not on every render.
export function buildCatalog(source, { equipmentContracts = EQUIPMENT_CAPABILITY_CONTRACTS } = {}) {
  try { return compileCatalog(source, createEquipmentCapabilityContracts(Object.values(equipmentContracts))); }
  catch (error) { throw Object.assign(new Error(error.message.startsWith("Invalid catalog:") ? error.message : `Invalid catalog: ${error.message}`,{cause:error}),{path:error.path}); }
}
function compileCatalog(source, equipmentContracts) {
  check(object(source) && object(source.items), "items must be an object.");
  check(strings(source.recipeCapabilities ?? []), "recipe capabilities must be strings.");
  const conditionSources = [];
  const items = structuredClone(source.items);
  const resources = structuredClone(source.utilities ?? {});
  const infrastructure = structuredClone(source.infrastructure ?? {});
  const recipes = {};
  const roles = {};
  const utilities = Object.keys(resources);
  const quantityContent = { items, resources, infrastructure, utilities, equipmentContracts, equipmentAliases: { radio: 'radioCommunication' } };
  const validId = id => check(typeof id === "string" && idPattern.test(id) && !["constructor", "prototype", "__proto__"].includes(id), `invalid ID ${id}.`);
  for (const [id, item] of Object.entries(items)) {
    validId(id);
    check(!Object.hasOwn(resources, id), `item/utility collision ${id}.`);
    check(object(item) && categories.has(item.category), `category for ${id}.`);
    check(typeof item.name === "string" && item.name.trim().length > 0, `name for ${id}.`);
    check(item.baseCapacity === undefined, `physical baseCapacity is obsolete for ${id}.`);
    if (item.category === "resource") {
      check(item.unitVolumeM3 === undefined, `bulk ${id} cannot define unitVolumeM3.`);
      item.researchSampleVolumeUnits = volumeUnits(item.researchSampleM3);
      check(positive(item.researchSampleVolumeUnits), `research sample for ${id}.`);
    } else {
      check(item.researchSampleM3 === undefined, `counted ${id} uses one research sample.`);
      item.unitVolumeUnits = volumeUnits(item.unitVolumeM3);
      check(positive(item.unitVolumeUnits), `volume for ${id}.`);
    }
    item.id = id;
    validateKnowledgeEntry(item.knowledgeEntry, { content: quantityContent, conditionSources }, `items.${id}.knowledgeEntry`);
    item.initialQuantity ??= 0;
    item.tags ??= [];
    item.roles ??= {};
    check(strings(item.tags) && object(item.roles), `tags or roles for ${id}.`);
    for (const [role, approval] of Object.entries(item.roles)) {
      validId(role);
      check(object(approval), `role ${role} on ${id}.`);
      if (item.category === "resource") {
        check(approval.units === undefined, `bulk role ${id} requires unitsPerM3.`);
        const ratio = decimalRatio(approval.unitsPerM3, true);
        check(ratio.numerator > 0n, `role contribution for ${id}.`);
        approval.contributionNumerator = fromBigInt(ratio.numerator);
        approval.contributionDenominator = fromBigInt(ratio.denominator);
      } else {
        check(approval.unitsPerM3 === undefined, `counted role ${id} requires units.`);
        approval.units ??= 1;
        check(positive(approval.units), `role contribution for ${id}.`);
      }
      (roles[role] ??= []).push(id);
    }
    resources[id] = item;
    for (const key of ["recipes", "recipeContributions", "acquisition", "operations", "maintenance", "upgrades"]) {
      item[key] ??= [];
      check(Array.isArray(item[key]), `${key} for ${id}.`);
    }
    check(item.category === "product" || (!item.installation && !item.operations.length && !item.maintenance.length && !item.upgrades.length),
      `only products can install, operate, or maintain equipment (${id}).`);
    if (item.installation) {
      const install = item.installation;
      validId(install.group);
      check(!Object.hasOwn(infrastructure, install.group), `duplicate infrastructure ${install.group}.`);
      check(install.limit === undefined || positive(install.limit), `installation limit for ${id}.`);
      infrastructure[install.group] = { ...install, name: item.name, itemId: id, initialQuantity: 0, powerPerSecond: install.powerPerSecond ?? 0 };
    }
    for (const [contribution, list] of [[false, item.recipes], [true, item.recipeContributions]]) {
      for (const recipe of list) {
        validId(recipe.id);
        const recipeId = `${id}:${recipe.id}`;
        check(!Object.hasOwn(recipes, recipeId), `duplicate recipe ${recipeId}.`);
        const output = contribution ? recipe.output : id;
        check(typeof output === "string", `output for ${recipeId}.`);
        recipes[recipeId] = { ...recipe, id: recipeId, owner: id, output, amount: recipe.amount ?? 1 };
      }
    }
  }
  const vesselModules = compileVesselModules(items, infrastructure, equipmentContracts);
  for (const [id, resource] of Object.entries(resources)) {
    validId(id);
    check(typeof resource.name === "string" && (!utilities.includes(id) || positive(resource.baseCapacity)), `storage definition ${id}.`);
    resource.id = id;
    resource.initialQuantity ??= 0;
    resource.initialQuantity = compileQuantity(resource.initialQuantity, id, quantityContent);
    check(!utilities.includes(id) || resource.initialQuantity <= resource.baseCapacity,
      `initial quantity for ${id}.`);
  }
  for (const [id, machine] of Object.entries(infrastructure)) {
    validId(id);
    validateNarrativeMetadata(machine.narrative,'equipment');
    machine.powerPerSecond ??= 0;
    machine.initialQuantity ??= 0;
    machine.initialHealth ??= 1;
    compileShipEquipment(machine, `infrastructure.${id}`);
    machine.capabilities = compileEquipmentCapabilities(machine.capabilities, equipmentContracts, `infrastructure.${id}.capabilities`);
    if (machine.itemId && items[machine.itemId].installation) items[machine.itemId].installation.capabilities = structuredClone(machine.capabilities);
    if (machine.processing !== undefined) {
      check(object(machine.processing) && Object.keys(machine.processing).every(k => ['speedMultiplier','powerMultiplier'].includes(k)), `processing metadata for ${id}.`);
      machine.processing.speedMultiplier ??= 1; machine.processing.powerMultiplier ??= 1;
      check(Number.isFinite(machine.processing.speedMultiplier) && machine.processing.speedMultiplier > 0 && Number.isFinite(machine.processing.powerMultiplier) && machine.processing.powerMultiplier >= 0, `processing multipliers for ${id}.`);
    }
    machine.travelSpeed ??= 0;
    if (machine.capacityBonus !== undefined) {
      check(object(machine.capacityBonus), `capacity bonus for ${id}.`);
      for (const [asset, amount] of Object.entries(machine.capacityBonus)) {
        check(utilities.includes(asset) && positive(amount), `capacity bonus ${id}/${asset} must target a utility.`);
      }
    }
    if (machine.storageBonusM3 !== undefined) {
      machine.storageBonusVolumeUnits = volumeUnits(machine.storageBonusM3);
      check(positive(machine.storageBonusVolumeUnits), `storage bonus for ${id}.`);
    }
    check(Number.isFinite(machine.travelSpeed) && machine.travelSpeed >= 0, `travel speed for ${id}.`);
    check(Number.isFinite(machine.powerPerSecond), `infrastructure behavior for ${id}.`);
    check(Number.isSafeInteger(machine.initialQuantity) && machine.initialQuantity >= 0 &&
      Number.isFinite(machine.initialHealth) && machine.initialHealth >= 0 && machine.initialHealth <= 1, `initial infrastructure ${id}.`);
  }
  function conditions(value = {}, path) {
    validateConditions(value, { content: quantityContent, contract:conditionContracts.state, conditionSources }, path);
  }
  function cost(value = {}, componentsOnly = false, utilitiesOnly = false) {
    check(object(value), "cost must be an object.");
    for (const [id, amount] of Object.entries(value)) {
      check(Object.hasOwn(resources, id) && Number.isFinite(amount) && amount > 0, `cost ${id}.`);
      check(items[id]?.category !== "product", `product ${id} must be equipment, not a consumable cost.`);
      if (componentsOnly) check(items[id]?.category === "component", `maintenance/upgrade ingredient ${id} must be a component.`);
      if (utilitiesOnly) check(utilities.includes(id), `recipe operating cost ${id} must be a utility.`);
      value[id] = compileQuantity(amount, id, quantityContent);
    }
  }
  for (const recipe of Object.values(recipes)) {
    const output = items[recipe.output];
    check(output && output.category !== "resource", `recipe ${recipe.id} cannot output a resource or unknown item.`);
    const operation = operationForCategory(output.category);
    check(recipe.operation === undefined || recipe.operation === operation, `manufacturing operation for ${recipe.id}.`);
    recipe.operation = operation;
    check(typeof recipe.name === "string" && recipe.name.length > 0 && positive(recipe.amount), `recipe identity/yield ${recipe.id}.`);
    check(Array.isArray(recipe.inputs) && recipe.inputs.length > 0, `inputs for ${recipe.id}.`);
    conditions(recipe.conditions, `items.${recipe.owner}.recipes.${recipe.id.split(":")[1]}.conditions`);
    if(recipe.retiredWhen!==undefined)conditions(recipe.retiredWhen,`items.${recipe.owner}.recipes.${recipe.id.split(':')[1]}.retiredWhen`);
    validateLearningPolicy(recipe.learnWhen, { content: quantityContent, conditionSources }, `recipe.${recipe.id}.learnWhen`);
    recipe.conditions = { ...recipe.conditions, capabilities: [...new Set([...(recipe.conditions?.capabilities ?? []), ...(source.recipeCapabilities ?? [])])] };
    conditions(recipe.conditions, `items.${recipe.owner}.recipes.${recipe.id.split(":")[1]}.conditions`);
    cost(recipe.cost, false, true);
    const slotIds = new Set();
    for (const slot of recipe.inputs) {
      validId(slot.id);
      check(!slotIds.has(slot.id), `duplicate slot ${slot.id}.`);
      slotIds.add(slot.id);
      check(Boolean(slot.item) !== Boolean(slot.role), `slot ${slot.id} needs an item or role.`);
      slot.quantity = slot.item ? compileQuantity(slot.quantity, slot.item, quantityContent) : slot.quantity;
      check(positive(slot.quantity), `slot ${slot.id} needs a positive quantity.`);
      check(strings(slot.tags ?? []) && strings(slot.excludeTags ?? []), `slot properties ${slot.id}.`);
      if (slot.item) {
        check(items[slot.item] && items[slot.item].category !== "product", `invalid ingredient ${slot.item}.`);
        check(manufacturingInputAllowed(items[slot.item].category, operation), `invalid manufacturing ingredient for ${recipe.output}.`);
      } else check(roles[slot.role]?.length > 0, `unknown role ${slot.role}.`);
      const candidates = Object.values(items).filter(item => matchesSlot(item, slot, output, recipe.id));
      check(candidates.length > 0, `no legal ingredients for ${recipe.id}/${slot.id}.`);
      if (slot.defaultItem) check(candidates.some(item => item.id === slot.defaultItem), `invalid default for ${recipe.id}/${slot.id}.`);
    }
  }
  for (const item of Object.values(items)) {
    for (const [roleId,approval] of Object.entries(item.roles)) {
      conditions(approval.conditions, `items.${item.id}.roles.${roleId}.conditions`);
      if (approval.recipes !== undefined) check(strings(approval.recipes) && approval.recipes.every(id => Object.hasOwn(recipes, id)), `recipe restriction for ${item.id}.`);
    }
    if (item.installation) conditions(item.installation.conditions, `items.${item.id}.installation.conditions`);
    for (const method of item.acquisition) {
      validateLearningPolicy(method.learnWhen, { content: quantityContent, conditionSources }, `acquisition.${method.id}.learnWhen`);
      method.amount = compileQuantity(method.amount, item.id, quantityContent);
      check(positive(method.amount), `acquisition yield for ${item.id}.`);
      conditions(method.conditions, `items.${item.id}.acquisition.${item.acquisition.indexOf(method)}.conditions`);
      cost(method.cost);
    }
    for (const operation of item.operations) {
      validateLearningPolicy(operation.learnWhen, { content: quantityContent, conditionSources }, `operation.${operation.id}.learnWhen`);
      check(item.installation, `operation on ${item.id} needs installation.`);
      conditions(operation.conditions, `items.${item.id}.operations.${item.operations.indexOf(operation)}.conditions`);
      cost(operation.cost);
      check(!(Object.hasOwn(operation, "effect") && Object.hasOwn(operation, "effects")), `both effect and effects on ${item.id}.`);
      check(operation.once === undefined || typeof operation.once === "boolean", `invalid once on ${item.id}.`);
      if (Object.hasOwn(operation, "effect")) {
        const legacy = operation.effect;
        check(legacy?.type === "setFlag", `unsupported operation effect for ${item.id}.`);
        validId(legacy.flag);
        check(legacy.scope === undefined || ["global", "local"].includes(legacy.scope), `invalid effect scope for ${item.id}.`);
        const scope = legacy.scope === "local" ? "location" : "global";
        if (operation.once) {
          check(operation.completion === undefined || operation.completion.scope === scope && operation.completion.flag === legacy.flag,
            `legacy completion identity changed on ${item.id}.`);
          operation.completion = { scope, flag: legacy.flag };
        }
        operation.effects = [{ type: "setFlag", scope, flag: legacy.flag, value: true, ...(scope === "location" ? { target: "current" } : {}) }];
        delete operation.effect;
      }
      check(Array.isArray(operation.effects), `operation on ${item.id} needs effects.`);
      operation.effects = compileEffects(operation.effects, { content: quantityContent, conditionSources }, { kind: "item" }, `items.${item.id}.operations.${operation.id}.effects`);
      if (operation.once) {
        const completion = operation.completion;
        check(record(completion) && Object.keys(completion).every(k => ["scope", "flag"].includes(k)) &&
          ["global", "location"].includes(completion.scope) && safeKey(completion.flag), `one-time operation on ${item.id} needs completion scope and flag.`);
        check(!describeEffects(operation.effects).some(m => m.kind === "flagWrite" && m.scope === completion.scope &&
          m.flag === completion.flag && m.value !== true), `conflicting completion reward on ${item.id}.`);
      } else check(operation.completion === undefined, `completion requires once on ${item.id}.`);
    }
    for (const repair of item.maintenance) {
      check(Object.hasOwn(infrastructure, repair.target), `repair target for ${item.id}.`);
      cost(repair.cost, true);
      conditions(repair.conditions, `items.${item.id}.maintenance.${item.maintenance.indexOf(repair)}.conditions`);
    }
    for (const upgrade of item.upgrades) {
      upgrade.travelSpeedBonus ??= 0;
      check(Number.isFinite(upgrade.travelSpeedBonus) && upgrade.travelSpeedBonus >= 0, `travel speed upgrade for ${item.id}.`);
      check(item.installation && Number.isFinite(upgrade.powerBonus), `unsupported upgrade for ${item.id}.`);
      validId(upgrade.id);
      cost(upgrade.cost, true);
      conditions(upgrade.conditions, `items.${item.id}.upgrades.${item.upgrades.indexOf(upgrade)}.conditions`);
    }
    check(new Set(item.upgrades.map(upgrade => upgrade.id)).size === item.upgrades.length, `duplicate upgrade on ${item.id}.`);
  }
  const conditionInputs = [
    ...Object.values(items).flatMap(item => [item.knowledgeEntry?.learnWhen?.conditions,
      ...(item.knowledgeEntry?.notes ?? []).map(n => n.learnWhen?.conditions),
      ...[...item.acquisition,...item.operations].map(a => a.learnWhen?.conditions)]),
    ...Object.values(recipes).map(r => r.learnWhen?.conditions),
    ...Object.values(recipes).map(recipe => recipe.conditions),
    ...Object.values(items).flatMap(item => [item.installation?.conditions,
      ...Object.values(item.roles).map(role => role.conditions),
      ...[...item.acquisition, ...item.operations, ...item.maintenance, ...item.upgrades].map(action => action.conditions)])
  ];
  const effectMetadata = Object.values(items).flatMap(item => item.operations.flatMap(operation =>
    describeEffects(operation.effects, `items.${item.id}.operations.${operation.id}.effects`)));
  const discoveryReferences = collectDiscoveryReferences([...conditionInputs, ...Object.values(vesselModules).map(m => ({ discoveries: [m.designDiscoveryId] }))], effectMetadata.filter(m => m.kind === "discovery" && m.access === "produce").map(m => m.id));
  const entityReferences = [...conditionInputs.flatMap(c => conditionEntityReferences(c, "items")),
    ...effectMetadata.filter(m => m.kind === "entity" && !["current", "speaker"].includes(m.targetId))];
  const effectSources = Object.values(items).flatMap(item => item.operations.map(operation => ({
    path: `items.${item.id}.operations.${operation.id}.effects`, effects: operation.effects, trigger: { kind: "item" }
  })));
  const result = { ...quantityContent, conditionSources, recipes, roles, vesselModules, discoveryReferences, entityReferences, effectSources, designs: compileItemDesigns(items) };
  result.equipment = compileEquipmentCatalog(result);
  return result;
}

export function matchesSlot(item, slot, output, recipeId) {
  if (!manufacturingInputAllowed(item.category, operationForCategory(output.category))) return false;
  if (slot.item ? item.id !== slot.item : !Object.hasOwn(item.roles, slot.role)) return false;
  if (slot.role && item.roles[slot.role].recipes && !item.roles[slot.role].recipes.includes(recipeId)) return false;
  return (slot.tags ?? []).every(tag => item.tags.includes(tag)) && !(slot.excludeTags ?? []).some(tag => item.tags.includes(tag));
}
import { compileVesselModules } from './vesselModuleCatalog.js';
