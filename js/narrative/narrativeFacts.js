/** @typedef {{type:'entity',id:string}|{type:'equipment_group',hostId:string,equipmentId:string}|{type:'process_run',hostId:string,equipmentId:string,runId:number}|{type:'resource_node',locationId:string,nodeId:string}} NarrativeSubject */
/** @typedef {{equipmentId:string,name:string,conditionBand:'sound'|'worn'|'degraded'|'badly_degraded'|'inoperative',quantity?:number,health?:number,enabled?:boolean,operational?:boolean}} EquipmentCondition */
/** @typedef {{runId:number,processId:string,processName:string,equipmentId:string,equipmentName:string,phase:'working'|'delivery',blocker:string|null,workState:'working'|'power_limited'|'no_power'|'blocked'|'delivery',pendingOutputs?:Array<{itemId:string,amount:number}>}} ProcessActivity */
/** @typedef {{key:string,kind:string,basis:'current'|'history',subject:NarrativeSubject,locationId:string|null,areaId:string|null,importance:number,severity:number,exposure:string,evidence:object,data:object|EquipmentCondition|ProcessActivity}} NarrativeFact
 * Kind-specific payloads are constructed by domain providers, never by templates.
 * Current facts describe the supplied snapshot; history facts describe an occurrence.
 */
export const compareKeys = (a,b) => a < b ? -1 : a > b ? 1 : 0;
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort(compareKeys).map(k => JSON.stringify(k)+':'+canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
export function freezeDetached(value) {
  const copy = structuredClone(value);
  function freeze(v) { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; }
  return freeze(copy);
}
export function fact(providerId,kind,subject,data,scope,{basis='current',event=null,importance=.5,severity=0,exposure='coarse_local'}={}) {
  return freezeDetached({ key:canonical([kind,subject,basis,event?.id ?? null]), kind,basis,subject,
    locationId:scope.locationId,areaId:scope.areaId,importance,severity,exposure,
    evidence:event ? {providerId,ledgerId:event.id,eventType:event.type,time:event.time,participants:[event.actorId,event.data.initiatorId].filter(Boolean)} : {providerId,subjectKey:canonical(subject)}, data });
}
export function validateFacts(facts) {
  const fields={
    location_identity:['name','baseText','dimensions'],equipment_condition:['equipmentId','name','conditionBand','quantity','health','enabled','operational'],
    power_reserve:['available','capacity','reserveBand','equipmentNetRate','flowBand'],process_activity:['runId','processId','processName','equipmentId','equipmentName','phase','blocker','workState','pendingOutputs'],
    equipment_activity:['equipmentId','name','activity','quantity','attachedRuns','workingCount','powerLimitedCount','deliveryCount','freeSlots'],
    storage_condition:['capacityVolumeUnits','usedVolumeUnits','freeVolumeUnits','overloadVolumeUnits','fillBand'],resource_node_condition:['nodeId','resourceId','name','remaining','claimed','available','reserveBand'],
    ship_presence:['name','presence','dockedAtId'],ship_movement:['name','targetId','targetName'],npc_presence:['name','subtitle'],
    recent_process_activity:['eventType','runId','equipmentId','name','outcome','ageBand'],recent_equipment_repair:['name','equipmentId','ageBand'],
    recent_ship_movement:['name','destination','movement','journeyKind','ageBand'],recent_research:['name','ageBand'],
    module_geometry:['name','category','width','length','depth','sizeBand','shallow','elongated'],
    vessel_geometry:['name','vesselClass','shape','width','length','depth'],
    vessel_composition:['name','moduleCount','dryMass','cargoVolume','fuelVolume'],
    recent_vessel_assembly:['name','ageBand']
  };
  const seen = new Set();
  for (const f of facts) {
    if (!f.key || seen.has(f.key) || !['current','history'].includes(f.basis) || !f.subject || !f.data ||
        !['coarse_local','facility_detail','cargo_detail','participant_private'].includes(f.exposure) ||
        ![f.importance,f.severity].every(n => Number.isFinite(n) && n>=0 && n<=1) ||
        f.basis === 'history' && (!Number.isSafeInteger(f.evidence.ledgerId) || !Number.isFinite(f.evidence.time))) throw new Error('Invalid narrative fact: '+f.key);
    if (!fields[f.kind] || Object.keys(f.data).some(k=>!fields[f.kind].includes(k)) || (f.kind.startsWith('recent_') ? f.basis!=='history' : f.basis!=='current')) throw new Error('Invalid typed narrative payload: '+f.kind);
    if (f.exposure==='coarse_local' && ['health','quantity','enabled','operational','pendingOutputs','available','capacity','equipmentNetRate','remaining','claimed','freeSlots','attachedRuns'].some(k=>Object.hasOwn(f.data,k))) throw new Error('Private values in coarse narrative projection.');
    seen.add(f.key);
  }
  return facts;
}
export function beatBasis(beat,facts) {
  const index = new Map(facts.map(f => [f.key,f]));
  if (!beat.factKeys?.length) throw new Error('A dynamic beat requires evidence.');
  if (!beat.claim?.clauses?.length || new Set(beat.factKeys).size!==beat.factKeys.length || beat.factKeys.some(k=>!beat.claim.clauses.some(c=>c.factKeys.includes(k)))) throw new Error('Invalid clause evidence coverage.');
  const bases = new Set(beat.factKeys.map(k => { const f=index.get(k); if (!f) throw new Error('Missing beat evidence: '+k); return f.basis; }));
  for (const clause of beat.claim.clauses) {
    if (!clause.factKeys.length || clause.factKeys.some(k => !beat.factKeys.includes(k) || index.get(k)?.basis !== clause.basis)) throw new Error('Invalid clause evidence.');
  }
  return bases.size === 2 ? 'mixed' : [...bases][0];
}
