import { validateEntities, record } from './entities.js';
import { validateAuthority } from './authority.js';
import { validateEntityInstances, reconcileEntityInstances } from './entityState.js';
import { validateShipStates } from './ships.js';
import { validateDialogueState, reconcilePeopleContent } from './dialogue.js';
import { validateResearchState, reconcileResearchContent } from './research/researchState.js';
import { stateReferenceCollectors, contentReferenceCollector } from './entityComposition.js';
import { validateEntityReferences } from './entityReferences.js';
import { createStateLifecycleRegistry } from './stateLifecycleRegistry.js';
import { createWorldLedger, validateWorldLedger } from './worldLedger.js';
import { createProcessingState, reconcileProcessingNodes, validateProcessingState } from './processing.js';
import { reconcileVessels, validateVessels } from './vessels.js';

const booleanMap = value => record(value) && Object.values(value).every(entry => typeof entry === 'boolean');

// The sole default current-state manifest, shared by bootstrap and direct callers.
// Catalog dependencies are bound once; context contains only per-load policy/notices.
export function createStateDomains({ content, world, people, research, referenceCollectors }) {
  const collectors = [...(referenceCollectors ?? [...stateReferenceCollectors,
    contentReferenceCollector({ content, world, people, research })])];
  return [
    { id: 'entities', validate: validateEntities },
    { id: 'authority', validate: validateAuthority },
    { id: 'vessels', validate: state => validateVessels(state, content, world),
      reconcile: state => reconcileVessels(state, content, world) },
    { id: 'entity-instances',
      validate: state => validateEntityInstances(state, content, world, people),
      reconcile(state, context) {
        // Legacy migration already seeds instances; repeat repair only for current saves.
        if (context.reconcileCurrentInstances) reconcileEntityInstances(state, content, world, people);
      } },
    { id: 'ships', validate: state => validateShipStates(state, world) },
    { id: 'dialogue', validate: state => validateDialogueState(state, people),
      reconcile(state, context) {
        const notice = reconcilePeopleContent(state, people);
        if (notice) context.notices.push(notice);
      } },
    { id: 'knowledge-flags', validate(state) {
      if (!booleanMap(state.flags) || !record(state.knowledge) || !booleanMap(state.knowledge.discoveries))
        throw new Error('Invalid knowledge or flags.');
    } },
    { id: 'research', validate: state => validateResearchState(state.research, research, state),
      reconcile: state => reconcileResearchContent(state, research) },
    { id: 'world-ledger', initialize(state) {
      if (Object.hasOwn(state, 'worldLedger')) throw new Error('World ledger already initialized.');
      state.worldLedger = createWorldLedger();
    },
      reconcile(state) { if (!Object.hasOwn(state, 'worldLedger')) state.worldLedger = createWorldLedger(); },
      validate: validateWorldLedger },
    { id: 'entity-references', validate: state => validateEntityReferences(state, collectors) },
    { id: 'processing', initialize(state) { state.processing = createProcessingState(); },
      reconcile: state => reconcileProcessingNodes(state,content,world),
      validate: state => validateProcessingState(state,content,world) },
    { id: 'crafting-selection', validate(state) {
      const draft = state.crafting;
      if (!record(draft) || !record(draft.ingredients) || (draft.recipeId !== null && !Object.hasOwn(content.recipes, draft.recipeId)))
        throw new Error('Invalid crafting selection.');
      const recipe = content.recipes[draft.recipeId];
      for (const [slotId, itemId] of Object.entries(draft.ingredients)) {
        if (!recipe?.inputs.some(slot => slot.id === slotId) || typeof itemId !== 'string' || !Object.hasOwn(content.items, itemId))
          throw new Error('Invalid ingredient selection.');
      }
    } }
  ];
}

export function createStateLifecycle(dependencies, domains = createStateDomains(dependencies)) {
  return createStateLifecycleRegistry(domains);
}
