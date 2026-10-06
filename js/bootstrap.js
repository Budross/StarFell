import { content as defaultContent } from "./content.js";
import { locationDefinitions } from "./locationContent.js";
import { compileLocationCatalog, linkLocationActions, createLocationActions, getLocationContext,locationProducerMetadata } from "./locations.js";
import { itemProducerMetadata } from './itemCatalog.js';
import { effectProducerMetadata,validateProjectRequirements } from './projectValidation.js';
import { externalProducers as defaultExternalProducers } from './externalProducers.js';
import { createItemActions } from "./itemActions.js";
import { createShipActions } from "./ships.js";
import { reconcileContact, resolveTopics } from "./dialogue.js";
import { createCommunications } from './communications.js';
import { createCommunicationActions, communicationConditionSources, communicationProducerMetadata } from './communicationActions.js';
import { composeSimulationSteps as snapshotSimulationSteps } from "./simulationRegistry.js";
import { createStateDomains, createStateLifecycle } from "./stateComposition.js";
import {worldGenerationProfile} from './worldGenerationContent.js';
import {compileGenerationProfile} from './proceduralWorld.js';
import {reconcileAuthoredMapKnowledge} from './locations.js';
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
import { quantityKind, compileQuantity, validateQuantity, formatQuantity } from "./quantities.js";
import { createWorldLedgerServices } from "./worldLedger.js";
import { createWorldOperations } from "./worldOperations.js";
import { withLedgerSaveRequest } from "./worldLedgerSimulation.js";
import { compileProcessingCatalog } from './processingCatalog.js';
import { processingDefinitions } from './processingContent.js';
import { createProcessingActions } from './processingActions.js';
import { abortHostedRuns, startProcess, cancelUnconsumedExtraction } from './processing.js';
import { extractionCandidates, runtimeExtractionCandidates,bufferedOutputObservation,processingStartReadiness,processingWorkFailure } from './processingQuery.js';
import { projectProcessingWork } from './processingProjection.js';
import { industrialSimulationSteps } from './processingSimulation.js';
import { createNarrativeSystem } from './narrative/narrativeSystem.js';
import { locationFactProvider } from './narrative/providers/locationFacts.js';
import { equipmentFactProvider } from './narrative/providers/equipmentFacts.js';
import { designFactProvider } from './narrative/providers/designFacts.js';
import { powerFactProvider } from './narrative/providers/powerFacts.js';
import { processingFactProvider } from './narrative/providers/processingFacts.js';
import { resourceFactProvider } from './narrative/providers/resourceFacts.js';
import { shipFactProvider } from './narrative/providers/shipFacts.js';
import { vesselFactProvider } from './narrative/providers/vesselFacts.js';
import { npcFactProvider } from './narrative/providers/npcFacts.js';
import { researchFactProvider } from './narrative/providers/researchFacts.js';
import { createShipyardActions } from './shipyardActions.js';
import { createVesselCommandActions, droneCommandReason } from './vesselCommandActions.js';
import { reconcileVessels } from './vessels.js';
import { createItemKnowledgeSystem } from './itemKnowledge.js';
import { createItemInstallationActions } from './itemInstallation.js';
import { createMissionSystem } from './missions/missionSystem.js';
import { migrateMissionReport } from './missions/missionResults.js';
import { missionDefinitions } from './missions/missionContent.js';
import { createCargoMissionActions } from './integrations/missions/cargoMissionActions.js';
import { createExtractResourceMissionAction } from './integrations/missions/extractResourceMissionAction.js';
import { createMissionTransport } from './integrations/missions/missionTransport.js';
import { previewBerthTransfer, executeBerthTransfer } from './vesselCargo.js';
import { createVesselObservations } from './vesselObservations.js';
import { entityReference } from './entityReferences.js';
import { permissionReason } from './authority.js';
import { previewExchange, capacity } from './resources.js';
import { powerRate } from './game.js';
import { isOperational } from './equipment.js';
import { createSimulationClock } from './simulationClock.js';
import { validateDesignPrinciples } from './itemDesignCatalog.js';
import { createStudySystem } from './research/study.js';
import { compileVesselDesigns } from './vesselDesignCatalog.js';
import { designDefinitions } from './designContent.js';
import { createEquipmentQueries } from './equipmentQuery.js';
import { compileEquipmentUsage } from './equipmentUsage.js';

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
  composeSimulationSteps = steps => steps, composeStateDomains = domains => domains, missionSource, designSource,
  createAdditionalMissionActions = () => [], producerMetadata=[],externalProducers=defaultExternalProducers,
  generationProfile = content===defaultContent && locationSource===locationDefinitions ? worldGenerationProfile : null } = {}) {
  const compiledProfile=generationProfile?compileGenerationProfile(generationProfile,content):null;
  if(compiledProfile&&(locationSource.locations?.naturalBody||locationSource.templates?.naturalBody))throw new Error('naturalBody is reserved for the composed new-world definition template.');
  const source=compiledProfile?{...locationSource,templates:{...locationSource.templates,naturalBody:{type:'prospectingSite',name:'Natural body',description:'A natural body available for local observation.',remoteDescription:'A natural-body berth.',resourceNodes:[]}}}:locationSource;
  const world = compileLocationCatalog(source, content);
  Object.defineProperty(world,'generationProfile',{value:compiledProfile,enumerable:false});
  world.principals = structuredClone(principals);
  const people = buildPeopleSystem(content, world, npcSource, dialogueSource);
  const catalog = compileProcessingCatalog(processSource ?? (content === defaultContent ? processingDefinitions : []),content,world);
  const research = buildResearchSystem(content, world, people, researchSource, [], catalog.discoveryReferences);
  const authoredScanOverride=Object.values(content.items).some(item=>[...item.acquisition,...item.operations,...item.maintenance].some(a=>a.id==='scanSignal'))||Object.values(content.recipes).some(recipe=>recipe.directive?.id==='scanSignal');
  const communicationRequirements=communicationConditionSources.filter(source=>!authoredScanOverride||source.path!=='communications.scanSignal.conditions');
  const equipment = createEquipmentQueries(content, compileEquipmentUsage(content,catalog.definitions,[
    {domain:'items',sources:(content.conditionSources ?? []).map(source=>({...source,domain:/\.(recipes|recipeContributions)\./.test(source.path)?'crafting':source.path.includes('.knowledgeEntry.')?'itemKnowledge':'items'}))}, {domain:'research',sources:research.catalog.conditionSources},
    {domain:'dialogue',sources:people.conditionSources}, {domain:'communications',sources:communicationRequirements}, {domain:'locations',sources:world.conditionSources}
  ]));
  const communications=createCommunications({content,world,people,equipment,topics:(state,id,mode)=>resolveTopics(state,id,people,mode)});
  people.communications=communications;
  validateDesignPrinciples(content, research.catalog);
  validateSpawnIds(world, people, principals);
  const clock = createSimulationClock();
  const processing = { content, world, catalog, clock, equipment };
  const systems = { content, world, people, research, processing, clock, equipment, communications };
  const designs=designSource??(content===defaultContent&&processSource===undefined&&researchSource===undefined?designDefinitions:{studies:{},vessels:{}});
  systems.vesselDesigns=compileVesselDesigns(designs.vessels,content,research.catalog);
  const designStudy=createStudySystem(systems,designs.studies);systems.designStudy=designStudy;research.studies=designStudy;
  if(designSource!==undefined||content===defaultContent&&processSource===undefined&&researchSource===undefined)for(const d of Object.values(research.catalog.discoveries))if(d.studyOnly&&!Object.values(designStudy.rules).some(r=>r.discoveryId===d.id))throw new Error(`Study-only discovery ${d.id} has no authored study route.`);
  processing.recordStudyDelivery=designStudy.recordDelivery;
  const itemKnowledge = createItemKnowledgeSystem({ content,world,equipment,processes:catalog.definitions, observableVessel:(state,id)=>systems.vesselObservations?.get(state,id) });
  systems.itemKnowledge = itemKnowledge;
  const refs = { content, world, npcs: people.npcs, principals, complete: true };
  const effectSources = [content.effectSources, people.dialogue.effectSources, world.effectSources, research.catalog.effectSources].flatMap(sources => sources ?? []);
  for (const source of effectSources) validateEffectReferences(source.effects, refs, source.trigger, source.path);
  const produced=effectProducerMetadata(effectSources,(source,fact)=>{
    if(!['current','speaker'].includes(fact.targetId))return [fact.targetId];
    if(source.path.startsWith('locations.'))return [source.path.split('.')[1]];
    if(source.path.startsWith('dialogue.')) {
      const conversationId=source.path.split('.')[1];
      const speakers=Object.values(people.npcs).filter(n=>(n.dialogueGroups??[]).some(g=>people.dialogue.groups[g]?.conversations.includes(conversationId))&&!n.excludeConversations.includes(conversationId));
      return speakers.map(n=>fact.scope==='npc'?n.id:n.initialLocationId).filter(Boolean);
    }
    return fact.scope==='location'?['*']:[];
  });
  systems.validationDiagnostics=validateProjectRequirements({
    conditionSources:[...(content.conditionSources??[]),...world.conditionSources,...people.conditionSources,...catalog.conditionSources,...research.catalog.conditionSources],
    capabilities:Object.keys(content.equipmentContracts),externalProducers,
    producerMetadata:[...produced,...locationProducerMetadata(world),...itemProducerMetadata(content),...(!authoredScanOverride?communicationProducerMetadata:[]),
      ...Object.values(research.catalog.discoveries).filter(d=>!d.retired).map(d=>({kind:'discovery',id:d.id})),
      ...Object.values(people.npcs).flatMap(n=>Object.entries(n.initialFlags).filter(([,value])=>value===true).map(([flag])=>({kind:'flag',scope:'npc',targetId:n.id,flag,value:true}))),...producerMetadata]
  });
  const referenceCollectors = [...stateReferenceCollectors, contentReferenceCollector(systems),designStudy.collectReferences];
  const resourceKind = id => quantityKind(id, content);
  const ledgerServices = createWorldLedgerServices({ resourceKind, clock,
    isCurrentEquipmentId: id => Object.hasOwn(content.infrastructure, id),
    isCurrentMethodId: id => Object.hasOwn(research.catalog.methods, id),
    isCurrentDiscoveryId: id => Object.hasOwn(research.catalog.discoveries, id),
    isCurrentProcessId: id => Object.hasOwn(catalog.definitions,id) });
  Object.assign(processing,{ ledgerServices, contextFor: (state,id,actorId) => getLocationContext(state,content,world,id,actorId) });
  const completionReports=new WeakMap();
  const cargo=createCargoMissionActions({compileQuantity:(n,id)=>compileQuantity(n,id,content),validateQuantity:(n,id)=>validateQuantity(n,id,content),
    previewBerthTransfer:(state,r,actor)=>previewBerthTransfer(state,r,{content,world},actor),
    executeBerthTransfer:(state,r,actor)=>executeBerthTransfer(state,r,{content,world,ledgerServices},actor),
    items:Object.values(content.items).map(i=>({id:i.id,name:i.name,quantityKind:quantityKind(i.id,content)})),formatQuantity:(n,id)=>formatQuantity(n,id,content)});
  const authoredExtractionCandidates=Object.values(world.definitions).flatMap(d=>extractionCandidates(d,processing));
  const extract=createExtractResourceMissionAction({compileQuantity:(n,id)=>compileQuantity(n,id,content),validateQuantity:(n,id)=>{
    if(quantityKind(id,content)!=='bulk')throw new Error('Extraction requires a bulk resource.');return validateQuantity(n,id,content);
  },candidates:authoredExtractionCandidates,candidatesAt:(s,id)=>runtimeExtractionCandidates(s,id,processing),
    projectWork:(s,r,a,options)=>projectProcessingWork(s,r,processing,a,options),cancelWork:(s,id,host,a)=>cancelUnconsumedExtraction(s,id,host,processing,a),
    readBuffered:bufferedOutputObservation,
    availableEquipment:(s,id,e)=>equipment.isOperational(s,{hostId:id,equipmentId:e}),
    previewStartProcess:(s,r,a)=>processingStartReadiness(s,r,processing,a),startProcess:(s,r,a)=>startProcess(s,r,processing,a),getRun:(s,id)=>s.processing.runs[id],
    readCompletionResult:(s,id)=>completionReports.get(s)?.some(r=>r.runId===id && r.toPhase==='delivery'),readQuantity:(s,id,item)=>s.locations[id]?.resources[item] ?? 0,
    readWorkFailure:(s,id)=>processingWorkFailure(s,id,processing),
    previewOutput:(s,id,item,n)=>previewExchange(getLocationContext(s,content,world,id).store,{}, {[item]:n},content),formatQuantity:(n,id)=>formatQuantity(n,id,content)});
  const missionTransport=createMissionTransport({world,content,ledgerServices});
  const missions=createMissionSystem({clock,actions:[extract,cargo.pickup,cargo.delivery,...createAdditionalMissionActions(systems)],definitions:missionSource ?? (content===defaultContent && locationSource===locationDefinitions && processSource===undefined ? missionDefinitions:{}),
    destinations:Object.values(world.definitions).filter(d=>d.kind==='site' && !d.mobile).map(d=>({id:d.id,name:d.name})),transport:missionTransport,reference:entityReference,
    access:{commandReason:(s,id)=>droneCommandReason(s,id,{world,content}) || permissionReason(s,'player',id,'pilot'),
      assignmentReason:(s,id)=>Object.values(s.processing.runs).some(r=>r.hostId===id)?'Finish or unload existing vessel work before assignment.':''},
    recordTransition:(s,m,event)=>ledgerServices.append(s,{type:'MISSION_TRANSITION',actorId:m.issuerId,targetId:m.vesselId,locationId:m.homeLocationId,
      data:{missionId:m.id,event,phase:m.phase,outcome:m.outcome.status,reason:m.outcome.reasonCode}})});
  const vesselObservations=createVesselObservations({world,content,migrateMissionReport,missionFor:(s,id)=>missions.current(s,id) ?? Object.values(s.missions.instances).filter(m=>m.vesselId===id).at(-1),missionReport:missions.report,
    validateMissionReport:m=>{if(m.action!==null)missions.catalog.resolve(m.action,m.actionVersion);}});
  Object.assign(systems,{missions,vesselObservations});
  // One shared read capability for existing map/domain presentation callers.
  Object.defineProperty(world,'observableVesselStatus',{value:vesselObservations.get,enumerable:false});
  // Authored template references were checked during static compilation; they
  // have no entity identity until assignment binds a concrete instance.
  referenceCollectors.push(missions.collectReferences,()=>missions.definitionReferences().filter(ref=>world.definitions[ref.targetId]?.spawn!==false),vesselObservations.collectReferences);
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
  const itemActions=createItemActions(content,effectServices,ledgerServices,world);
  // Preserve existing explicitly authored operations in custom legacy catalogs.
  const communicationActions=itemActions.some(a=>a.id==='scanSignal')?[]:createCommunicationActions(content,equipment);
  const actions = [...itemActions,...communicationActions, ...createItemInstallationActions(systems), ...createLocationActions(world, content, effectServices, worldOperations),
    ...createShipActions(world, content, ledgerServices), ...createDialogueActions(people, effectServices),
    ...createResearchActions(research, effectServices, ledgerServices), ...createCargoActions(world, content), ...createProcessingActions(processing),
    ...createShipyardActions(systems), ...designStudy.actions, ...createVesselCommandActions(systems), ...missions.commands, ...createAdditionalActions(systems)];
  linkLocationActions(world, actions);
  const contextFor = (state, id, actorId) => getLocationContext(state, content, world, id, actorId);
  // Narrative receives only read capabilities, never ledger append/effect services.
  const narrativeReads={content,world,people,research,equipment,contextFor,vesselDesigns:systems.vesselDesigns};
  const providers=Object.freeze([locationFactProvider(narrativeReads),equipmentFactProvider(narrativeReads),designFactProvider(narrativeReads),powerFactProvider(narrativeReads),
    processingFactProvider({content,world,catalog,contextFor}),resourceFactProvider(narrativeReads),shipFactProvider(narrativeReads),vesselFactProvider(narrativeReads),npcFactProvider(narrativeReads),researchFactProvider(narrativeReads)]);
  const narrative=createNarrativeSystem({...narrativeReads,providers,...(narrativeSource?{source:narrativeSource}:{}),...(narrativeSeed!==undefined?{seed:narrativeSeed}:{})});
  // Construction-time hooks return complete ordered manifests; never registration APIs.
  const selectedSteps = snapshotSimulationSteps(composeSimulationSteps([
    ...industrialSimulationSteps(processing).map(step=>step.id!=='journeys'?step:{...step,advance(state,elapsed) {
      const result=step.advance(state,elapsed);completionReports.set(state,result.output?.processingTransitions ?? []);return result;
    }}),
    {id:'missions',advance(state) { try{return missions.simulationStep.advance(state);}finally{completionReports.delete(state);} }},
    { id: 'contacts', advance(state) {
      const closure = reconcileContact(state, people);
      return { saveRequested: !!closure, output: { closure } };
    } },
    { id:'item-knowledge',advance(state) { return { saveRequested:itemKnowledge.learn(state) }; } },
    vesselObservations.simulationStep
  ], { ...systems, referenceCollectors }));
  const simulationSteps = snapshotSimulationSteps(selectedSteps.map(withLedgerSaveRequest));
  const missionAuthoring=Object.freeze({getActionContracts:missions.getMissionActionAuthoringContracts,destinations:missions.catalog.destinations,compileDefinition:raw=>missions.catalog.compile(raw,false,true)});
  const missionRuntimeContracts=state=>missions.getMissionActionAuthoringContracts().map(contract=>contract.id!==extract.id?contract:{...contract,catalogs:{...contract.catalogs,nodes:missions.getDestinations(state).flatMap(d=>runtimeExtractionCandidates(state,d.id,processing)).map(c=>({id:c.nodeId,name:c.nodeId,destinationId:c.destinationId,resourceId:c.resourceId}))}});
  return { ...systems, missionAuthoring, missionRuntimeContracts,narrative, actions, referenceCollectors, effectServices, contextFor, simulationSteps, stateLifecycle, stateServices,
    prepareAction:state => itemKnowledge.learn(state),
    validate: stateServices.validateState,
    reconcileAction: state => { reconcileVessels(state, content, world); reconcileAuthoredMapKnowledge(state,world,content); const closure = reconcileContact(state, people); itemKnowledge.learn(state); vesselObservations.capture(state); return closure; } };
}
