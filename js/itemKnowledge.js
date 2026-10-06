import { compileItemKnowledgeCatalog } from './itemKnowledgeCatalog.js';
import { encounterItem, learnItemFact } from './itemKnowledgeState.js';
import { conditionReason } from './conditionContext.js';
import { ingredientOptions, recipeVisible } from './crafting.js';
import { getLocationContext, isKnown } from './locations.js';
import { locationInstances, locationDefinition, getEntityLabel } from './entityQueries.js';
import { canUse, ownerOf } from './authority.js';
import { installationTargets, previewItemInstallation } from './itemInstallation.js';
import { describeItemDesign } from './itemDesignCatalog.js';
import { createEquipmentQueries } from './equipmentQuery.js';

export function createItemKnowledgeSystem(services) {
  const { content,world } = services;
  const equipmentQueries = services.equipment ?? createEquipmentQueries(content);
  const catalog = compileItemKnowledgeCatalog(services);
  const knows = (state,id,key) => state.knowledge.itemEntries?.[id]?.facts[key] === true;
  const policyMet = (state,policy,encountered = false,view) => !policy || policy.onEncounter && encountered ||
    policy.conditions !== undefined && !conditionReason(view ?? getLocationContext(state,content,world).actionState,policy.conditions,content);
  const hasLocalEvidence = (conditions = {}) => !!conditions.localFlags?.length || (conditions.all ?? []).some(hasLocalEvidence) || (conditions.any ?? []).some(hasLocalEvidence) || conditions.not && hasLocalEvidence(conditions.not);
  const fact = (state,id,key) => learnItemFact(state,id,key);
  const equipmentReadable = (state,id) => canUse(state,'player',id,'manageEquipment') || canUse(state,'player',id,'useFacilities');
  const surveyDefinitions = new Set(Object.values(world.definitions).filter(d => Object.values(d.resourceNodes ?? {}).some(n => n.learnWhen)).map(d => d.id));
  let lastLearningSignature = '';
  function learningSignature(state) {
    const local=state.locations[state.locationId];
    return JSON.stringify([state.locationId,state.knowledge,state.mapKnowledge,state.flags,state.entities,state.dialogue,
      Object.entries(state.npcs).map(([id,npc]) => [id,npc.flags]),
      Object.entries(state.locations).map(([id,host]) => [id,host.flags,host.areaId,host.dockedAtId,!!host.journey,
        surveyDefinitions.has(state.entities[id]?.definition?.id) ? host.infrastructure : null]),
      Object.entries(local.resources).filter(([,amount]) => amount > 0).map(([id]) => id),local.infrastructure]);
  }

  function learn(state) {
    if (!state.knowledge.itemEntries) return false;
    const signature=learningSignature(state);
    if (signature === lastLearningSignature) return false;
    let changed = false;
    const grant = (id,key) => { changed = fact(state,id,key) || changed; };
    const encounter = id => { changed = encounterItem(state,id) || changed; };
    const current = getLocationContext(state,content,world);
    // Only current perception and explicit persistent evidence teach source facts.
    if (current.permissions.viewCargo) for (const [id,amount] of Object.entries(current.store.resources)) if (amount > 0 && content.items[id]) encounter(id);
    if (equipmentReadable(state,current.id)) for (const [group,value] of Object.entries(current.local.infrastructure)) {
      const itemId = content.infrastructure[group]?.itemId;
      if (value.quantity > 0 && itemId) encounter(itemId);
    }
    for (const entry of Object.values(catalog.entries)) {
      if (entry.learnWhen && policyMet(state,entry.learnWhen,!!state.knowledge.itemEntries[entry.id])) encounter(entry.id);
    }
    for (const recipe of Object.values(content.recipes)) {
      if (!knows(state,recipe.output,`recipe:${recipe.id}`) && recipeVisible(current.actionState,recipe,content) &&
        policyMet(state,recipe.learnWhen,!!state.knowledge.itemEntries[recipe.output])) grant(recipe.output,`recipe:${recipe.id}`);
      if (!knows(state,recipe.output,`recipe:${recipe.id}`)) continue;
      for (const slot of recipe.inputs) for (const option of ingredientOptions(current.actionState,recipe,slot,content)) if (!option.reason)
        grant(option.id,`ingredient:${recipe.id}:${slot.id}`);
    }
    for (const process of Object.values(catalog.processes)) {
      // Start conditions retain their full expression. Knowledge survives subsequent blockers.
      if (process.kind === 'refining' && !conditionReason(current.actionState,process.startConditions,content) &&
        policyMet(state,process.learnWhen,(process.outputs ?? []).some(line => state.knowledge.itemEntries[line.itemId]))) {
        for (const line of process.outputs) grant(line.itemId,`process:${process.id}`);
        for (const line of process.inputs) grant(line.itemId,`processInput:${process.id}`);
      }
    }
    for (const [id,relations] of Object.entries(catalog.machineUses)) for (const use of relations) {
      if (!state.knowledge.itemEntries[id]) continue;
      const admitted = use.processId ? knows(state,id,`processInput:${use.processId}`) : use.designDiscoveryId
        ? state.knowledge.discoveries[use.designDiscoveryId] === true
        : state.knowledge.itemEntries[use.machineId] && !conditionReason(current.actionState,use.conditions,content) && policyMet(state,use.learnWhen,true);
      if (admitted) { encounter(use.machineId); grant(id,use.key); }
    }
    // The occupied site and its berth can be observed; no scan of private world inventories.
    const nearby = [current.id, ...(current.definition.mobile && current.local.dockedAtId ? [current.local.dockedAtId] : [])];
    const sourceDefinitions=nearby.filter(id => state.entities[id]?.lifecycle === 'active').map(id => locationDefinition(state,world,id));
    if (surveyDefinitions.size) for (const entity of Object.values(state.entities)) if (entity.lifecycle === 'active' &&
      surveyDefinitions.has(entity.definition?.id) && !nearby.includes(entity.id)) sourceDefinitions.push(locationDefinition(state,world,entity.id));
    for (const def of sourceDefinitions) {
      const localObservation = nearby.includes(def.id) && canUse(state,'player',def.id,'useFacilities');
      for (const [nodeId,node] of Object.entries(def.resourceNodes ?? {})) {
        const explicitlyTaught = node.learnWhen && policyMet(state,node.learnWhen,!!state.knowledge.itemEntries[node.resourceId],getLocationContext(state,content,world,def.id).actionState);
        if (!isKnown(state,world,content,def.id) || !(node.learnWhen ? explicitlyTaught : localObservation)) continue;
        grant(node.resourceId,`node:${def.id}:${nodeId}`);
        for (const process of Object.values(catalog.processes)) if (process.kind === 'extraction' && process.sourceRequirements.tags.every(t => node.tags.includes(t)) &&
          !conditionReason(current.actionState,process.startConditions,content) && policyMet(state,process.learnWhen,true))
          grant(node.resourceId,`extraction:${process.id}:${def.id}:${nodeId}`);
      }
      if (!localObservation) continue;
      const ctx = getLocationContext(state,content,world,def.id);
      for (const item of Object.values(content.items)) for (const source of item.acquisition) if (ctx.actionIds.includes(source.id) &&
        !conditionReason(ctx.actionState,source.conditions,content) && policyMet(state,source.learnWhen,!!state.knowledge.itemEntries[item.id]))
        grant(item.id,`source:${def.id}:${source.id}`);
    }
    for (const entry of Object.values(catalog.entries)) if (state.knowledge.itemEntries[entry.id])
      for (const note of entry.notes) if (!knows(state,entry.id,`note:${note.id}`) && policyMet(state,note.learnWhen,true)) {
        grant(entry.id,`note:${note.id}`);
        if (hasLocalEvidence(note.learnWhen?.conditions)) grant(entry.id,`evidence:${current.id}:${note.id}`);
      }
    lastLearningSignature=learningSignature(state);
    return changed;
  }

  function recipeView(state,recipe,itemId) {
    const context = getLocationContext(state,content,world);
    return { id:recipe.id, name:recipe.name, kind:'recipe', output:recipe.output, amount:recipe.amount,
      selectable:recipeVisible(context.actionState,recipe,content),
      inputs:recipe.inputs.map(slot => ({ id:slot.id, role:slot.role,
        options:ingredientOptions(context.actionState,recipe,slot,content).filter(o => knows(state,o.id,`ingredient:${recipe.id}:${slot.id}`)).map(o =>
          ({ itemId:o.id,name:o.name,quantity:o.quantity,reason:o.reason,default:o.id === (slot.defaultItem ?? slot.item),selectedItem:o.id === itemId })) })),
      operatingCost: { ...recipe.cost } };
  }
  function installations(state,item) {
    if (item.category !== 'product') return [];
    const group = item.installation?.group ?? content.vesselModules[item.id]?.group;
    if (!group) return [];
    const droneReports=Object.keys(state.vesselReports?.byVessel ?? {}).flatMap(id=>{
      const seen=services.observableVessel?.(state,id),machine=seen?.report?.equipment[group];
      return machine ? [{hostId:id,name:seen.name,...machine,placements:[],lastReported:seen.classification!=='LIVE'}]:[];
    });
    return [...droneReports,...locationInstances(state,world,['active','inactive']).filter(def => def.controlMode!=='commanded' && !state.vesselReports?.byVessel[def.id] && ownerOf(state,def.id) === 'player').flatMap(def => {
      const local = state.locations[def.id];
      if (state.entities[def.id].lifecycle !== 'active' || !equipmentReadable(state,def.id)) return [{ hostId:def.id,name:def.name,unavailable:true }];
      const equipment = equipmentQueries.describeInstalled(state,{hostId:def.id,equipmentId:group});
      if (!equipment?.quantity) return [];
      return [{ hostId:def.id,name:def.name,quantity:equipment.quantity,health:equipment.health,enabled:equipment.enabled,operational:equipment.operational,placements:equipment.placements }];
    })];
  }
  function getKnownItemEntry(state,id) {
    const entry = catalog.entries[id], remembered = state.knowledge.itemEntries?.[id];
    if (!entry || !remembered) return null;
    const item = content.items[id], current = getLocationContext(state,content,world);
    const model = { id,name:entry.name,category:entry.category,summary:entry.summary,
      quantity:current.permissions.viewCargo ? current.store.resources[id] : null,
      notes:entry.notes.filter(n => knows(state,id,`note:${n.id}`)).map(({ id,title,text }) => ({ id,title,text })),
      createdBy:(catalog.recipes[id] ?? []).filter(r => knows(state,id,`recipe:${r.id}`)).map(r => recipeView(state,r,id)),
      usedIn:[], sources:[], machines:[], installations:installations(state,item),targets:[], module:!!item.vesselModule,
      equipment:equipmentQueries.describeProduct(id) };
    const usedIds = new Set();
    const design=describeItemDesign(content,id)?.design;
    if(design?.principles?.length&&design.principles.every(p=>state.knowledge.discoveries[p]))model.design={family:design.family,principles:[...design.principles],sources:(design.derivedFrom??[]).map(r=>typeof r==='string'?r:r.id).filter(id=>state.knowledge.itemEntries[id]).map(id=>({id,name:content.items[id].name}))};
    for (const use of catalog.uses[id] ?? []) if (knows(state,id,`ingredient:${use.recipeId}:${use.slotId}`) && !usedIds.has(use.recipeId)) {
      usedIds.add(use.recipeId); model.usedIn.push(recipeView(state,content.recipes[use.recipeId],id));
    }
    const processView = (p,amount) => ({ id:p.id,name:p.name,kind:'process',amount,
      inputs:p.inputs.filter(line => knows(state,line.itemId,`processInput:${p.id}`)).map(line => ({ ...line,name:content.items[line.itemId].name })),
      outputs:p.outputs.filter(line => knows(state,line.itemId,`process:${p.id}`)).map(line => ({ ...line,name:content.items[line.itemId].name })),
      duration:p.duration,powerRate:p.powerRate });
    for (const line of catalog.processOutputs[id] ?? []) if (knows(state,id,`process:${line.processId}`)) model.createdBy.push(processView(catalog.processes[line.processId],line.amount));
    for (const line of catalog.processUses[id] ?? []) if (knows(state,id,`processInput:${line.processId}`)) model.usedIn.push(processView(catalog.processes[line.processId],line.amount));
    for (const key of Object.keys(remembered.facts)) {
      if (!key.startsWith('node:') && !key.startsWith('source:')) continue;
      const [kind,hostId,sourceId] = key.split(':'), def = locationDefinition(state,world,hostId);
      if (!def || ['destroyed','retired'].includes(state.entities[hostId]?.lifecycle)) continue;
      const visible = state.entities[hostId].lifecycle === 'active' && isKnown(state,world,content,hostId);
      const permitted = visible && canUse(state,'player',hostId,'useFacilities') &&
        (hostId === state.locationId || current.definition.mobile && current.local.dockedAtId === hostId);
      if (kind === 'node') {
        const node = def.resourceNodes[sourceId];
        if (!node || node.resourceId !== id) continue;
        const remaining = permitted ? state.locations[hostId].resourceNodes[sourceId]?.remaining : null;
        const processes = Object.values(catalog.processes).filter(p => p.kind === 'extraction' && knows(state,id,`extraction:${p.id}:${hostId}:${sourceId}`)).map(p => ({ id:p.id,name:p.name,capability:p.capability }));
        model.sources.push({ hostId,name:getEntityLabel(state,{world},hostId),kind:'Extraction',remaining:remaining ?? null,processes,linkable:visible });
      } else {
        const source = item.acquisition.find(a => a.id === sourceId);
        if (source && def.actions.includes(source.id)) model.sources.push({ hostId,name:def.name,kind:'Acquisition',method:source.name,linkable:visible });
      }
    }
    model.machines = (catalog.machineUses[id] ?? []).filter(use => knows(state,id,use.key)).map(use =>
      ({ ...use,machineName:content.items[use.machineId].name }));
    if (item.installation) model.targets = installationTargets(state,services).map(def => {
      const request = { itemId:id,sourceLocationId:state.locationId,targetLocationId:def.id };
      return { id:def.id,name:def.name,request,...previewItemInstallation(state,request,services) };
    }).map(({ id,name,request,ok,reason }) => ({ id,name,request,ok,reason }));
    return structuredClone(model);
  }
  return { content,world,catalog,learn,getKnownItemEntry,knownItems:state => Object.values(catalog.entries).filter(e => state.knowledge.itemEntries?.[e.id]).map(e => ({ id:e.id,name:e.name,category:e.category })) };
}
