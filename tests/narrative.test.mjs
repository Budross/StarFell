import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {fixture,shipSpec} from './entityFixtures.mjs';
import {buildGameSystems} from '../js/bootstrap.js';
import {narrativeContent} from '../js/narrative/narrativeContent.js';
import {beatBasis,validateFacts} from '../js/narrative/narrativeFacts.js';
import {beatCandidates,selectBeats} from '../js/narrative/narrativeBeats.js';
import {compileTemplates,createTextRealizer} from '../js/narrative/narrativeText.js';
import {narrativeKnowledge} from '../js/narrative/narrativeKnowledge.js';
import {calculateProcessingReadiness} from '../js/processingQuery.js';
import {planIndustrialReadiness} from '../js/processingSimulation.js';
import {startProcess} from '../js/processing.js';
import {setEntityAccess,setEntityController} from '../js/authority.js';
import {createNarrativePresentation,committedNarrativeSummary} from '../js/narrativePresentation.js';
import {storageSummary} from '../js/storage.js';
import {locationDefinitions} from '../js/locationContent.js';
import {npcDefinitions} from '../js/npcContent.js';
import {definitions} from '../js/content.js';
import {buildCatalog} from '../js/itemCatalog.js';
import {performDialogue} from '../js/dialogue.js';
import {processingDefinitions} from '../js/processingContent.js';
import {processingWorkshopView} from '../js/processingView.js';
import {equipmentObservationActions} from '../js/narrativeActions.js';
const request={surface:'inspect_location',subjectId:'habitat'};
const refining=(hostId='habitat')=>({hostId,equipmentId:'thermalProcessors',processId:'processSolarCells'});
const extracting={hostId:'habitat',equipmentId:'mineralExtractors',processId:'surfaceMineralExtraction',sourceLocationId:'habitat',nodeId:'surfaceMinerals'};
function ready(f,hostId='habitat') { return f.runtime.applyAction(s=> {
  s.knowledge.discoveries.photovoltaicFabrication=true;
  const h=s.locations[hostId]; h.resources.power=20; h.resources.siliconMinerals=200000; h.resources.electronicParts=8;
  h.infrastructure.solar.quantity=h.infrastructure.habitat.quantity=0;
  h.infrastructure.thermalProcessors.quantity=3; h.infrastructure.mineralExtractors.quantity=2;
}); }
function start(f,req=refining()) { return f.runtime.applyAction(s=>startProcess(s,req,f.processing)); }
const describe=(f,r=request)=>f.narrative.describe(f.state,r,{diagnostics:true});
const facts=(f,r=request)=>f.narrative.buildContext(f.state,r).facts;

test('equipment inspection choices require admitted current problems and are read-only',()=> {
  const systems=buildGameSystems(),state=systems.stateServices.createInitialState(1);
  const choices=()=>equipmentObservationActions(systems.narrative.buildContext(state,request));
  state.locations.habitat.infrastructure.solar.health=.2;
  const before=JSON.stringify(state);
  const solar=choices().find(a=>a.request.equipmentId==='solar');
  assert.ok(solar); assert.match(solar.description,/condition/);
  assert.equal(JSON.stringify(state),before);
  state.locations.habitat.infrastructure.solar.health=1;
  assert.ok(!choices().some(a=>a.request.equipmentId==='solar'));
  state.locations.habitat.infrastructure.solar.enabled=false;
  assert.match(choices().find(a=>a.request.equipmentId==='solar').description,/disabled/);
  assert.deepEqual(equipmentObservationActions({status:'unavailable',facts:[]}),[]);
  assert.deepEqual(equipmentObservationActions({status:'available',locationId:'habitat',facts:[
    {basis:'history',kind:'equipment_condition',subject:{equipmentId:'solar'},data:{name:'Solar array',conditionBand:'badly_degraded'}}
  ]}),[]);
});

