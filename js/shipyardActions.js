import { previewAssembly, assembleVessel, previewVesselDesign, manufactureVesselDesign } from './shipyard.js';
import { fuelMovementReason, moveVesselFuel } from './vesselFuel.js';
export function createShipyardActions(services) {
  return [
    {id:'manufactureVesselDesign',name:'Build vessel design',group:'shipyard',scope:'global',permissions:[],requirement:(s,c,r)=>previewVesselDesign(s,r,services).reason,
      execute(s,c,r){const id=manufactureVesselDesign(s,r,services);return `Built ${s.entities[id].displayName}. Load fuel and charge power before launch.`;}},
    { id: 'assembleVessel', name: 'Assemble vessel', group: 'shipyard', scope: 'global', permissions: [],
      requirement: (state, _ctx, request) => previewAssembly(state, request, services).reason,
      execute(state, _ctx, request) { const id = assembleVessel(state, request, services); return `Assembled ${state.entities[id].displayName}. Load fuel and generate power before launch.`; } },
    ...['load', 'unload'].map(direction => ({ id: direction === 'load' ? 'loadVesselFuel' : 'unloadVesselFuel', name: direction === 'load' ? 'Load vessel fuel' : 'Unload vessel fuel',
      group: 'vesselService', scope: 'global', permissions: [], requirement: (state, _ctx, request) => fuelMovementReason(state, { ...request, direction }, services),
      execute(state, _ctx, request) { moveVesselFuel(state, { ...request, direction }, services); return `${direction === 'load' ? 'Loaded' : 'Unloaded'} ${request.amount} cartridges.`; } }))
  ];
}
