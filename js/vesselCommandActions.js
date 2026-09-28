import { vesselLinkReason } from './vesselAccess.js';
import { locationDefinition } from './entityQueries.js';
import { getLocationContext, isKnown } from './locations.js';
import { navigationReason, navigate } from './ships.js';
import { previewStartProcess, startProcess, previewAbortProcess, abortProcess } from './processing.js';
import { permissionReason } from './authority.js';
import { moveReason, moveExact } from './resources.js';
import { quantityKind, record } from './quantities.js';

export function droneCommandReason(state, vesselId, services) {
  const link = vesselLinkReason(state, vesselId, services);
  if (link) return link;
  return locationDefinition(state, services.world, vesselId)?.controlMode === 'commanded' ? '' : 'Choose an autonomous vessel for remote commands.';
}
export function droneTransferReason(state, request, services) {
  try {
    if (!record(request) || Object.keys(request).some(k => !['vesselId', 'sourceId', 'destinationId', 'assetId', 'amount'].includes(k))) throw new Error('Invalid drone transfer request.');
    const { vesselId, sourceId, destinationId, assetId, amount } = request;
    const link = droneCommandReason(state, vesselId, services); if (link) throw new Error(link);
    const local = state.locations[vesselId];
    if (local.journey || !local.dockedAtId || !((sourceId === vesselId && destinationId === local.dockedAtId) || (destinationId === vesselId && sourceId === local.dockedAtId))) throw new Error('Transfers require the selected vessel and its actual stationary berth.');
    if (!isKnown(state, services.world, services.content, sourceId) || !isKnown(state, services.world, services.content, destinationId)) throw new Error('Both transfer endpoints must be known.');
    const reason = permissionReason(state, 'player', sourceId, 'withdrawCargo') || permissionReason(state, 'player', destinationId, 'depositCargo'); if (reason) throw new Error(reason);
    return moveReason(getLocationContext(state, services.content, services.world, sourceId).store, getLocationContext(state, services.content, services.world, destinationId).store, assetId, amount, services.content);
  } catch (error) { return error.message; }
}
export function createVesselCommandActions(services) {
  return [
    { id: 'commandVesselNavigation', name: 'Command vessel navigation', scope: 'global', group: 'vesselCommands', permissions: [],
      requirement(state, _ctx, request) {
        if (!record(request) || Object.keys(request).some(k => !['vesselId', 'operation', 'targetId'].includes(k)) || !['undock', 'travel', 'dock'].includes(request.operation)) return 'Choose a supported vessel movement command.';
        return droneCommandReason(state, request.vesselId, services) || navigationReason(state, request.operation, request.targetId, services.world, services.content, request.vesselId);
      },
      execute: (state, _ctx, request) => navigate(state, request.operation, request.targetId, services.world, services.content, request.vesselId, 'player', services.ledgerServices) },
    { id: 'commandVesselProcess', name: 'Command vessel batch', scope: 'global', group: 'vesselCommands', permissions: [],
      requirement: (state, _ctx, request) => droneCommandReason(state, request?.hostId, services) || previewStartProcess(state, request, services.processing).reason,
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
        const { sourceId, destinationId, assetId, amount } = request;
        moveExact(getLocationContext(state, services.content, services.world, sourceId).store, getLocationContext(state, services.content, services.world, destinationId).store, assetId, amount, services.content);
        services.ledgerServices.append(state, { type: 'RESOURCE_TRANSFERRED', actorId: 'player', targetId: destinationId, locationId: sourceId, areaId: state.locations[sourceId].areaId,
          data: { sourceId, destinationId, resourceId: assetId, quantityKind: quantityKind(assetId, services.content), amount } });
        return `Transferred cargo between the vessel and its berth.`;
      } }
  ];
}
