import { content as defaultContent } from "./content.js";
import { locationDefinitions } from "./locationContent.js";
import { compileLocationCatalog, linkLocationActions, createLocationActions, getLocationContext } from "./locations.js";
import { createItemActions } from "./itemActions.js";
import { createShipActions } from "./ships.js";
import { reconcileContact } from "./dialogue.js";
import { composeSimulationSteps as snapshotSimulationSteps } from "./simulationRegistry.js";
import { createStateDomains, createStateLifecycle } from "./stateComposition.js";
import { createInitialState, migrateState, validateState } from "./stateCore.js";
import { buildPeopleSystem } from "./peopleSystem.js";
import { createDialogueActions } from "./dialogueActions.js";
import { buildResearchSystem } from "./research/researchSystem.js";
import { createResearchActions } from "./research/researchActions.js";
import { createCargoActions } from "./cargoActions.js";
import { validateSpawnIds } from "./entityCreation.js";
import { stateReferenceCollectors, contentReferenceCollector } from "./entityComposition.js";
import { setScopedFlag } from "./flags.js";
import { grantDiscovery } from "./knowledge.js";
import { grantItemsChecked } from "./resources.js";
import { validateEffectReferences } from "./effects.js";
import { quantityKind } from "./quantities.js";
import { createWorldLedgerServices } from "./worldLedger.js";
import { createWorldOperations } from "./worldOperations.js";
import { withLedgerSaveRequest } from "./worldLedgerSimulation.js";
import { compileProcessingCatalog } from './processingCatalog.js';
import { processingDefinitions } from './processingContent.js';
import { createProcessingActions } from './processingActions.js';
import { abortHostedRuns } from './processing.js';
import { industrialSimulationSteps } from './processingSimulation.js';
import { createNarrativeSystem } from './narrative/narrativeSystem.js';
import { locationFactProvider } from './narrative/providers/locationFacts.js';
import { equipmentFactProvider } from './narrative/providers/equipmentFacts.js';
import { powerFactProvider } from './narrative/providers/powerFacts.js';
import { processingFactProvider } from './narrative/providers/processingFacts.js';
import { resourceFactProvider } from './narrative/providers/resourceFacts.js';
import { shipFactProvider } from './narrative/providers/shipFacts.js';
import { vesselFactProvider } from './narrative/providers/vesselFacts.js';
import { npcFactProvider } from './narrative/providers/npcFacts.js';
import { researchFactProvider } from './narrative/providers/researchFacts.js';
import { createShipyardActions } from './shipyardActions.js';
import { createVesselCommandActions } from './vesselCommandActions.js';
import { reconcileVessels } from './vessels.js';

// Narrow capabilities, bound explicitly to a game's catalogs and collectors.
export function createEffectServices({ content, world, people, worldOperations }) {
  if (!worldOperations) throw new Error('Effect services require semantic world operations.');
  return Object.freeze({
    setFlag: setScopedFlag,
    discover: grantDiscovery,
    relocate: people ? worldOperations.relocateNpc : undefined,
    grantItem(state, destinationId, itemId, amount) {
      const type = state.entities?.[destinationId]?.type;
      if (!["site", "ship"].includes(type)) throw new Error("Item grants require site or ship cargo.");
      grantItemsChecked(getLocationContext(state, content, world, destinationId).store, { [itemId]: amount }, content);
    },
    deactivateEntity: worldOperations.deactivateEntity,
    activateEntity: worldOperations.activateEntity,
    spawnEntity: people ? worldOperations.spawnEntity : undefined
  });
}

