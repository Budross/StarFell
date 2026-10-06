import { capacity } from './resources.js';
import { powerRate } from './game.js';
import { storageSummary } from './storage.js';
import { blockerLabels } from './processingView.js';

export const facilityZones = Object.freeze([
  ['power','Power / Utilities','⊕'], ['processing','Processing','▣'], ['fabrication','Fabrication','⌑'],
  ['research','Research','◇'], ['communications','Communications','⌁'], ['storage','Storage / Materials','▤'],
  ['other','Other Systems','□']
].map(([id,label,symbol]) => Object.freeze({id,label,symbol})));

// This describes provision relationships, never evaluates gameplay eligibility.
// Negative branches are not consumers; any-branches are explicitly alternatives.
export function capabilityRelation(conditions = {}, types) {
  const matches = (conditions.capabilities ?? []).some(t => types.includes(t));
  const all = (conditions.all ?? []).map(c => capabilityRelation(c,types));
  if (matches || all.includes('requires')) return 'requires';
  const any = (conditions.any ?? []).map(c => capabilityRelation(c,types));
  if (any.length && any.every(r => r === 'requires')) return 'requires';
  return [...all,...any].some(Boolean) ? 'alternative' : null;
}
function zoneFor(group) {
  for (const owner of ['processing','crafting','research','communications']) {
    if (group.capabilities.some(c => c.owner === owner)) return owner === 'crafting' ? 'fabrication' : owner;
  }
  if (group.contributions.some(c => c.domain === 'power')) return 'power';
  if (group.contributions.some(c => c.kind === 'cargoCapacity')) return 'storage';
  return 'other';
}
function stateLabel(group,runs) {
  if (!group.enabled) return 'DISABLED';
  if (group.health <= 0) return 'DAMAGED';
  if (runs.some(r => r.phase === 'working' && r.speed > 0)) return 'ACTIVE';
  if (runs.some(r => r.blockedReason)) return 'BLOCKED';
  if (runs.some(r => r.phase === 'delivery')) return 'READY';
  return group.capabilities.some(c => c.owner === 'processing') ? 'IDLE' : 'READY';
}
export function runStatus(run) {
  if (run.phase === 'delivery') return run.blockedReason ? 'OUTPUT WAITING' : 'OUTPUT READY';
  if (run.speed > 0 && run.speed < 1) return 'POWER LIMITED';
  return run.speed > 0 ? 'WORKING' : 'BLOCKED';
}

