import { canonical,beatBasis,compareKeys } from './narrativeFacts.js';
const ageText={moments:'moments ago',recent:'recently',earlier:'earlier'};
const subjectGroup=f=>f.subject.equipmentId ?? null;
export function beatCandidates(context) {
  const result=[],facts=context.facts,automatic=context.surface==='operations_update',inspected=context.subject.equipmentId;
  const add=(family,support,category,topics,slots,extras={})=> {
    const first=support[0],group=subjectGroup(first),topicKey=group?`equipment:${context.locationId}:${group}:` : canonical(first.subject)+':';
    const clauses=support.map(f=>({basis:f.basis,factKeys:[f.key]}));
    const beat={id:family+':'+canonical(first.subject),subjectKey:canonical(first.subject),family,factKeys:support.map(f=>f.key),
      topicKeys:[topicKey+category],observationTopics:topics,category,slots,claim:{kind:family,clauses},
      relevance:1,importance:Math.max(...support.map(f=>f.importance)),severity:Math.max(...support.map(f=>f.severity)),locality:1,relationship:inspected?(group===inspected?1:0):.5,priority:0,
      // Fingerprint only the meaning spoken. Never seed with continuous progress,
      // exact reserve, nextId, wall time, RNG, or unrelated supporting data.
      meaning:{family,subject:first.subject,slots,...extras.meaning},...extras};
    result.push(beat);
  };
  for (const f of facts) {
    const d=f.data,name=d.name ?? d.equipmentName;
    if(f.kind==='equipment_provision' && inspected && !automatic)add('equipment_provision',[f],'support',['equipment_condition'],{name,provision:d.provision});
    if (f.kind==='equipment_physical_form' && !automatic) add(d.features?'physical_form':'physical_shape',[f],'presence',['equipment_condition'],{name,form:d.form,...(d.features?{features:d.features}:{})});
    else if (f.kind==='known_design_family' && !automatic) add('design_family',[f],'support',['equipment_condition'],{name,family:d.family});
    else if (f.kind==='known_design_lineage' && !automatic) add('design_lineage',[f],'support',['equipment_condition'],{name,sources:d.sources});
    else if (f.kind==='known_vessel_design' && !automatic) add('vessel_design',[f],'support',['vessel_geometry'],{name,family:d.family,revision:d.revision});
    else if (f.kind==='equipment_condition') {
      if (inspected===d.equipmentId && d.health!==undefined) add('diagnostic',[f],'condition',['equipment_condition'],{name,health:Math.round(d.health*100),quantity:d.quantity},{topicKeys:[`equipment:${context.locationId}:${d.equipmentId}:condition`]});
      else if (d.conditionBand!=='sound' && d.conditionBand!=='worn') add('condition',[f],'condition',['equipment_condition'],{name,conditionBand:d.conditionBand});
      if (d.enabled===false) add('disabled',[f],'problem',['equipment_condition'],{name});
    } else if (f.kind==='process_activity') {
      const family=d.phase==='delivery'?(d.blocker==='OUTPUT_FULL'?'delivery_full':'delivery'):d.workState==='power_limited'?'limited':d.workState==='no_power'?'no_power':d.blocker==='SOURCE_UNAVAILABLE'?'source_unavailable':d.blocker?'unavailable':'working';
      const topic=`equipment:${context.locationId}:${d.equipmentId}:activity`;
      add(family,[f],d.blocker?'problem':'activity',['industrial_activity'],{name},{topicKeys:[topic],priority:d.phase==='delivery'?2:1,
        relevance:automatic && family==='working' ? .9:1});
    } else if (f.kind==='equipment_activity' && d.attachedRuns===undefined) {
      if (d.activity==='working') add('observed_work',[f],'activity',['industrial_activity'],{name});
    } else if (f.kind==='equipment_activity' && d.attachedRuns===0) {
      const history=facts.filter(h=>h.kind==='recent_process_activity' && h.data.outcome==='completed' && h.data.equipmentId===d.equipmentId).sort((a,b)=>b.evidence.ledgerId-a.evidence.ledgerId)[0];
      if (history) add('idle_completed',[f,history],'support',['industrial_activity'],{name,age:ageText[history.data.ageBand]},{importance:.8,topicKeys:[`equipment:${context.locationId}:${d.equipmentId}:activity`,`equipment:${context.locationId}:${d.equipmentId}:history`]});
      if (inspected && !automatic) add('idle',[f],'activity',['industrial_activity'],{name},{importance:.5});
    } else if (f.kind==='recent_process_activity') {
      const root=`equipment:${context.locationId}:${d.equipmentId}:`;
      add(d.outcome,[f],'support',['industrial_activity'],{name,age:ageText[d.ageBand]},{topicKeys:['started','blocked','resumed'].includes(d.outcome)?[root+'activity',root+'history']:[root+'history']});
    } else if (f.kind==='recent_equipment_repair') add('repaired',[f],'support',['equipment_condition'],{name,age:ageText[d.ageBand]});
    else if (f.kind==='power_reserve' && !automatic) {
      if (d.reserveBand==='empty') add('reserve',[f],'problem',['power'],{},{importance:.4});
      else if (d.flowBand==='draining') add('draining',[f],'problem',['power'],{},{importance:.45});
    } else if (f.kind==='storage_condition' && d.fillBand!=='ordinary' && !automatic) add(d.fillBand==='overloaded'?'overloaded':'storage',[f],'condition',['storage'],{});
    else if (f.kind==='resource_node_condition' && d.reserveBand!=='available') add(d.reserveBand==='depleted'?'depleted':'claimed',[f],'activity',['resource_nodes'],{name},{importance:d.reserveBand==='depleted'?.85:.4});
    else if (f.kind==='ship_presence' && !automatic) add(d.presence==='docked'?'ship_docked':'ship_area',[f],'presence',['local_ship_presence'],{name});
    else if (f.kind==='ship_movement' && !automatic) add('ship_moving',[f],'movement',['local_ship_presence'],{name,destination:d.targetName});
    else if (f.kind==='recent_ship_movement') add(d.movement==='arrived'?(d.journeyKind==='dock'?'docked':'arrived_area'):'departed',[f],'movement',['local_ship_presence'],{name,destination:d.destination,age:ageText[d.ageBand]});
    else if (f.kind==='vessel_geometry') {
      const history=facts.filter(h=>h.kind==='recent_vessel_assembly' && h.subject.id===f.subject.id).sort((a,b)=>b.evidence.ledgerId-a.evidence.ledgerId)[0];
      const slots={name,shape:d.shape,width:d.width,length:d.length,depth:d.depth};
      if (history) add('assembled_layout',[history,f],'support',['vessel_geometry'],{...slots,age:ageText[history.data.ageBand]},
        {topicKeys:[`vessel:${f.subject.id}:layout`,`vessel:${f.subject.id}:assembly`],importance:.9,priority:3});
      else if (!automatic) add('vessel_layout',[f],'presence',['vessel_geometry'],slots,{topicKeys:[`vessel:${f.subject.id}:layout`]});
    }
    else if (f.kind==='vessel_composition' && !automatic) add('vessel_composition',[f],'support',['vessel_composition'],
      {name,moduleCount:d.moduleCount,dryMass:d.dryMass,cargoVolume:d.cargoVolume,fuelVolume:d.fuelVolume},
      {topicKeys:[`vessel:${f.subject.id}:composition`]});
    else if (f.kind==='module_geometry' && !automatic) add('module_geometry',[f],'presence',['module_geometry'],
      {name,category:d.category,width:d.width,length:d.length,depth:d.depth,sizeBand:d.sizeBand});
    else if (f.kind==='recent_vessel_assembly' && !facts.some(g=>g.kind==='vessel_geometry' && g.subject.id===f.subject.id))
      add('assembled',[f],'support',['vessel_geometry'],{name,age:ageText[d.ageBand]},
        {topicKeys:[`vessel:${f.subject.id}:assembly`]});
    else if (f.kind==='npc_presence' && !context.speaker && !automatic) add('people',[f],'presence',['local_people'],{name});
    else if (f.kind==='recent_research' && !automatic) add('research',[f],'research',['research'],{name,age:ageText[d.ageBand]});
  }
  return result;
}
function automaticEligible(beat,context) {
  const support=context.facts.filter(f=>beat.factKeys.includes(f.key));
  return context.triggers.some(t=> {
    if (t.type==='LOCATION_ENTERED') return support.every(f=>f.basis==='current') && !['people','ship_area','ship_docked'].includes(beat.family);
    if (t.type==='RESOURCE_NODE_DEPLETED') return beat.family==='depleted' && support.some(f=>f.subject.nodeId===t.nodeId && f.subject.locationId===t.hostId);
    if (t.type.startsWith('SHIP_')) return support.some(f=>f.kind==='recent_ship_movement' && f.evidence.ledgerId===t.ledgerId);
    if (t.type==='VESSEL_ASSEMBLED') return support.some(f=>f.kind==='recent_vessel_assembly' && f.evidence.ledgerId===t.ledgerId);
    if (t.type==='EQUIPMENT_REPAIRED') return support.some(f=>f.kind==='recent_equipment_repair' && f.evidence.ledgerId===t.ledgerId);
    if (t.type.startsWith('PROCESS_')) {
      if (support.some(f=>f.basis==='history' && f.evidence.ledgerId===t.ledgerId)) return true;
      if (support.some(f=>f.kind==='process_activity' && f.subject.runId===t.runId && f.subject.hostId===t.hostId)) {
        if (t.type==='PROCESS_COMPLETED' || t.type==='PROCESS_ABORTED') return false;
        if (t.type==='PROCESS_PHASE_CHANGED') return support.some(f=>f.data.phase==='delivery');
        if (t.type==='PROCESS_BLOCKED') return support.some(f=>f.data.blocker);
        if (t.type==='PROCESS_RESUMED') return support.some(f=>f.data.phase==='working' && !f.data.blocker);
        return t.type==='PROCESS_STARTED';
      }
    }
    return false;
  });
}
export function selectBeats(context,content,{suppressTopics=[]}={}) {
  const policy=content.surfaces[context.surface],ranked=[],diagnostics=[];
  for (const beat of beatCandidates(context)) {
    const basis=beatBasis(beat,context.facts);
    const history=context.facts.filter(f=>beat.factKeys.includes(f.key) && f.basis==='history');
    const last=history.sort((a,b)=>b.evidence.time-a.evidence.time || b.evidence.ledgerId-a.evidence.ledgerId)[0];
    const recency=last?{moments:1,recent:.6,earlier:.2}[last.data.ageBand]:0;
    const inputs={relevance:beat.relevance,severity:beat.severity,importance:beat.importance,locality:beat.locality,relationship:beat.relationship,recency};
    const components=Object.fromEntries(Object.entries(content.weights).map(([k,w])=>[k,w*inputs[k]*100]));
    const score=Math.round(Object.values(components).reduce((a,b)=>a+b,0));
    const entry={beat,basis,inputs,components,score,ledgerId:Math.max(0,...history.map(f=>f.evidence.ledgerId)),reason:null};
    if (beat.observationTopics.some(t=>suppressTopics.includes(t))) entry.reason='suppressed_topic';
    else if (context.speaker && beat.observationTopics.some(t=>!context.speaker.interests.includes(t))) entry.reason='speech_interest';
    else if (context.surface==='operations_update' && !automaticEligible(beat,context)) entry.reason='unrelated_trigger';
    else if (score<policy.minimum) entry.reason='score_floor';
    diagnostics.push(entry); if (!entry.reason) ranked.push(entry);
  }
  ranked.sort((a,b)=>b.score-a.score || b.beat.severity-a.beat.severity || b.beat.priority-a.beat.priority || b.ledgerId-a.ledgerId || compareKeys(a.beat.id,b.beat.id));
  const selected=[],topics=new Set(),categories={},conditionGroups=new Set(); let historyUsed=0;
  for (const entry of ranked) {
    const b=entry.beat,cost=entry.basis==='current'?0:1;
    if (selected.length>=policy.limit) entry.reason='beat_budget';
    else if (historyUsed+cost>policy.history) entry.reason='history_budget';
    else if ((categories[b.category]??0)>=(policy.categories[b.category]??0)) entry.reason='category_budget';
    else if (b.topicKeys.some(t=>topics.has(t))) entry.reason='topic_covered';
    // A location's equipment condition and process problem share the attention budget.
    else if (context.surface==='inspect_location' && ['condition','problem'].includes(b.category) && conditionGroups.size) entry.reason='condition_budget';
    if (entry.reason) continue;
    selected.push(b); historyUsed+=cost; categories[b.category]=(categories[b.category]??0)+1;
    b.topicKeys.forEach(t=>topics.add(t)); if (['condition','problem'].includes(b.category)) conditionGroups.add(b.category);
  }
  const order={activity:1,problem:2,condition:3,presence:4,movement:5,support:6,research:7};
  selected.sort((a,b)=>(order[a.category]-order[b.category]) || compareKeys(a.id,b.id));
  return {beats:selected,diagnostics:diagnostics.map(e=>({id:e.beat.id,basis:e.basis,inputs:e.inputs,components:e.components,score:e.score,reason:e.reason,selected:selected.includes(e.beat)})),tuning:{version:content.version,weights:content.weights,policy}};
}
