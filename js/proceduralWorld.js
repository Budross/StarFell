// Creation only. Once installed, Locations/Entities/Processing own ordinary facts.
import {placeDestinations,deriveTopology} from './spatialGeneration.js';
import {createMaterialFields,generateAsteroid,naturalResourceIds} from './asteroidGeneration.js';
import {compareKeys,distanceSquared,validateSpace} from './worldSpace.js';
import {allocateEntityId,makeEntity} from './entities.js';
import {createLocationState,freezeAuthoredGeography} from './locations.js';
import {defaultAccess} from './authority.js';
import {emptyMapKnowledge,admitKnownArea,admitDetectedArea} from './mapKnowledge.js';

export function compileGenerationProfile(source,content) {
  const p=structuredClone(source);validateSpace(p.space);
  if(typeof p.generatorRevision!=='string'||!p.generatorRevision.trim())throw new Error('Invalid generator revision.');
  const positive=(n,integer=false)=>Number.isFinite(n)&&n>0&&(!integer||Number.isSafeInteger(n));
  const {placement:a,topology:t,geology:g,chart:c}=p;
  if(!a||!t||!g||!c||!positive(a.targetCount,true)||!positive(a.maxCount,true)||a.targetCount>a.maxCount||a.maxCount>160||!positive(a.minSpacing)||!positive(a.patchCount,true)||!(a.densityFloor>0&&a.densityFloor<=1)||!(a.startDensity>0&&a.startDensity<=1)||!positive(a.startRadius)||!positive(t.maxDistance)||!Number.isSafeInteger(t.extraEdgesPerNode)||t.extraEdgesPerNode<0||!positive(t.maxAttempts,true)||t.maxAttempts>8)throw new Error('Invalid spatial generation profile.');
  if(!g.motifs||!Object.keys(g.motifs).length||Object.values(g.motifs).some(m=>Object.keys(m).sort().join(',')!=='carbon,metal,rare,refractory,silicate,volatile'||Object.values(m).some(n=>!Number.isFinite(n)||n<0||n>1))||![g.outlierProbability,g.minAbundance].every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw new Error('Invalid material motifs.');
  if(!positive(g.patchCount,true)||!positive(g.patchRadius)||!positive(g.maxNodes,true)||g.maxNodes>8||!positive(g.batchUnits,true)||!Number.isFinite(g.localVariance)||g.localVariance<0||g.localVariance>1||!['rareGate','refractoryGate','uraniumGate'].every(k=>g[k]>=0&&g[k]<=1)||!Array.isArray(g.budgetsM3)||g.budgetsM3.length!==4||!g.budgetsM3.every(n=>positive(n)&&n<=100)||!Array.isArray(g.budgetWeights)||g.budgetWeights.length!==4||g.budgetWeights.some(n=>!positive(n))||Math.abs(g.budgetWeights.reduce((a,b)=>a+b,0)-1)>1e-9)throw new Error('Invalid asteroid profile.');
  if(!g.resources||Object.entries(g.resources).some(([id,r])=>!naturalResourceIds.includes(id)||content.items[id]?.category!=='resource'||!positive(r.weight)||!['metal','silicate','volatile','carbon','refractory','rare'].includes(r.field)||r.associate&&!['metal','silicate','volatile','carbon','refractory','rare'].includes(r.associate)||r.gate&&!['rare','refractory','uranium'].includes(r.gate)))throw new Error('Invalid natural Resources.');
  if(!g.resources.ironOre||!positive(c.approximateStep)||![c.knownGenerated,c.detectedGenerated].every(n=>Number.isSafeInteger(n)&&n>=0))throw new Error('Invalid starting chart.');
  return p;
}
export function buildWorldManifest(seed,profile,anchors,startAreaId,requiredEdges=[]) {
  if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new Error('World seed must be uint32.');
  const authored=[...anchors].sort((a,b)=>compareKeys(a.id,b.id)),start=authored.find(a=>a.id===startAreaId);
  if(!start)throw new Error('Missing starting anchor.');
  const sample=createMaterialFields(seed,profile);
  for(let attempt=0;attempt<profile.topology.maxAttempts;attempt++) {
    const positions=placeDestinations(seed,profile,authored,start.position,attempt);
    const graph=deriveTopology([...authored,...positions.map(p=>({id:p.placementKey,position:p.position}))],startAreaId,profile.topology,requiredEdges);
    if(authored.some(a=>!graph.reachable.includes(a.id)))continue;
    const bodies=positions.filter(p=>graph.reachable.includes(p.placementKey)).map(p=>({...p,...generateAsteroid(seed,p,profile,sample,start.position)}));
    if(!bodies.some(b=>distanceSquared(start.position,b.position)<=profile.topology.maxDistance**2 && Object.values(b.resourceNodes).some(n=>n.resourceId==='ironOre'&&n.initialReserve>=profile.geology.batchUnits)))continue;
    return {seed,generatorRevision:profile.generatorRevision,acceptedAttempt:attempt,startAreaId,connectionDistance:profile.topology.maxDistance,space:structuredClone(profile.space),anchors:authored,bodies,edges:graph.edges};
  }
  throw new Error('Could not create a connected, playable physical world within bounded attempts.');
}
export function installFreshWorld(state,content,world,seed) {
  if(state.worldGeography||state.mapKnowledge||state.simulationTime!==0||state.processing||state.worldLedger)throw new Error('Physical installation requires an uninitialized fresh world.');
  const p=world.generationProfile;
  const geography=freezeAuthoredGeography(state,world,seed,p?.space);
  const startAreaId=state.locations[world.startId].areaId;
  const anchors=Object.entries(geography.areas).map(([id,a])=>({id,...a,...world.definitions[id].generationConstraints}));
  const manifest=p?buildWorldManifest(seed,p,anchors,startAreaId,world.links):null;
  // No state is installed until the entire detached physical manifest succeeds.
  state.worldGeography=geography;
  state.mapKnowledge=emptyMapKnowledge();
  if(p) {
    // Preserve existing authored routes as a concrete compatibility constraint.
    const g=state.worldGeography;g.generatorRevision=manifest.generatorRevision;g.acceptedAttempt=manifest.acceptedAttempt;g.connectionDistance=manifest.connectionDistance;
    const ids=new Map(anchors.map(a=>[a.id,a.id]));
    for(const body of manifest.bodies) {
      const areaId=allocateEntityId(state,'area'),siteId=allocateEntityId(state,'site');ids.set(body.placementKey,areaId);
      const area={...structuredClone(world.definitions[startAreaId]),id:areaId,name:`Asteroid ${body.cell.join('-')}`,position:body.position,primaryLocalId:siteId,conditions:{},initialMapKnowledge:'UNKNOWN',resourceNodes:{},sceneObjects:[],startupMessages:[],inspectionEffects:[],actions:[],actionSets:[],description:'A notable natural body.',remoteDescription:'A charted natural body.'};
      delete area.narrative;delete area.generationConstraints;delete area.initialMapKnowledge;area.nodeStatePolicy='frozenRuntime';
      const site={...structuredClone(world.definitions.naturalBody),id:siteId,spawn:true,areaId,name:`Body ${body.cell.join('-')}`,resourceNodes:body.resourceNodes,bodyCharacter:body.bodyCharacter,nodeStatePolicy:'frozenRuntime'};
      delete site.definitionId;
      g.areas[areaId]={position:[...body.position],cell:[...body.cell],primaryLocalId:siteId,placementKey:body.placementKey};
      // Frozen facts must round-trip through the actual JSON save codec.
      g.generatedLocationFactsById[areaId]=JSON.parse(JSON.stringify(area));g.generatedLocationFactsById[siteId]=JSON.parse(JSON.stringify(site));
      for(const def of [area,site]) {
        state.entities[def.id]=makeEntity(def.id,def.kind,{catalog:'locations',id:def.id},state.simulationTime,{origin:'generated',access:defaultAccess(def)});
        const local=createLocationState(def,content);delete local.ownerId;state.locations[def.id]=local;
      }
    }
    g.physicalEdges=manifest.edges.map(e=>e.map(id=>ids.get(id))).map(e=>e.sort(compareKeys)).sort((a,b)=>compareKeys(a.join('/'),b.join('/')));
    // Initial charts teach only navigation, never geological/deposit facts.
    const direct=new Set(g.physicalEdges.flatMap(([a,b])=>a===startAreaId?[b]:b===startAreaId?[a]:[]));
    const generated=Object.keys(g.areas).filter(id=>g.generatedLocationFactsById[id]).sort((a,b)=>(direct.has(b)-direct.has(a))||distanceSquared(g.areas[a].position,g.areas[startAreaId].position)-distanceSquared(g.areas[b].position,g.areas[startAreaId].position)||compareKeys(a,b));
    for(const id of generated.slice(0,p.chart.knownGenerated)) {
      // Admit the complete transit path if no direct starter edge exists.
      const queue=[[startAreaId]],seen=new Set([startAreaId]);let path;
      while(queue.length){const current=queue.shift();if(current.at(-1)===id){path=current;break;}for(const [a,b] of g.physicalEdges){const next=a===current.at(-1)?b:b===current.at(-1)?a:null;if(next&&!seen.has(next)){seen.add(next);queue.push([...current,next]);}}}
      for(const step of path??[])admitKnownArea(state,step);
    }
    for(const id of generated.filter(id=>!state.mapKnowledge.areas[id]).slice(0,p.chart.detectedGenerated)) {
      const approx=g.areas[id].position.map((v,i)=>Math.min(p.space.max[i]-1,Math.max(p.space.min[i],Math.round(v/p.chart.approximateStep)*p.chart.approximateStep)));
      admitDetectedArea(state,id,approx,'Starting navigation chart');
    }
  }
}

// Developer analysis classifies physical output after generation. Its labels are
// neither saved geography nor contracts consumed by gameplay.
export function analyzeWorldManifest(manifest) {
  const areas=[...manifest.anchors,...manifest.bodies.map(b=>({id:b.placementKey,position:b.position}))],byId=new Map(areas.map(a=>[a.id,a]));
  const degrees=Object.fromEntries(areas.map(a=>[a.id,0])),edgeLengths=[];
  for(const [a,b] of manifest.edges){degrees[a]++;degrees[b]++;edgeLengths.push(Math.sqrt(distanceSquared(byId.get(a).position,byId.get(b).position)));}
  const reached=new Set(areas.length?[areas[0].id]:[]);let changed=true;
  while(changed){changed=false;for(const [a,b] of manifest.edges)if(reached.has(a)!==reached.has(b)){reached.add(a);reached.add(b);changed=true;}}
  const resources={},tiles={},cells=manifest.space.max.map((v,i)=>(v-manifest.space.min[i])/manifest.space.cellSize);
  for(const b of manifest.bodies) {
    const tile=b.cell.map(n=>Math.floor(n/8)).join('/');tiles[tile]??={areas:0,reserveUnits:0,resources:{}};tiles[tile].areas++;
    for(const node of Object.values(b.resourceNodes)) {
      resources[node.resourceId]??={deposits:0,reserveUnits:0,tiles:{}};
      const r=resources[node.resourceId];r.deposits++;r.reserveUnits+=node.initialReserve;r.tiles[tile]=(r.tiles[tile]??0)+node.initialReserve;
      tiles[tile].reserveUnits+=node.initialReserve;tiles[tile].resources[node.resourceId]=(tiles[tile].resources[node.resourceId]??0)+node.initialReserve;
    }
  }
  for(const r of Object.values(resources)){r.occurrencePercentage=100*r.deposits/manifest.bodies.length;r.occupiedTiles=Object.keys(r.tiles).length;}
  const tileCount=Math.ceil(cells[0]/8)*Math.ceil(cells[1]/8),totalReserve=Object.values(tiles).reduce((n,t)=>n+t.reserveUnits,0),mean=totalReserve/tileCount;
  const hubs=Object.entries(tiles).filter(([,t])=>t.areas>=3&&t.reserveUnits>=mean*2).map(([id])=>id);
  const deadZones=[];
  for(let x=0;x<Math.ceil(cells[0]/8);x++)for(let y=0;y<Math.ceil(cells[1]/8);y++){const id=`${x}/${y}`,t=tiles[id];if(!t||t.areas<=1||t.reserveUnits<mean*.1)deadZones.push(id);}
  return {seed:manifest.seed,generatorRevision:manifest.generatorRevision,attempt:manifest.acceptedAttempt,areaCount:areas.length,authoredCount:manifest.anchors.length,proceduralCount:manifest.bodies.length,reachableCount:reached.size,
    edgeLengths:edgeLengths.sort((a,b)=>a-b),degrees,emptySpaceProportion:1-areas.length/(cells[0]*cells[1]),resources,tiles,hubs,deadZones,
    startingRegionViable:manifest.bodies.some(b=>distanceSquared(b.position,byId.get(manifest.startAreaId).position)<=manifest.connectionDistance**2&&Object.values(b.resourceNodes).some(n=>n.tags.includes('solid')&&n.initialReserve>=10000)),warnings:Object.entries(degrees).filter(([,n])=>n>8).map(([id,n])=>`High degree: ${id} (${n})`)};
}
