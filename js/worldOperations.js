import { createEntities } from './entityCreation.js';
import { transitionEntity, previewEntityTransition } from './entityLifecycle.js';
import { relocateNpc } from './npcs.js';
import { transferBetweenLocations } from './locations.js';
import { getEntity } from './entities.js';

// Gameplay operations own recording; underlying primitives also serve silent
// seed/load/repair/composite-domain paths and must never record independently.
export function createWorldOperations({ content, world, people, referenceCollectors, ledgerServices, resourceKind, abortHostedRuns }) {
  if (typeof ledgerServices?.append !== 'function' || typeof resourceKind !== 'function')
    throw new Error('World operations require ledger and quantity capabilities.');
  const systems = { content, world, people, referenceCollectors };
  const append = ledgerServices.append;
  function place(state, id) {
    const entity = getEntity(state, id);
    if (entity.type === 'npc') {
      const locationId = state.npcs[id].locationId;
      return { locationId, areaId: state.locations[locationId].areaId };
    }
    if (entity.type === 'principal') return { locationId: null, areaId: null };
    return { locationId: id, areaId: entity.type === 'area' ? id : state.locations[id].areaId };
  }
  function spawnEntities(state, specs, context = {}) {
    const ids = createEntities(state, systems, specs);
    for (const id of ids) {
      const entity = getEntity(state, id);
      append(state, { type: 'ENTITY_CREATED', actorId: context.actorId ?? null, targetId: id, ...place(state, id),
        data: { entityType: entity.type, initialLifecycle: entity.lifecycle } });
    }
    return ids;
  }
  function transition(state, id, lifecycle, options = {}, context = {}) {
    const previousLifecycle = getEntity(state, id)?.lifecycle;
    // Let the domain reject missing/invalid targets before deriving their place.
    const location = getEntity(state, id) ? place(state, id) : null;
    if (['destroyed','retired'].includes(lifecycle)) {
      const preview = previewEntityTransition(state,id,lifecycle,systems,options);
      if (!preview.allowed) throw new Error(preview.blockers.join(' '));
      abortHostedRuns?.(state,id,context.actorId ?? options.actorId ?? null);
    }
    const result = transitionEntity(state, id, lifecycle, systems, options);
    const types = { active: 'ENTITY_ACTIVATED', inactive: 'ENTITY_DEACTIVATED', destroyed: 'ENTITY_DESTROYED', retired: 'ENTITY_RETIRED' };
    append(state, { type: types[lifecycle], actorId: context.actorId ?? options.actorId ?? null,
      targetId: id, ...location, data: { previousLifecycle } });
    return result;
  }
  return Object.freeze({ spawnEntities,
    spawnEntity: (state, spec, context) => spawnEntities(state, [spec], context)[0],
    transitionEntity: transition,
    activateEntity: (state, id, options, context) => transition(state, id, 'active', options, context),
    deactivateEntity: (state, id, options, context) => transition(state, id, 'inactive', options, context),
    destroyEntity: (state, id, options, context) => transition(state, id, 'destroyed', options, context),
    retireEntity: (state, id, options, context) => transition(state, id, 'retired', options, context),
    relocateNpc(state, id, destinationId, context = {}) {
      const fromLocationId = state.npcs[id]?.locationId;
      relocateNpc(state, id, destinationId, people);
      if (fromLocationId === destinationId) return;
      append(state, { type: 'NPC_RELOCATED', actorId: id, targetId: destinationId,
        locationId: destinationId, areaId: state.locations[destinationId].areaId,
        data: { fromLocationId, toLocationId: destinationId,
          ...(context.actorId != null ? { initiatorId: context.actorId } : {}) } });
    },
    transferResources(state, payload, { actorId = 'player' } = {}) {
      const message = transferBetweenLocations(state, payload, world, content, actorId);
      const { sourceId, destinationId, assetId, amount } = payload;
      append(state, { type: 'RESOURCE_TRANSFERRED', actorId, targetId: destinationId,
        locationId: sourceId, areaId: state.locations[sourceId].areaId,
        data: { sourceId, destinationId, resourceId: assetId, quantityKind: resourceKind(assetId), amount } });
      return message;
    }
  });
}