// The one composition point for content and new action families. Factories run
// before linking; handlers receive live contexts later, during execution.
export function buildGameSystems({ content = defaultContent, locationSource = locationDefinitions,
  npcSource, dialogueSource, researchSource, processSource, narrativeSource, narrativeSeed, principals = {}, createAdditionalActions = () => [],
  composeSimulationSteps = steps => steps, composeStateDomains = domains => domains } = {}) {
  const world = compileLocationCatalog(locationSource, content);
  world.principals = structuredClone(principals);
  const people = buildPeopleSystem(content, world, npcSource, dialogueSource);
  const catalog = compileProcessingCatalog(processSource ?? (content === defaultContent ? processingDefinitions : []),content,world);
  const research = buildResearchSystem(content, world, people, researchSource, [], catalog.discoveryReferences);
  validateSpawnIds(world, people, principals);
  const processing = { content, world, catalog };
  const systems = { content, world, people, research, processing };
  const refs = { content, world, npcs: people.npcs, principals, complete: true };
  const effectSources = [content.effectSources, people.dialogue.effectSources, world.effectSources, research.catalog.effectSources].flatMap(sources => sources ?? []);
  for (const source of effectSources) validateEffectReferences(source.effects, refs, source.trigger, source.path);
  const referenceCollectors = [...stateReferenceCollectors, contentReferenceCollector(systems)];
  const resourceKind = id => quantityKind(id, content);
  const ledgerServices = createWorldLedgerServices({ resourceKind,
    isCurrentEquipmentId: id => Object.hasOwn(content.infrastructure, id),
    isCurrentMethodId: id => Object.hasOwn(research.catalog.methods, id),
    isCurrentDiscoveryId: id => Object.hasOwn(research.catalog.discoveries, id),
    isCurrentProcessId: id => Object.hasOwn(catalog.definitions,id) });
  Object.assign(processing,{ ledgerServices, contextFor: (state,id,actorId) => getLocationContext(state,content,world,id,actorId) });
  const worldOperations = createWorldOperations({ ...systems, referenceCollectors, ledgerServices, resourceKind,
    abortHostedRuns: (state,id,actorId) => abortHostedRuns(state,id,processing,actorId) });
  Object.assign(systems, { ledgerServices, worldOperations });
  const stateDependencies = { ...systems, referenceCollectors };
  const stateLifecycle = createStateLifecycle(stateDependencies,
    composeStateDomains(createStateDomains(stateDependencies), stateDependencies));
  const stateServices = Object.freeze({
    createInitialState: seed => createInitialState(content, world, people, research, seed, stateLifecycle),
    migrateState: (saved, notices = [], legacyStorage) => migrateState(saved, content, world, people, notices, research, legacyStorage, stateLifecycle),
    validateState: state => validateState(state, content, world, people, research, undefined, stateLifecycle)
  });
  const effectServices = createEffectServices({ content, world, people, worldOperations });
  const actions = [...createItemActions(content, effectServices, ledgerServices), ...createLocationActions(world, content, effectServices, worldOperations),
    ...createShipActions(world, content, ledgerServices), ...createDialogueActions(people, effectServices),
    ...createResearchActions(research, effectServices, ledgerServices), ...createCargoActions(world, content), ...createProcessingActions(processing),
    ...createShipyardActions(systems), ...createVesselCommandActions(systems), ...createAdditionalActions(systems)];
  linkLocationActions(world, actions);
  const contextFor = (state, id, actorId) => getLocationContext(state, content, world, id, actorId);
  // Narrative receives only read capabilities, never ledger append/effect services.
  const narrativeReads={content,world,people,research,contextFor};
  const providers=Object.freeze([locationFactProvider(narrativeReads),equipmentFactProvider(narrativeReads),powerFactProvider(narrativeReads),
    processingFactProvider({content,world,catalog,contextFor}),resourceFactProvider(narrativeReads),shipFactProvider(narrativeReads),vesselFactProvider(narrativeReads),npcFactProvider(narrativeReads),researchFactProvider(narrativeReads)]);
  const narrative=createNarrativeSystem({...narrativeReads,providers,...(narrativeSource?{source:narrativeSource}:{}),...(narrativeSeed!==undefined?{seed:narrativeSeed}:{})});
  // Construction-time hooks return complete ordered manifests; never registration APIs.
  const selectedSteps = snapshotSimulationSteps(composeSimulationSteps([
    ...industrialSimulationSteps(processing),
    { id: 'contacts', advance(state) {
      const closure = reconcileContact(state, people);
      return { saveRequested: !!closure, output: { closure } };
    } }
  ], { ...systems, referenceCollectors }));
  const simulationSteps = snapshotSimulationSteps(selectedSteps.map(withLedgerSaveRequest));
  return { ...systems, narrative, actions, referenceCollectors, effectServices, contextFor, simulationSteps, stateLifecycle, stateServices,
    validate: stateServices.validateState,
    reconcileAction: state => { reconcileVessels(state, content, world); return reconcileContact(state, people); } };
}
