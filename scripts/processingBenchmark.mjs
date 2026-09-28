import { performance } from 'node:perf_hooks';
import { cpus, platform, release } from 'node:os';
import { writeFileSync } from 'node:fs';
import { buildGameSystems } from '../js/bootstrap.js';
import { locationDefinitions } from '../js/locationContent.js';
import { processingDefinitions } from '../js/processingContent.js';
import { startProcess } from '../js/processing.js';
import { advanceIndustrialInterval } from '../js/processingSimulation.js';
import { storageSummary } from '../js/storage.js';

function workload(count,hosts,scenario) {
  const locations = structuredClone(locationDefinitions);
  locations.templates = { industrialDepot: { type: 'platform',name: 'Industrial depot',description: 'Benchmark depot.',remoteDescription: 'Benchmark depot.',
    capacities: { power: 40 },initialResources: { power: 40 },initialInfrastructure: {} } };
  const systems = buildGameSystems({ locationSource: locations,processSource: [{ ...processingDefinitions[1],startConditions: {},duration: 100,
    inputs: [{ itemId: 'electronicParts',amount: 1 }],outputs: [{ itemId: 'solarCells',amount: 1 }] }] });
  const state = systems.stateServices.createInitialState(), hostIds = [];
  for (let h=0;h<hosts;h++) {
    const id = systems.worldOperations.spawnEntity(state,{ type: 'site',definitionId: 'industrialDepot',areaId: 'vicinity',ownerId: 'player' });
    hostIds.push(id); state.locations[id].resources.electronicParts = count; state.locations[id].infrastructure.thermalProcessors.quantity = count;
  }
  for (let i=0;i<count;i++) startProcess(state,{ hostId: hostIds[i%hosts],equipmentId: 'thermalProcessors',processId: 'processSolarCells' },systems.processing);
  if (scenario === 'steady') {
    for (const id of hostIds) { state.locations[id].resources.power = 0; state.locations[id].infrastructure.solar.quantity = 1; state.locations[id].infrastructure.solar.health = 1; }
    // Established waiting runs measure steady updates, not a repeated artificial
    // first-block edge. The completion scenario separately measures real edges.
    advanceIndustrialInterval(state,.001,systems.processing);
  } else if (scenario === 'buffered') {
    for (const r of Object.values(state.processing.runs)) { r.phase = 'delivery'; r.workRemaining = 0; r.blockedReason = 'OUTPUT_FULL'; }
    for (const id of hostIds) { const s = storageSummary(systems.contextFor(state,id).store,systems.content); state.locations[id].resources.scrap = s.capacityVolumeUnits-s.usedVolumeUnits; }
  } else {
    for (const r of Object.values(state.processing.runs)) r.workRemaining = .025;
  }
  systems.validate(state); return { systems,state };
}
const result = { runtime: process.version,platform: `${platform()} ${release()}`,cpu: cpus()[0].model,strategy: 'physical-boundary integration',samples: [] };
for (const [count,hosts] of [[1,1],[32,8],[128,32]]) for (const scenario of ['steady','buffered','completion']) {
  const f = workload(count,hosts,scenario);
  for (const elapsed of [1/60,.25,1,5]) {
    const repeats = elapsed === 1/60 ? 1000 : 30, times = []; let visits = 0,intervals = 0;
    for (let i=-100;i<repeats;i++) {
      const state = structuredClone(f.state), stats = {}, begin = performance.now();
      advanceIndustrialInterval(state,elapsed,f.systems.processing,stats);
      const time = performance.now()-begin;
      if (i >= 0) { times.push(time); visits = Math.max(visits,stats.runVisits); intervals = Math.max(intervals,stats.intervals); }
    }
    times.sort((a,b) => a-b);
    const p95 = times[Math.floor(times.length*.95)], budget = elapsed === 1/60 ? 4 : elapsed <= 1 ? 50 : 200;
    result.samples.push({ count,hosts,scenario,elapsed,repeats,medianMs: times[Math.floor(times.length*.5)],p95Ms: p95,maxIntervals: intervals,maxRunVisits: visits,budgetMs: budget,passes: p95 <= budget });
  }
}
writeFileSync(new URL('../artifacts/processing-performance.json',import.meta.url),JSON.stringify(result,null,2));
console.log(JSON.stringify({ runtime: result.runtime,cpu: result.cpu,samples: result.samples.length,allPass: result.samples.every(s => s.passes),worstNormalMs: Math.max(...result.samples.filter(s => s.elapsed === 1/60).map(s => s.p95Ms)),worstOneSecondMs: Math.max(...result.samples.filter(s => s.elapsed === 1).map(s => s.p95Ms)),worstFiveSecondMs: Math.max(...result.samples.filter(s => s.elapsed === 5).map(s => s.p95Ms)) },null,2));
if (!result.samples.every(s => s.passes)) process.exitCode = 1;
