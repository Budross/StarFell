import { canUse } from './authority.js';
import { conditionReason } from './conditionContext.js';
import { locationDefinition } from './entityQueries.js';
import { processingRuns, extractionAccess, previewStartProcess, previewAbortProcess, claimedReserve } from './processing.js';
import { processingHostObservation } from './processingQuery.js';

export const blockerLabels = { HOST_INACTIVE: 'Host unavailable', EQUIPMENT_UNAVAILABLE: 'Machine unavailable', SOURCE_UNAVAILABLE: 'Extraction source out of reach', NO_POWER: 'Insufficient power', OUTPUT_FULL: 'Waiting for storage space' };
export function processingWorkshopView(state, services, actorId = 'player') {
  return processingHostView(state, services, state.locationId, actorId);
}
export function processingHostView(state, services, hostId, actorId = 'player') {
  const visible = canUse(state,actorId,hostId,'useFacilities') || canUse(state,actorId,hostId,'manageEquipment');
  if (!visible) return { hostId, groups: [], private: true };
  const context = services.contextFor(state,hostId,actorId), canViewCargo = canUse(state,actorId,hostId,'viewCargo');
  const runs = processingRuns(state).filter(r => r.hostId === hostId);
  const readiness=new Map(processingHostObservation(state,hostId,services).runs.map(r=>[r.runId,r]));
  const groups = Object.entries(services.content.infrastructure).filter(([id,def]) =>
    (context.local.infrastructure[id].quantity > 0 || runs.some(r => r.equipmentId === id)) &&
    (def.capabilities.some(c => services.catalog.byCapability[c]) || runs.some(r => r.equipmentId === id))).map(([equipmentId,def]) => {
      const machine = context.local.infrastructure[equipmentId], attached = runs.filter(r => r.equipmentId === equipmentId);
      const choices = [];
      if (canViewCargo) for (const process of Object.values(services.catalog.definitions)) {
        if (!def.capabilities.includes(process.capability) || !process.hostKinds.includes(state.entities[hostId].type) || conditionReason(context.actionState,process.startConditions,services.content)) continue;
        const request = { hostId,equipmentId,processId: process.id };
        if (process.kind === 'refining') choices.push({ label: process.name, request, preview: previewStartProcess(state,request,services,actorId) });
        else for (const sourceId of Object.keys(state.locations)) {
          if (!extractionAccess(state,hostId,sourceId) || !canUse(state,actorId,sourceId,'useFacilities')) continue;
          for (const [nodeId,node] of Object.entries(locationDefinition(state,services.world,sourceId)?.resourceNodes ?? {})) {
            if (!process.sourceRequirements.tags.every(t => node.tags.includes(t))) continue;
            const selection = { ...request,sourceLocationId: sourceId,nodeId };
            choices.push({ label: `${process.name} — ${services.content.items[node.resourceId].name}`, request: selection,
              reserve: { remaining: state.locations[sourceId].resourceNodes[nodeId].remaining, claimed: claimedReserve(state,sourceId,nodeId) },
              preview: previewStartProcess(state,selection,services,actorId) });
          }
        }
      }
      return { equipmentId,name: def.name,quantity: machine.quantity,operational: machine.enabled && machine.health > 0,
        idle: Math.max(0,machine.quantity-attached.length),choices,
        runs: attached.map(run => ({ ...run, blockedReason:readiness.get(run.id)?.blocker ?? null, label: services.catalog.definitions[run.processId]?.name ?? run.processId,
          progress: (run.workTotal-run.workRemaining)/run.workTotal, abort: previewAbortProcess(state,run.id,services,actorId) })) };
    });
  return { hostId,groups,canViewCargo,private: false };
}
