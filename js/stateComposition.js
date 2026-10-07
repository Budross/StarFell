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
import { initializeItemKnowledge, validateItemKnowledge } from './itemKnowledgeState.js';
import { createItemKnowledgeSystem } from './itemKnowledge.js';
import { content as defaultContent } from './content.js';
import { processingDefinitions } from './processingContent.js';
import { compileProcessingCatalog } from './processingCatalog.js';
import { emptyMissions } from './missions/missions.js';
import { emptyVesselReports } from './vesselObservations.js';
import { emptyDesignStudy } from './research/study.js';
import {validateWorldGeography,reconcileAuthoredMapKnowledge} from './locations.js';
import {validateMapKnowledge} from './mapKnowledge.js';
import { initializeLocalPosition, validateLocalPosition, learnLocalPlaces } from './localSpace.js';

const booleanMap = value => record(value) && Object.values(value).every(entry => typeof entry === 'boolean');
const neutralDomain=(id,key,empty)=>({id,initialize:state=>{state[key]=empty();},reconcile:state=>{if(!Object.hasOwn(state,key))state[key]=empty();},validate:state=>{
  const expected=empty(),actual=state[key],keys=Object.keys(expected);
  if(!record(actual) || Object.keys(actual).length!==keys.length || keys.some(k=>!Object.hasOwn(actual,k) || JSON.stringify(actual[k])!==JSON.stringify(expected[k])))throw new Error(`${key} requires its composed state capability.`);
}});

// The sole default current-state manifest, shared by bootstrap and direct callers.
// Catalog dependencies are bound once; context contains only per-load policy/notices.
export function createStateDomains({ content, world, people, research, referenceCollectors, itemKnowledge, processing, missions, vesselObservations,designStudy }) {
  const study=designStudy??research.studies;
  const journal = itemKnowledge ?? createItemKnowledgeSystem({ content, world,
    processes:(processing?.catalog ?? compileProcessingCatalog(content === defaultContent ? processingDefinitions : [],content,world)).definitions });
  const collectors = [...(referenceCollectors ?? [...stateReferenceCollectors,
    contentReferenceCollector({ content, world, people, research }),...(study?[study.collectReferences]:[])])];
  return [
    {id:'world-geography',validate:state=>validateWorldGeography(state,content,world)},
    {id:'map-knowledge',validate:validateMapKnowledge,reconcile:state=>{validateMapKnowledge(state);reconcileAuthoredMapKnowledge(state,world,content);}},
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
    {id:'local-position',initialize(state){initializeLocalPosition(state,world,true);learnLocalPlaces(state,{world,content});},
      validate:state=>validateLocalPosition(state,world),reconcile(state,context){if(context.migrateLocalPosition)learnLocalPlaces(state,{world,content});}},
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
    study?.lifecycle ?? neutralDomain('design-study','designStudy',emptyDesignStudy),
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
    } },
    missions?.lifecycle ?? neutralDomain('missions','missions',emptyMissions),
    vesselObservations?.lifecycle ?? neutralDomain('vessel-reports','vesselReports',emptyVesselReports),
    { id:'item-knowledge',initialize(state) { initializeItemKnowledge(state); journal.learn(state); },
      reconcile(state,context) { if (context.migrateItemKnowledge) { initializeItemKnowledge(state); journal.learn(state); } },
      validate:validateItemKnowledge }
  ];
}

export function createStateLifecycle(dependencies, domains = createStateDomains(dependencies)) {
  return createStateLifecycleRegistry(domains);
}
