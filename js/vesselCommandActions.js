import { vesselLinkReason } from './vesselAccess.js';
import { locationDefinition } from './entityQueries.js';
import { isKnown, physicalLinks } from './locations.js';
import { navigationReason, navigate } from './ships.js';
import { previewStartProcess, startProcess, previewAbortProcess, abortProcess } from './processing.js';
import { record } from './quantities.js';
import { previewBerthTransfer, executeBerthTransfer } from './vesselCargo.js';

export function droneCommandReason(state, vesselId, services) {
  const link = vesselLinkReason(state, vesselId, services);
  if (link) return link;
  return locationDefinition(state, services.world, vesselId)?.controlMode === 'commanded' ? '' : 'Choose an autonomous vessel for remote commands.';
}
export function droneTransferReason(state, request, services) {
  return droneCommandReason(state,request?.vesselId,services) || previewBerthTransfer(state,request,services).reason;
}
export function droneNavigationReason(state,request,services) {
  if(!record(request) || Object.keys(request).some(k=>!['vesselId','operation','targetId'].includes(k)) || !['undock','travel','dock'].includes(request.operation))return 'Choose a supported vessel movement command.';
  const link=droneCommandReason(state,request.vesselId,services);if(link)return link;
  if(services.missions?.current(state,request.vesselId))return 'Update mission orders or recall this drone before manual navigation.';
  if(request.operation==='undock') {
    const local=state.locations[request.vesselId], scratch={...state,locations:{...state.locations,[request.vesselId]:{...local,dockedAtId:null}}};
    if(vesselLinkReason(scratch,request.vesselId,services))return 'Assign a feasible mission before launch: this drone will lose contact after undocking.';
    const targets=[local.dockedAtId,...physicalLinks(state,services.world).flatMap(([a,b])=>a===local.areaId?[b]:b===local.areaId?[a]:[])].filter(Boolean);
    if(!targets.some(id=>!navigationReason(scratch,locationDefinition(state,services.world,id)?.kind==='area'?'travel':'dock',id,services.world,services.content,request.vesselId)))return 'Load fuel and power for a usable movement or recovery leg before undocking.';
  }
  return navigationReason(state,request.operation,request.targetId,services.world,services.content,request.vesselId);
}
export function createVesselCommandActions(services) {
  return [
    { id: 'commandVesselNavigation', name: 'Command vessel navigation', scope: 'global', group: 'vesselCommands', permissions: [],
      requirement(state, _ctx, request) {
        return droneNavigationReason(state,request,services);
      },
      execute: (state, _ctx, request) => navigate(state, request.operation, request.targetId, services.world, services.content, request.vesselId, 'player', services.ledgerServices) },
    { id: 'commandVesselProcess', name: 'Command vessel batch', scope: 'global', group: 'vesselCommands', permissions: [],
      requirement: (state, _ctx, request) => droneCommandReason(state, request?.hostId, services) || (services.missions?.current(state,request?.hostId) ? 'Update mission orders before starting manual work.':'') || previewStartProcess(state, request, services.processing).reason,
      execute(state, _ctx, request) { const id = startProcess(state, request, services.processing); return `Vessel batch ${id} started.`; } },
    { id: 'commandVesselAbort', name: 'Abort vessel batch', scope: 'global', group: 'vesselCommands', permissions: [],
      requirement(state, _ctx, request) {
        if (!record(request) || Object.keys(request).some(k => !['vesselId', 'runId', 'phase', 'confirmed'].includes(k)) || request.confirmed !== true || !['working', 'delivery'].includes(request.phase)) return 'Review the material loss before aborting.';
        if (state.processing.runs[request.runId]?.hostId !== request.vesselId) return 'Choose a batch on the selected vessel.';
        return droneCommandReason(state, request.vesselId, services) || previewAbortProcess(state, request.runId, services.processing).reason;
      },
      execute(state, _ctx, request) { abortProcess(state, request.runId, services.processing, 'player', request.phase); return 'Vessel batch aborted. Committed material was lost.'; } },
    { id: 'commandVesselTransfer', name: 'Command vessel cargo transfer', scope: 'global', group: 'vesselCommands', permissions: [],
      requirement: (state, _ctx, request) => droneTransferReason(state, request, services),
      execute(state, _ctx, request) {
        const reason = droneTransferReason(state, request, services); if (reason) throw new Error(reason);
        executeBerthTransfer(state,request,services);
        return `Transferred cargo between the vessel and its berth.`;
      } }
  ];
}
