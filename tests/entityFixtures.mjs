import { buildGameSystems } from '../js/bootstrap.js';
import { createGameRuntime } from '../js/runtime.js';
import { createActionRegistry } from '../js/playerActions.js';
import { locationDefinitions } from '../js/locationContent.js';
import { npcDefinitions } from '../js/npcContent.js';

export function fixture(options = {}) {
  const locationSource = structuredClone(locationDefinitions);
  locationSource.templates = {
    freighter: { type: 'ship', name: 'Light freighter', description: 'A freighter.', remoteDescription: 'A freighter.',
      storage: { capacityM3: 2 }, initialResources: { power: 30, scrap: 0.03 },
      initialInfrastructure: { engine: { quantity: 1 }, solar: { quantity: 1 }, fabricator: { quantity: 1 } },
      sceneObjects: [{ id: 'bridge', name: 'Bridge console', description: 'A quiet bridge.' }] },
    depot: { type: 'platform', name: 'Depot', description: 'A depot.', remoteDescription: 'A depot.', initialResources: { power: 10 },
      initialInfrastructure: { fabricator: { quantity: 1 } } }
  };
  const npcSource = { ...structuredClone(npcDefinitions), merchant: { spawn: false, name: 'Merchant', description: 'A visiting merchant.',
    initialInventory: { scrap: 0.02 }, inventoryCapacities: { scrap: 0.2 }, dialogueGroups: ['habitatCrew'] } };
  const systems = buildGameSystems({ locationSource, npcSource, principals: { corporation: { name: 'Collector Corporation' } }, ...options });
  let failSave = false, saved;
  const runtime = createGameRuntime({ ...systems, initialState: systems.stateServices.createInitialState(),
    save: s => { if (failSave) throw new Error('Save failed'); saved = structuredClone(s); } });
  const registry = createActionRegistry();
  systems.actions.forEach(registry.registerAction);
  registry.initialize({ getState: runtime.getState, getContext: systems.contextFor, applyAction: runtime.applyAction });
  const api = { ...systems, runtime, registry, get state() { return runtime.getState(); }, get saved() { return saved; }, failSave: value => { failSave = value; },
    validate: systems.stateServices.validateState,
    reload: systems.stateServices.migrateState,
    spawn(spec) { let id; runtime.applyAction(s => { id = systems.worldOperations.spawnEntity(s, spec); }); return id; },
    batch(specs) { let ids; runtime.applyAction(s => { ids = systems.worldOperations.spawnEntities(s, specs); }); return ids; } };
  return api;
}
export const shipSpec = overrides => ({ type: 'ship', definitionId: 'freighter', areaId: 'vicinity', dockedAtId: 'habitat', ownerId: 'player', ...overrides });
export const npcSpec = overrides => ({ type: 'npc', definitionId: 'merchant', locationId: 'habitat', ...overrides });