// Bootstrap supplies reads only. No runtime, actions, simulation, learning or saves.
export function createFacilitySystemsView({ content, contextFor, describeInstalled, knownOperations, knownPurpose,
  readProcessing, previewProcess, previewCraft, readMethods, readContacts }) {
  function get(state,actorId = 'player') {
    const hostId = state.locationId, entity = state.entities?.[hostId];
    const base = {hostId,name:'Local facility',access:'UNAVAILABLE',facilityReadable:false,message:'Current facility unavailable.',groups:[],issues:[],power:null,cargo:null};
    if (!state.locations?.[hostId] || entity?.lifecycle !== 'active') return base;
    const ctx = contextFor(state,hostId,actorId);
    base.name = ctx.definition.name;
    if (!['site','ship'].includes(entity.type)) return {...base,message:'No local facility at this position.'};
    const facilities = ctx.permissions.useFacilities || ctx.permissions.manageEquipment;
    const cargo = ctx.permissions.viewCargo;
    const work = facilities || cargo ? readProcessing(state,hostId,actorId,facilities) : {groups:[],host:null};
    if (cargo) {
      const generation = work.host?.generation ?? powerRate(ctx.store,content);
      base.power = {stored:ctx.store.resources.power,capacity:capacity(ctx.store,'power',content),generation,
        demand:work.host?.demand ?? 0,net:work.host?.slope ?? generation};
      base.cargo = storageSummary(ctx.store,content);
    }
    if (!facilities) return structuredClone({...base,access:'RESTRICTED',message:'Facility access required. Installed equipment is private.'});
    const known = knownOperations(state), methods = readMethods(state,ctx), contacts = readContacts(state);
    const issues = [], groups = [];
    for (const equipmentId of Object.keys(content.equipment).sort()) {
      const description = describeInstalled(state,{hostId,equipmentId});
      if (!description) continue;
      // usedBy contains unadmitted content and compiler paths. Never send it to DOM.
      const {capabilities,contributions} = description;
      const caps = capabilities.map(({usedBy,...c}) => c), types = caps.map(c => c.type);
      const runs = (work.groups.find(g => g.equipmentId === equipmentId)?.runs ?? []).map(r => ({
        id:r.id,processId:r.processId,label:r.label === r.processId ? 'Accepted industrial batch' : r.label,phase:r.phase,progress:r.progress,speed:r.speed,
        blockedReason:r.blockedReason,status:runStatus(r),workTotal:r.workTotal,powerRate:r.powerRate,
        inputs:cargo ? r.committedInputs.map(l => ({...l,name:content.items[l.itemId].name})) : null,
        outputs:cargo ? r.pendingOutputs.map(l => ({...l,name:content.items[l.itemId].name})) : null,
        sourceLocationId:r.sourceLocationId,nodeId:r.nodeId
      }));
      const operations = known.processes.filter(p => types.includes(p.capability)).map(p => ({...p,key:`process:${p.id}`,relation:'requires'}));
      for (const r of known.recipes) {
        const relation = capabilityRelation(r.conditions,types);
        if (!relation) continue;
        const {conditions,...recipe} = r;
        operations.push({...recipe,key:`recipe:${r.id}`,relation});
      }
      const research = methods.flatMap(m => {
        const relation = capabilityRelation(m.conditions,types);
        return relation ? [{name:m.name,reason:m.reason,relation}] : [];
      });
      const group = {ref:description.ref,equipmentId,name:description.name,quantity:description.quantity,
        health:description.health,enabled:description.enabled,operational:description.operational,
        installationMode:description.installationMode,capabilities:caps,contributions,
        purpose:knownPurpose(state,description.productId) || [...caps,...contributions].map(c => c.summary).join(' ') || 'Installed infrastructure at this facility.',
        operations,runs,research,contacts:types.includes('radioCommunication') ? contacts : [],
        freeSlots:Math.max(0,description.quantity-runs.length)};
      group.zone = zoneFor(group); group.status = stateLabel(group,runs);
      groups.push(group);
      const issue = (cause,text,severity,runId = null) => issues.push({key:`${equipmentId}/${runId ?? 'group'}/${cause}`,equipmentId,runId,text,severity});
      if (!group.enabled) issue('disabled',`${group.name}: equipment disabled.`,1);
      if (group.health < 1) issue('condition',`${group.name}: ${group.health <= 0 ? 'inoperative' : 'degraded'} · ${Math.round(group.health*100)}% condition.`,group.health <= 0 ? 3 : 1);
      for (const run of runs) if (run.blockedReason) issue(run.blockedReason,
        `${group.name} · ${run.label}: ${run.status === 'POWER LIMITED' ? 'Power limited — work continues at reduced speed' : blockerLabels[run.blockedReason] ?? 'Work unavailable'}.`,run.speed > 0 ? 1 : 2,run.id);
    }
    if (base.cargo?.overloadVolumeUnits) issues.push({key:'cargo/overload',target:'cargo',text:'Local cargo is overloaded.',severity:2});
    if (base.power?.capacity > 0 && base.power.stored <= 0 && base.power.net <= 0)
      issues.push({key:'power/depleted',target:'power',text:'Local power reserve depleted.',severity:2});
    groups.sort((a,b) => facilityZones.findIndex(z => z.id===a.zone)-facilityZones.findIndex(z => z.id===b.zone) || a.equipmentId.localeCompare(b.equipmentId));
    issues.sort((a,b) => b.severity-a.severity || a.key.localeCompare(b.key));
    return structuredClone({...base,groups,issues,facilityReadable:true,access:cargo ? issues.length ? 'ATTENTION' : 'NOMINAL' : 'RESTRICTED',
      message:groups.length ? '' : 'No installed equipment here.',available:groups.filter(g => g.operational).length,
      activeRuns:groups.flatMap(g => g.runs).filter(r => r.phase==='working' && r.speed>0).length});
  }
  // One selected known operation only; no scan of all possible start previews.
  function inspect(state,equipmentId,key,model = get(state)) {
    const group = model.groups.find(g => g.equipmentId === equipmentId);
    const operation = group?.operations.find(p => p.key === key);
    if (!operation) return null;
    if (!model.cargo) return {reason:'Cargo is private. Material previews are unavailable.'};
    if (operation.kind === 'recipe') {
      if (operation.inputs.some(s => !s.options.some(o => o.default))) return {reason:'Ingredient details not fully recorded.'};
      const selections = Object.fromEntries(operation.inputs.map(s => [s.id,s.options.find(o => o.default).itemId]));
      const preview = previewCraft(state,operation.id,selections);
      return {reason:preview.reason || 'Materials ready. Immediate recipe; no machine work is reserved.'};
    }
    const source = operation.sources?.[0];
    const request = {hostId:model.hostId,equipmentId,processId:operation.id,...(source ? {sourceLocationId:source.hostId,nodeId:source.nodeId} : {})};
    if (operation.kind === 'process' && !operation.complete) return {reason:'Process details not fully recorded.'};
    const preview = previewProcess(state,request);
    return {reason:preview.reason || preview.warning || 'Ready to start using the existing Processing controls.',
      workTotal:preview.workTotal,powerRate:preview.powerRate};
  }
  return Object.freeze({get,inspect});
}
