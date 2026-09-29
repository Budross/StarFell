// Content tuning, not architectural constants. A changed version may change wording.
export const narrativeContent = {
  version:'2', seed:'habitat-narrative-v1',
  weights:{relevance:.30,severity:.25,importance:.20,locality:.10,relationship:.10,recency:.05},
  surfaces:{
    inspect_location:{limit:4,history:1,minimum:43,base:true,window:120,categories:{condition:1,problem:1,activity:1,presence:1,movement:1,support:1,research:1}},
    inspect_equipment:{limit:3,history:1,minimum:40,base:true,window:120,categories:{condition:1,activity:1,problem:1,support:1,presence:1}},
    npc_greeting:{limit:2,history:1,minimum:55,base:true,window:60,categories:{condition:1,activity:1,problem:1,support:1,presence:1}},
    npc_ambient:{limit:1,history:1,minimum:55,base:false,window:30,categories:{condition:1,activity:1,problem:1,support:1,presence:1}},
    operations_update:{limit:2,history:1,minimum:40,base:false,window:120,categories:{condition:1,activity:1,problem:1,support:1,movement:1}}
  },
  lexicon:{
    condition:{sound:['in good condition','sound'],worn:['showing some wear','worn'],degraded:['degraded','in poor condition'],badly_degraded:['badly degraded','in very poor condition'],inoperative:['inoperative','out of operation']},
    equipmentNames:{'Starting solar array':'the starting solar array','Ship engine':'the ship engine','Fabrication facility':'the fabrication facility',
      'Habitat life support':'habitat life support','Solar panel':'the solar panel','Battery Bank':'the battery bank',
      'Mineral extractor':'the mineral extractor','Thermal processor':'the thermal processor','Radio antenna':'the radio antenna',
      'Basic Crewed Core':'the basic crewed core','Basic Autonomous Core':'the basic autonomous core',
      'Small Cargo Module':'the small cargo module','Small Fuel Tank':'the small fuel tank',
      'Basic Reaction Thruster':'the basic reaction thruster','Basic Power Module':'the basic power module',
      'Basic Radio Module':'the basic radio module','Basic Extraction Module':'the basic extraction module',
      'Lightweight Cargo Module':'the lightweight cargo module','Improved Fuel Tank':'the improved fuel tank',
      'Efficient Drive Module':'the efficient drive module','Improved Extraction Module':'the improved extraction module'}
  },
  // Exact source text keeps each first-person base tied to an admitted identity fact.
  bases:{
    'Navigation beacons mark a metal-rich fragment.':'I find navigation beacons marking a metal-rich fragment.',
    'A dark asteroid turns beyond the collector swarm.':'I see a dark asteroid turning beyond the collector swarm.',
    'The exposed body contains dense, wear-resistant ore.':'I am near an exposed body known for dense, wear-resistant ore.',
    'Ice bands trace a cold body near the edge of the mapped region.':'I see ice bands tracing a cold body near the edge of the mapped region.',
    'Habitat 05 hangs among unfinished collectors. Navigation beacons outline the nearby platforms.':'I find Habitat 05 among unfinished collectors. Navigation beacons outline the nearby platforms.',
    'Fragments of a shattered asteroid drift among silent collectors. Extraction berths and a derelict relay lie within the debris field.':'Fragments of a shattered asteroid drift among silent collectors. I see extraction berths and a derelict relay within the debris field.',
    'Habitat 05 is a compact industrial habitat among the unfinished collectors.':'I am at Habitat 05, a compact industrial habitat among the unfinished collectors.',
    'The supply platform provides storage space in the Habitat 05 vicinity.':'I am at the supply platform, a storage space in the Habitat 05 vicinity.',
    'Dust covers the relay console. A frozen construction manifest records the last days of the swarm expansion.':'At the derelict relay, I find dust covering the console. A frozen construction manifest records the last days of the swarm expansion.',
    'A vessel assembled from installed modules.':'I am aboard a vessel assembled from installed modules.'
  },
  // Each family has one typed slot contract. Variants express the same claim.
  templates:{
    condition:{slots:['name','condition'],variants:[['plain','I find {name} {condition}.'],['condition','From what I can tell, {name} is {condition}.']]},
    disabled:{slots:['name'],variants:[['plain','I find {name} disabled.']]},
    diagnostic:{slots:['name','health','quantity'],variants:[['plain','I inspect {name}: {quantity} installed, condition {health}%.']]},
    idle:{slots:['name'],variants:[['plain','I find no process currently assigned to {name}.']]},
    working:{slots:['name'],variants:[['steady','I find a batch progressing normally in {name}.'],['underway','A batch is underway in {name}; I find its progress steady.']]},
    observed_work:{slots:['name'],variants:[['progress','I can tell work is progressing at {name}.']]},
    limited:{slots:['name'],variants:[['limited','I find the batch in {name} still progressing, though available power is limiting it.'],['throughput','I find the batch in {name} creeping forward on reduced power.']]},
    no_power:{slots:['name'],variants:[['waiting','I find work in {name} at a standstill, waiting for power.'],['stalled','I find the batch in {name} unable to advance until power is available.']]},
    unavailable:{slots:['name'],variants:[['machine','I find work in {name} blocked by unavailable equipment.']]},
    source_unavailable:{slots:['name'],variants:[['source','I find work in {name} waiting for access to its source.']]},
    delivery:{slots:['name'],variants:[['buffer','The work is done, but I find finished material still in {name}, awaiting delivery to storage.'],['held','I find the completed material still held by {name}; it has yet to reach storage.']]},
    delivery_full:{slots:['name'],variants:[['space','The finished material cannot fit in local storage, so I find it still held in {name}.'],['held','I find {name} holding finished material because local storage cannot fit it yet.']]},
    completed:{slots:['name','age'],variants:[['delivered','I note a batch from {name} was delivered to storage {age}.']]},
    idle_completed:{slots:['name','age'],variants:[['joint','I find no process assigned to {name} now. A batch from it was delivered to storage {age}.']]},
    started:{slots:['name','age'],variants:[['start','I note a process was started in {name} {age}.']]},
    aborted:{slots:['name','age'],variants:[['abort','I note a process in {name} was aborted {age}.']]},
    resumed:{slots:['name','age'],variants:[['resume','I note work in {name} resumed {age}.']]},
    blocked:{slots:['name','age'],variants:[['block','I note a process in {name} was interrupted {age}.']]},
    repaired:{slots:['name','age'],variants:[['repair','I note {name} was repaired {age}.']]},
    reserve:{slots:[],variants:[['empty','I find the local power reserve empty.']]},
    draining:{slots:[],variants:[['net','I find local power demand running ahead of generation.']]},
    storage:{slots:[],variants:[['full','I find local cargo storage nearly full.'],['room','There is little capacity left in local cargo storage when I check it.']]},
    overloaded:{slots:[],variants:[['over','I find local cargo storage loaded beyond its capacity.']]},
    depleted:{slots:['name'],variants:[['spent','I find the {name} deposit spent. There is nothing left to extract from it.'],['empty','I find nothing left to extract from the {name} deposit.']]},
    claimed:{slots:['name'],variants:[['claim','I find no unclaimed material in the {name} deposit; active extraction has claimed all that remains.']]},
    ship_docked:{slots:['name'],variants:[['berth','I find {name} docked here.']]},
    ship_area:{slots:['name'],variants:[['nearby','I find {name} in the local area.']]},
    ship_moving:{slots:['name','destination'],variants:[['transit','I find {name} traveling toward {destination}.']]},
    arrived:{slots:['name','destination','age'],variants:[['arrival','I note {name} arrived at {destination} {age}.']]},
    docked:{slots:['name','destination','age'],variants:[['dock','I note {name} docked at {destination} {age}.']]},
    arrived_area:{slots:['name','destination','age'],variants:[['area','I note {name} arrived in {destination} {age}.']]},
    departed:{slots:['name','destination','age'],variants:[['departure','I note {name} departed toward {destination} {age}.']]},
    vessel_layout:{slots:['name','shape','width','length','depth'],variants:[['layout','I have the dimensions for {name}: a {shape} envelope spanning {width} × {length} × {depth} m.']]},
    assembled_layout:{slots:['name','shape','width','length','depth','age'],variants:[['built','I note {name} was assembled {age}. Its current {shape} envelope spans {width} × {length} × {depth} m.']]},
    assembled:{slots:['name','age'],variants:[['built','I note {name} was assembled {age}.']]},
    vessel_composition:{slots:['name','moduleCount','dryMass','cargoVolume','fuelVolume'],variants:[['composition','I find {moduleCount} modules in {name}, with {dryMass} kg dry mass, {cargoVolume} m³ cargo volume, and {fuelVolume} m³ tank volume.']]},
    module_geometry:{slots:['name','category','width','length','depth','sizeBand'],variants:[['module','I inspect {name}: a {sizeBand} {category} module measuring {width} × {length} × {depth} m.']]},
    people:{slots:['name'],variants:[['local','{name} is here with me.']]},
    research:{slots:['name','age'],variants:[['learned','I note research established {name} {age}.']]}
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
  if (!source.lexicon?.equipmentNames || Object.entries(source.lexicon.equipmentNames).some(([name,phrase])=>!name.trim() || typeof phrase!=='string' || !phrase.trim() || /[{}]/.test(phrase))) throw new Error('Invalid equipment name lexicon.');
  if (!source.bases || Object.entries(source.bases).some(([original,phrasing])=>!original.trim() || typeof phrasing!=='string' || !phrasing.trim())) throw new Error('Invalid narrative base phrasing.');
}
