import { definitionHasCapability } from './equipmentCatalog.js';
import { validateKnowledgeEntry, validateLearningPolicy } from './itemKnowledgePolicy.js';
import { matchesSlot } from './itemCatalog.js';

// Compile structural relationships once; admission and current status belong to queries.
export function compileItemKnowledgeCatalog({ content, world, processes = {} }) {
  const entries = {}, recipes = {}, uses = {}, processUses = {}, processOutputs = {}, machineUses = {};
  const add = (index,id,value) => (index[id] ??= []).push(value);
  const refs = { content, world };
  for (const item of Object.values(content.items)) {
    validateKnowledgeEntry(item.knowledgeEntry,refs,`items.${item.id}.knowledgeEntry`);
    entries[item.id] = { id:item.id, name:item.name, category:item.category,
      summary:item.knowledgeEntry?.summary ?? item.description ?? item.name, notes:item.knowledgeEntry?.notes ?? [],
      learnWhen:item.knowledgeEntry?.learnWhen };
    for (const source of item.acquisition) validateLearningPolicy(source.learnWhen,refs,`acquisition.${source.id}`);
    for (const operation of item.operations) {
      validateLearningPolicy(operation.learnWhen,refs,`operation.${operation.id}`);
      for (const [id,amount] of Object.entries(operation.cost ?? {})) if (content.items[id])
        add(machineUses,id,{ key:`operation:${item.id}:${operation.id}`, machineId:item.id, label:operation.name, amount, kind:'Operating consumable', conditions:operation.conditions, learnWhen:operation.learnWhen });
    }
    for (const [kind,records] of [['Maintenance',item.maintenance],['Upgrade',item.upgrades]]) for (const use of records)
      for (const [id,amount] of Object.entries(use.cost ?? {})) if (content.items[id]) add(machineUses,id,{
        key:`${kind.toLowerCase()}:${item.id}:${use.id}`, machineId:item.id, label:use.name, amount, kind, conditions:use.conditions });
  }
  for (const recipe of Object.values(content.recipes)) {
    validateLearningPolicy(recipe.learnWhen,refs,`recipe.${recipe.id}`);
    add(recipes,recipe.output,recipe);
    for (const slot of recipe.inputs) for (const item of Object.values(content.items)) if (matchesSlot(item,slot,content.items[recipe.output],recipe.id))
      add(uses,item.id,{ recipeId:recipe.id, slotId:slot.id });
  }
  for (const process of Object.values(processes)) {
    validateLearningPolicy(process.learnWhen,refs,`process.${process.id}`);
    if (process.kind !== 'refining') continue;
    for (const line of process.outputs) add(processOutputs,line.itemId,{ processId:process.id, amount:line.amount });
    for (const line of process.inputs) {
      add(processUses,line.itemId,{ processId:process.id, amount:line.amount });
      for (const [equipmentId,equipment] of Object.entries(content.infrastructure)) if (equipment.itemId && definitionHasCapability(content,equipmentId,process.capability))
        add(machineUses,line.itemId,{ key:`processMachine:${process.id}:${equipmentId}`, machineId:equipment.itemId, label:process.name, amount:line.amount, kind:'Process input', processId:process.id });
    }
  }
  for (const module of Object.values(content.vesselModules)) {
    for (const id of module.capabilities?.fuelStorage?.acceptedFuelItemIds ?? []) add(machineUses,id,{ key:`fuel:${module.id}`, machineId:module.id, label:'Compatible fuel cartridge', kind:'Vessel fuel', designDiscoveryId:module.designDiscoveryId });
    if (module.capabilities?.propulsion?.fuelItemId) add(machineUses,module.capabilities.propulsion.fuelItemId,{ key:`propulsionFuel:${module.id}`, machineId:module.id, label:'Propulsion fuel', kind:'Vessel fuel', designDiscoveryId:module.designDiscoveryId });
  }
  return { entries, recipes, uses, processUses, processOutputs, machineUses, processes };
}
