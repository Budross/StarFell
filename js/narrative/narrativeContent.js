// Content tuning, not architectural constants. A changed version may change wording.
export const narrativeContent = {
  version:'1', seed:'habitat-narrative-v1',
  weights:{relevance:.30,severity:.25,importance:.20,locality:.10,relationship:.10,recency:.05},
  surfaces:{
    inspect_location:{limit:4,history:1,minimum:43,base:true,window:120,categories:{condition:1,problem:1,activity:1,presence:1,movement:1,support:1,research:1}},
    inspect_equipment:{limit:3,history:1,minimum:40,base:true,window:120,categories:{condition:1,activity:1,problem:1,support:1,presence:1}},
    npc_greeting:{limit:2,history:1,minimum:55,base:true,window:60,categories:{condition:1,activity:1,problem:1,support:1,presence:1}},
    npc_ambient:{limit:1,history:1,minimum:55,base:false,window:30,categories:{condition:1,activity:1,problem:1,support:1,presence:1}},
    operations_update:{limit:2,history:1,minimum:40,base:false,window:120,categories:{condition:1,activity:1,problem:1,support:1,movement:1}}
  },
  lexicon:{condition:{sound:['in good condition','sound'],worn:['showing some wear','worn'],degraded:['degraded','in poor condition'],badly_degraded:['badly degraded','in very poor condition'],inoperative:['inoperative','out of operation']}},
  // Each family has one typed slot contract. Variants express the same claim.
  templates:{
    condition:{slots:['name','condition'],variants:[['plain','{name} looks {condition}.'],['condition','{name} appears {condition}.']]},
    disabled:{slots:['name'],variants:[['plain','{name} is disabled.']]},
    diagnostic:{slots:['name','health','quantity'],variants:[['plain','{name}: {quantity} installed; condition {health}%.']]},
    idle:{slots:['name'],variants:[['plain','No process is currently assigned to {name}.']]},
    working:{slots:['name'],variants:[['steady','{name}: a batch is progressing normally.'],['underway','{name} has a batch underway.']]},
    observed_work:{slots:['name'],variants:[['progress','{name}: work is progressing.']]},
    limited:{slots:['name'],variants:[['limited','{name}: available power is limiting work.'],['throughput','{name} is making reduced progress with the available power.']]},
    no_power:{slots:['name'],variants:[['waiting','{name}: work is waiting for power.']]},
    unavailable:{slots:['name'],variants:[['machine','{name}: work is blocked by unavailable equipment.']]},
    source_unavailable:{slots:['name'],variants:[['source','{name}: work is waiting for access to its source.']]},
    delivery:{slots:['name'],variants:[['buffer','{name} holds finished material awaiting delivery to storage.']]},
    delivery_full:{slots:['name'],variants:[['space','{name} holds finished material until storage has room.']]},
    completed:{slots:['name','age'],variants:[['delivered','A batch from {name} was delivered to storage {age}.']]},
    idle_completed:{slots:['name','age'],variants:[['joint','No process is assigned to {name} now, though a batch was delivered to storage {age}.']]},
    started:{slots:['name','age'],variants:[['start','A process was started in {name} {age}.']]},
    aborted:{slots:['name','age'],variants:[['abort','A process in {name} was aborted {age}.']]},
    resumed:{slots:['name','age'],variants:[['resume','Work in {name} resumed {age}.']]},
    blocked:{slots:['name','age'],variants:[['block','A process in {name} encountered an interruption {age}.']]},
    repaired:{slots:['name','age'],variants:[['repair','{name} was repaired {age}.']]},
    reserve:{slots:[],variants:[['empty','The local power reserve is empty.']]},
    draining:{slots:[],variants:[['net','Installed equipment consumes more power than it generates.']]},
    storage:{slots:[],variants:[['full','Local cargo storage is nearly full.']]},
    overloaded:{slots:[],variants:[['over','Local cargo storage is overloaded.']]},
    depleted:{slots:['name'],variants:[['spent','The {name} deposit has been exhausted.']]},
    claimed:{slots:['name'],variants:[['claim','The remaining {name} deposit is fully claimed by active extraction.']]},
    ship_docked:{slots:['name'],variants:[['berth','{name} is docked here.']]},
    ship_area:{slots:['name'],variants:[['nearby','{name} is in the local area.']]},
    ship_moving:{slots:['name','destination'],variants:[['transit','{name} is traveling toward {destination}.']]},
    arrived:{slots:['name','destination','age'],variants:[['arrival','{name} arrived at {destination} {age}.']]},
    docked:{slots:['name','destination','age'],variants:[['dock','{name} docked at {destination} {age}.']]},
    arrived_area:{slots:['name','destination','age'],variants:[['area','{name} arrived in {destination} {age}.']]},
    departed:{slots:['name','destination','age'],variants:[['departure','{name} departed toward {destination} {age}.']]},
    vessel_layout:{slots:['name','shape','width','length','depth'],variants:[['layout','{name} has a {shape} envelope spanning {width} × {length} × {depth} m.']]},
    assembled_layout:{slots:['name','shape','width','length','depth','age'],variants:[['built','{name} was assembled {age}. Its current {shape} envelope spans {width} × {length} × {depth} m.']]},
    assembled:{slots:['name','age'],variants:[['built','{name} was assembled {age}.']]},
    vessel_composition:{slots:['name','moduleCount','dryMass','cargoVolume','fuelVolume'],variants:[['composition','{name} carries {moduleCount} modules at {dryMass} kg dry mass, with {cargoVolume} m³ cargo and {fuelVolume} m³ tank volume.']]},
    module_geometry:{slots:['name','category','width','length','depth','sizeBand'],variants:[['module','{name} is a {sizeBand} {category} module measuring {width} × {length} × {depth} m.']]},
    people:{slots:['name'],variants:[['local','{name} is here.']]},
    research:{slots:['name','age'],variants:[['learned','Research established {name} {age}.']]}
  }
};

export function validateNarrativeContent(source) {
  if (!source || typeof source.version!=='string' || !source.version || !['string','number'].includes(typeof source.seed)) throw new Error('Invalid narrative content version/seed.');
  const keys=Object.keys(narrativeContent.weights);
  if (!source.weights || Object.keys(source.weights).length!==keys.length || keys.some(k=>!Number.isFinite(source.weights[k]) || source.weights[k]<0) || !keys.some(k=>source.weights[k]>0)) throw new Error('Invalid narrative score tuning.');
  for (const key of Object.keys(narrativeContent.surfaces)) {
    const policy=source.surfaces?.[key];
    if (!policy || ![policy.limit,policy.history].every(v=>Number.isSafeInteger(v) && v>=0) || !Number.isFinite(policy.minimum) || !Number.isFinite(policy.window) || policy.window<0 || typeof policy.base!=='boolean' || !policy.categories || Object.values(policy.categories).some(v=>!Number.isSafeInteger(v) || v<0)) throw new Error('Invalid narrative surface: '+key);
    if (key==='operations_update' && policy.base) throw new Error('Automatic updates cannot repeat base identity.');
  }
  for (const [family,contract] of Object.entries(narrativeContent.templates)) {
    const def=source.templates?.[family];
    if (!def || !Array.isArray(def.slots) || [...def.slots].sort().join('|')!==[...contract.slots].sort().join('|')) throw new Error('Incompatible narrative template contract: '+family);
  }
  for (const band of Object.keys(narrativeContent.lexicon.condition)) if (!source.lexicon?.condition?.[band]?.length || source.lexicon.condition[band].some(v=>typeof v!=='string' || !v.trim() || /[{}]/.test(v))) throw new Error('Invalid condition phrase lexicon: '+band);
}