test('generation is detached, frozen and read-only across location, equipment and NPC surfaces',()=> {
  const f=fixture(),before=structuredClone(f.state);
  for (const r of [request,{surface:'inspect_equipment',subjectId:'habitat',equipmentId:'solar'},{surface:'npc_greeting',subjectId:'mira'},{surface:'npc_ambient',subjectId:'mira'}]) {
    const result=describe(f,r); assert.equal(result.status,'ok'); assert.ok(Object.isFrozen(result));
    assert.throws(()=>{result.segments[0].text='mutation';},TypeError);
  }
  const context=f.narrative.buildContext(f.state,request),solar=context.facts.find(f=>f.kind==='equipment_condition' && f.data.equipmentId==='solar');
  assert.throws(()=>{solar.data.health=0;},TypeError); assert.deepEqual(f.state,before);
  assert.match(describe(f).text,/poor condition|degraded/); assert.doesNotMatch(describe(f).text,/leak|busbar|dead crew|radiation|actuator|intake/);
});
test('mixed evidence derives basis and consumes history budget, with separate clause truth',()=> {
  const f=fixture(); ready(f); start(f); f.runtime.advance(30);
  const context=f.narrative.buildContext(f.state,request),joint=beatCandidates(context).find(b=>b.family==='idle_completed');
  assert.ok(joint); assert.equal(beatBasis(joint,context.facts),'mixed'); assert.equal(joint.history,undefined); assert.equal(joint.basis,undefined);
  const content=structuredClone(narrativeContent); content.surfaces.inspect_location.history=0;
  const selected=selectBeats(context,content);
  assert.ok(!selected.beats.includes(joint)); assert.ok(selected.diagnostics.some(d=>d.id===joint.id && d.reason==='history_budget'));
  assert.throws(()=>beatBasis(joint,context.facts.filter(f=>f.basis!=='history')),/Missing beat evidence/);
  const forged=structuredClone(joint); forged.claim.clauses[1].basis='current'; assert.throws(()=>beatBasis(forged,context.facts),/clause evidence/);
  const result=describe(f); assert.ok(result.diagnostics.beats.some(b=>b.family==='idle_completed')); assert.match(result.text,/delivered to storage/); assert.doesNotMatch(result.text,/underway|progressing normally/);
});
test('authority, coarse observability, observer knowledge and speech interests only narrow access',()=> {
  const f=fixture(); ready(f); start(f);
  f.runtime.applyAction(s=>{setEntityController(s,'habitat','mira'); setEntityAccess(s,'habitat',{public:['enter'],grants:{}});});
  const coarse=facts(f),solar=coarse.find(f=>f.kind==='equipment_condition' && f.data.equipmentId==='solar');
  // No solar is installed in ready(); restore one, but do not grant access.
  assert.equal(solar,undefined);
  f.runtime.applyAction(s=>{s.locations.habitat.infrastructure.solar.quantity=1; s.locations.habitat.infrastructure.solar.health=.31;});
  const shown=facts(f).find(f=>f.kind==='equipment_condition' && f.data.equipmentId==='solar');
  assert.equal(shown.exposure,'coarse_local'); assert.equal(shown.data.conditionBand,'badly_degraded');
  for (const k of ['health','quantity','enabled','operational','upgrades']) assert.equal(shown.data[k],undefined);
  assert.ok(!facts(f).some(f=>['power_reserve','process_activity','storage_condition','recent_process_activity'].includes(f.kind)));
  // Speaker ownership does not reveal private details to an unauthorized listener.
  assert.ok(!facts(f,{surface:'npc_ambient',subjectId:'mira'}).some(f=>f.kind==='process_activity'));
  assert.equal(narrativeKnowledge({basis:'history',evidence:{participants:['habitat']}},{speaker:{},observerId:'mira',observerLocationId:'habitat',locationId:'habitat'}),false);
  assert.equal(narrativeKnowledge({basis:'history',evidence:{participants:['mira']}},{speaker:{},observerId:'mira'}),true);
  const npcSource=structuredClone(npcDefinitions); npcSource.mira.narrative.observationInterests=['research'];
  const disinterested=fixture({npcSource});
  const speech=describe(disinterested,{surface:'npc_ambient',subjectId:'mira'}); assert.equal(speech.status,'empty');
  assert.ok(speech.diagnostics.context.facts.some(f=>f.kind==='equipment_condition')); assert.ok(speech.diagnostics.diagnostics.some(d=>d.reason==='speech_interest'));
});
test('NPC greeting remains neutral on first committed contact and never saves generated speech',()=> {
  const f=fixture(),p=createNarrativePresentation(f.narrative);
  const commit=f.runtime.applyAction(s=>performDialogue(s,'start',{npcId:'mira'},f.people,f.effectServices));
  const after=f.state;
  const result=p.committed(commit,{action:{id:'dialogue:start'},payload:{npcId:'mira'}});
  assert.match(result.text,/Mira: “Hello\./); assert.doesNotMatch(result.text,/back|again|remember/);
  assert.equal(p.committed(commit),null);
  assert.equal(after.dialogue.met.mira,true); assert.ok(!JSON.stringify(f.saved.dialogue).includes(result.text));
  assert.equal(commit.previous.dialogue.active,null);
});
test('world and NPC metadata have distinct namespaces and location dimensions merge by dimension',()=> {
  const source=structuredClone(locationDefinitions); source.types.habitat.narrative={dimensions:{origin:['industrial'],scale:['spacious']},observableTopics:['storage']};
  source.locations.habitat.narrative={dimensions:{scale:['compact']},observableTopics:['industrial_activity']};
  const s=buildGameSystems({locationSource:source});
  assert.deepEqual(s.world.definitions.habitat.narrative.dimensions,{origin:['industrial'],scale:['compact']});
  assert.deepEqual(s.world.definitions.habitat.narrative.observableTopics,['industrial_activity']);
  source.locations.habitat.narrative.observationInterests=['power']; assert.throws(()=>buildGameSystems({locationSource:source}),/narrative metadata/);
  const npcSource=structuredClone(npcDefinitions); npcSource.mira.narrative.observableTopics=['power']; assert.throws(()=>buildGameSystems({npcSource}),/narrative metadata/);
  const items=structuredClone(definitions); items.infrastructure.solar.narrative.observableTopics=['leaks']; assert.throws(()=>buildCatalog(items),/observation topic/);
});
test('the simulation planner and read query use the same pure allocation across supported fixtures',()=> {
  const f=fixture(); ready(f); start(f); start(f); const base=structuredClone(f.state);
  assert.equal(planIndustrialReadiness,calculateProcessingReadiness);
  for (const power of [0,.0001,.1,20]) for (const health of [0,.3,1]) for (const quantity of [0,1,3]) for (const enabled of [false,true]) {
    const state=structuredClone(base),host=state.locations.habitat; host.resources.power=power; host.infrastructure.solar.quantity=1; host.infrastructure.solar.health=.2;
    Object.assign(host.infrastructure.thermalProcessors,{health,quantity,enabled});
    const before=structuredClone(state),read=calculateProcessingReadiness(state,f.processing);
    assert.deepEqual(planIndustrialReadiness(state,f.processing),read); assert.deepEqual(state,before);
    const ctx=f.narrative.buildContext(state,request);
    for (const r of read.runs) { const fact=ctx.facts.find(f=>f.kind==='process_activity' && f.data.runId===r.runId); assert.equal(fact?.data.blocker,r.blocker); }
  }
});
test('current readiness ignores stale blockers after power, enabled state or capacity changes',()=> {
  const f=fixture(); ready(f); start(f); f.runtime.applyAction(s=>{s.locations.habitat.resources.power=0;});
  assert.equal(f.state.processing.runs[1].blockedReason,null); assert.equal(facts(f).find(f=>f.kind==='process_activity').data.workState,'no_power');
  f.runtime.advance(1); f.runtime.applyAction(s=>{s.locations.habitat.resources.power=20;});
  assert.equal(f.state.processing.runs[1].blockedReason,'NO_POWER'); assert.equal(facts(f).find(f=>f.kind==='process_activity').data.workState,'working');
  assert.equal(processingWorkshopView(f.state,f.processing).groups.flatMap(g=>g.runs).find(r=>r.id===1).blockedReason,null);
  f.runtime.applyAction(s=>{s.locations.habitat.infrastructure.thermalProcessors.enabled=false;});
  assert.equal(facts(f).find(f=>f.kind==='process_activity').data.blocker,'EQUIPMENT_UNAVAILABLE');
});
test('instantaneous allocation plans deliverable slots in run order before simulation mutates',()=> {
  const f=fixture(); ready(f); start(f); f.runtime.advance(20); start(f);
  f.runtime.applyAction(s=> {const h=s.locations.habitat,storage=storageSummary(f.contextFor(s,'habitat').store,f.content); h.resources.scrap=storage.capacityVolumeUnits-storage.usedVolumeUnits;});
  f.runtime.advance(10); assert.equal(f.state.processing.runs[1].phase,'delivery');
  f.runtime.applyAction(s=>{s.locations.habitat.resources.scrap=0; s.locations.habitat.infrastructure.thermalProcessors.quantity=1;});
  const before=structuredClone(f.state),plan=calculateProcessingReadiness(f.state,f.processing);
  assert.equal(plan.runs[0].deliverable,true); assert.equal(plan.runs[1].rank,0); assert.equal(plan.runs[1].speed,1); assert.deepEqual(f.state,before);
  const readiness=facts(f).find(f=>f.kind==='process_activity' && f.data.runId===2); assert.equal(readiness.data.workState,'working');
  const remaining=f.state.processing.runs[2].workRemaining; f.runtime.advance(1);
  assert.equal(f.state.processing.runs[1],undefined); assert.equal(f.state.processing.runs[2].workRemaining,remaining-plan.runs[1].speed);
  assert.equal(f.state.locations.habitat.resources.solarCells,2);
});
test('shared readiness preserves extraction source access, host availability and blocker precedence',()=> {
  const f=fixture(),ship=f.spawn(shipSpec()); ready(f,ship);
  start(f,{...extracting,hostId:ship});
  const state=structuredClone(f.state);
  state.locations[ship].dockedAtId=null;
  assert.equal(calculateProcessingReadiness(state,f.processing).runs[0].blocker,'SOURCE_UNAVAILABLE');
  state.locations[ship].infrastructure.mineralExtractors.enabled=false;
  assert.equal(calculateProcessingReadiness(state,f.processing).runs[0].blocker,'EQUIPMENT_UNAVAILABLE');
  state.entities[ship].lifecycle='inactive';
  assert.equal(calculateProcessingReadiness(state,f.processing).runs[0].blocker,'HOST_INACTIVE');
  assert.deepEqual(calculateProcessingReadiness(state,f.processing),planIndustrialReadiness(state,f.processing));
});
test('empty reserve is not a universal blackout, idle operational equipment is not working',()=> {
  const f=fixture(); ready(f); start(f); f.runtime.applyAction(s=> { const h=s.locations.habitat; h.resources.power=0; h.infrastructure.solar.quantity=1; h.infrastructure.solar.health=1; });
  assert.equal(facts(f).find(f=>f.kind==='process_activity').data.workState,'working');
  const result=describe(f); assert.doesNotMatch(result.text,/blackout|stopped|dead/);
  const idle=fixture(); ready(idle); const r=describe(idle,{surface:'inspect_equipment',subjectId:'habitat',equipmentId:'thermalProcessors'});
  assert.match(r.text,/No process is currently assigned/); assert.doesNotMatch(r.text,/underway|powered|progressing/);
  assert.equal(describe(idle,{surface:'inspect_equipment',subjectId:'habitat',equipmentId:'unknown'}).status,'unavailable');
});
test('fixed seed gives identical cross-playthrough wording and ignores unused continuous values and RNG',()=> {
  const a=buildGameSystems(),state=a.stateServices.createInitialState(1),b=a.stateServices.createInitialState(77);
  assert.deepEqual(a.narrative.describe(state,request),a.narrative.describe(b,request));
  const f=fixture(); ready(f); start(f); const before=describe(f);
  const modified=structuredClone(f.state); modified.processing.runs[1].workRemaining-=.123; modified.simulationTime+=.1; modified.locations.habitat.resources.power-=.01; modified.research.rng^=42;
  const after=f.narrative.describe(modified,request,{diagnostics:true}); assert.equal(before.text,after.text); assert.equal(before.fingerprint,after.fingerprint);
  const reordered=structuredClone(modified); reordered.locations.habitat.infrastructure=Object.fromEntries(Object.entries(reordered.locations.habitat.infrastructure).reverse());
  assert.equal(f.narrative.describe(reordered,request).text,after.text);
});
test('relative score behavior favors severe relevant issues and important recent history',()=> {
  const f=fixture(); ready(f); start(f); f.runtime.applyAction(s=>{s.locations.habitat.resources.power=0;});
  const c=f.narrative.buildContext(f.state,request),result=selectBeats(c,narrativeContent);
  const issue=result.diagnostics.find(d=>d.id.startsWith('no_power:')); assert.ok(issue.selected); assert.ok(issue.score>result.diagnostics.find(d=>d.id.startsWith('reserve:')).score);
  assert.ok(Object.keys(issue.components).length>1);
  const context=structuredClone(c),current=context.facts.find(f=>f.kind==='process_activity');
  const old={...structuredClone(current),key:'old',kind:'recent_process_activity',basis:'history',importance:.1,severity:0,evidence:{providerId:'processing',ledgerId:1,time:0},data:{name:'Old machine',equipmentId:'old',outcome:'completed',ageBand:'earlier'}};
  const recent={...structuredClone(old),key:'recent',importance:.8,evidence:{providerId:'processing',ledgerId:2,time:1},data:{name:'Recent machine',equipmentId:'recent',outcome:'completed',ageBand:'moments'}};
  context.facts=[old,recent]; const history=selectBeats(context,narrativeContent);
  assert.ok(history.beats[0].slots.name==='Recent machine');
  const inspected=f.narrative.buildContext(f.state,{surface:'inspect_equipment',subjectId:'habitat',equipmentId:'thermalProcessors'});
  const target=structuredClone(inspected.facts.find(f=>f.kind==='equipment_condition'));
  target.data.health=.2; target.data.conditionBand='badly_degraded'; target.severity=.9;
  const trivia=structuredClone(target); trivia.key='other-equipment'; trivia.subject.equipmentId='other'; trivia.data.equipmentId='other'; trivia.data.name='Unrelated equipment';
  const ranked=selectBeats({...inspected,facts:[trivia,target]},narrativeContent);
  assert.equal(ranked.beats[0].slots.name,target.data.name); assert.ok(ranked.diagnostics.find(d=>d.id.startsWith('diagnostic:')).score>ranked.diagnostics.find(d=>d.id.startsWith('condition:')).score);
});
test('templates compile typed slots and every authored variant realizes without invented state queries',async()=> {
  assert.throws(()=>compileTemplates({x:{slots:['name'],variants:[['a','{secret}']]}}),/slot/);
  assert.throws(()=>compileTemplates({x:{slots:[],variants:[['a','broken {']]}}),/brace/);
  assert.throws(()=>compileTemplates({x:{slots:[],variants:[['a','ok'],['a','ok']]}}),/variant/);
  const realize=createTextRealizer(narrativeContent),ctx={surface:'inspect_location',subject:{type:'entity',id:'habitat'}};
  for (const [family,def] of Object.entries(narrativeContent.templates)) {
    for (const variant of def.variants) { const source=structuredClone(narrativeContent); source.templates[family].variants=[variant];
      const text=createTextRealizer(source)(ctx,[{id:family,family,meaning:family,slots:Object.fromEntries(def.slots.map(s=>[s,s==='health'?31:s==='quantity'?2:s==='condition'?'badly degraded':s==='age'?'recently':'Test']))}])[0].text;
      assert.ok(text && !/[{}]|undefined|NaN/.test(text)); }
  }
  assert.ok(realize);
  for (const file of ['narrativeBeats.js','narrativeText.js']) { const code=await readFile(new URL('../js/narrative/'+file,import.meta.url),'utf8'); assert.doesNotMatch(code,/from ['"]\.\.\/|runtime\.getState|Math\.random|Date\.now/); }
});
test('construction rejects invalid tuning and incompatible templates; coarse facts cannot carry precise values',()=> {
  const source=structuredClone(narrativeContent); source.templates.limited.slots=['secret'];
  assert.throws(()=>buildGameSystems({narrativeSource:source}),/template contract/);
  const tuning=structuredClone(narrativeContent); tuning.weights.severity=NaN;
  assert.throws(()=>buildGameSystems({narrativeSource:tuning}),/score tuning/);
  const f=fixture(),coarse=structuredClone(facts(f).find(f=>f.kind==='equipment_condition'));
  coarse.exposure='coarse_local'; assert.throws(()=>validateFacts([coarse]),/Private values/);
});
test('automatic power limitation is edge-only, fractional progress is not described as stopped, and restored power yields one update',()=> {
  const f=fixture(),p=createNarrativePresentation(f.narrative); ready(f); start(f);
  f.runtime.applyAction(s=>{const h=s.locations.habitat; h.resources.power=0; h.infrastructure.solar.quantity=1; h.infrastructure.solar.health=.2;});
  const edge=f.runtime.advance(.1),r=p.committed(edge); assert.equal(r.status,'ok'); assert.match(r.text,/limiting|reduced progress/); assert.doesNotMatch(r.text,/stopped|waiting for power|Habitat 05 is/); assert.equal(p.committed(edge),null);
  for (let i=0;i<50;i++) assert.equal(p.committed(f.runtime.advance(.1)),null);
  f.runtime.applyAction(s=>{s.locations.habitat.infrastructure.solar.health=1;});
  const restored=p.committed(f.runtime.advance(.1)); assert.equal(restored.status,'ok'); assert.match(restored.text,/normally|underway|resumed/);
  assert.equal(p.committed(f.runtime.advance(.1)),null);
});
test('completion is delivered history and automatic updates are consolidated without base repetition',()=> {
  const f=fixture(),p=createNarrativePresentation(f.narrative); ready(f); start(f); start(f);
  const commit=f.runtime.advance(30),r=p.committed(commit); assert.equal(r.status,'ok'); assert.ok(r.segments.length<=2);
  assert.match(r.text,/delivered to storage/); assert.doesNotMatch(r.text,/progressing|underway|Habitat 05 is/);
  assert.ok(committedNarrativeSummary(commit).transitions.length>=2); assert.equal(p.committed(commit),null);
  assert.equal(p.committed(f.runtime.advance(1)),null);
  assert.equal(p.observe(f.state,request).text,p.observe(f.state,request).text);
});
test('depletion, buffered output and another power-limited process consolidate truthfully',()=> {
  const f=fixture(),p=createNarrativePresentation(f.narrative); ready(f);
  f.runtime.applyAction(s=>{s.locations.habitat.resourceNodes.surfaceMinerals.remaining=10000;});
  start(f,extracting); start(f);
  f.runtime.applyAction(s=>{
    const h=s.locations.habitat,storage=storageSummary(f.contextFor(s,'habitat').store,f.content);
    h.resources.scrap=storage.capacityVolumeUnits-storage.usedVolumeUnits; h.resources.power=4.6;
  });
  const commit=f.runtime.advance(30),r=p.committed(commit),summary=committedNarrativeSummary(commit);
  assert.ok(summary.transitions.some(t=>t.type==='RESOURCE_NODE_DEPLETED'));
  assert.equal(f.state.processing.runs[1].phase,'delivery'); assert.equal(f.state.locations.habitat.resources.siliconMinerals,160000);
  assert.equal(r.status,'ok'); assert.ok(r.segments.length<=2); assert.doesNotMatch(r.text,/delivered to storage/);
  const explicit=describe(f); assert.ok(explicit.diagnostics.context.facts.some(f=>f.kind==='resource_node_condition' && f.data.reserveBand==='depleted'));
  assert.doesNotMatch(explicit.text,/delivered to storage/);
});
test('remote simulation history never causes automatic reporting and reload never replays old transitions',()=> {
  const f=fixture(),p=createNarrativePresentation(f.narrative),ship=f.spawn(shipSpec()); ready(f,ship); start(f,refining(ship));
  assert.equal(p.committed(f.runtime.advance(30)),null);
  const reload=f.reload(f.saved),context=f.narrative.describe(reload,request); assert.ok(context.text); assert.ok(!JSON.stringify(reload).includes('lastNarrated'));
  const newP=createNarrativePresentation(f.narrative); assert.equal(newP.committed(f.runtime.advance(1)),null);
});
test('save failures publish no action aftermath or world transition and preserve committed state',()=> {
  const f=fixture(),p=createNarrativePresentation(f.narrative); ready(f); const before=structuredClone(f.state); f.failSave(true);
  let result=null; assert.throws(()=>{result=start(f);},/save/i); assert.equal(result,null); assert.deepEqual(f.state,before);
  f.failSave(false); start(f); const active=structuredClone(f.state); f.failSave(true);
  assert.throws(()=>{result=f.runtime.advance(30);},/save/i); assert.equal(result,null); assert.deepEqual(f.state,active);
  assert.throws(()=>p.committed(null),/./);
});
test('large committed batches remain bounded and tolerate the pruned history window',()=> {
  const processSource=structuredClone(processingDefinitions); processSource.find(p=>p.id==='processSolarCells').powerRate=0;
  const f=fixture({processSource}),p=createNarrativePresentation(f.narrative); ready(f);
  f.runtime.applyAction(s=>{const h=s.locations.habitat; h.resources.siliconMinerals=9000000; h.resources.electronicParts=201; h.infrastructure.thermalProcessors.quantity=201; for (let i=0;i<201;i++) startProcess(s,refining(),f.processing);});
  const commit=f.runtime.advance(30),summary=committedNarrativeSummary(commit);
  assert.ok(summary.partialHistory); assert.ok(summary.transitions.length>200);
  const result=p.committed(commit); assert.equal(result.status,'ok'); assert.ok(result.segments.length<=2); assert.match(result.text,/delivered to storage/);
  assert.equal(p.committed(commit),null); assert.equal(f.state.worldLedger.entries.length,200);
});
