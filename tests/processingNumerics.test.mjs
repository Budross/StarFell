import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGameSystems } from '../js/bootstrap.js';
import { buildCatalog } from '../js/itemCatalog.js';
import { definitions } from '../js/content.js';
import { processingDefinitions } from '../js/processingContent.js';
import { startProcess } from '../js/processing.js';
import { advanceIndustrialInterval } from '../js/processingSimulation.js';
import { locationDefinitions } from '../js/locationContent.js';

export function numericFixture({ cap = 40,generation = 8,rates = [5],power = cap,duration = 100 } = {}) {
  const source = structuredClone(definitions); source.utilities.power.baseCapacity = cap;
  source.infrastructure.solar.powerPerSecond = generation; source.infrastructure.habitat.powerPerSecond = 0;
  const processSource = rates.map((powerRate,i) => ({ ...processingDefinitions[1],id: `numeric${i}`,powerRate,duration,startConditions: {},inputs: [{ itemId: 'electronicParts',amount: 1 }],outputs: [{ itemId: 'solarCells',amount: 1 }] }));
  const locationSource = structuredClone(locationDefinitions); locationSource.locations.habitat.initialResources.power = Math.min(8,cap);
  const systems = buildGameSystems({ content: buildCatalog(source),locationSource,processSource });
  const state = systems.stateServices.createInitialState(), host = state.locations.habitat;
  host.infrastructure.solar.health = 1; host.infrastructure.thermalProcessors.quantity = rates.length;
  host.resources.electronicParts = rates.length; host.resources.power = cap;
  for (let i=0;i<rates.length;i++) startProcess(state,{ hostId: 'habitat',equipmentId: 'thermalProcessors',processId: `numeric${i}` },systems.processing);
  host.resources.power = power;
  return { state,systems,cap,generation,rates,duration };
}

// Independent test oracle: the original generate/clamp then ordered work rule,
// driven at successively finer test-only quanta. No production integrator calls.
function reference(f,horizon,quantum) {
  let power = f.state.locations.habitat.resources.power, time = 0, generated = 0, spent = 0, output = 0;
  const work = f.rates.map(() => f.duration);
  while (time < horizon-1e-10) {
    const dt = Math.min(quantum,horizon-time), admitted = Math.min(f.generation*dt,Math.max(0,f.cap-power));
    power += admitted; generated += admitted;
    for (let i=0;i<work.length;i++) if (work[i] > 0) {
      const possible = Math.min(dt,work[i],f.rates[i] === 0 ? Infinity : power/f.rates[i]);
      power = Math.max(0,power-possible*f.rates[i]); spent += possible*f.rates[i]; work[i] = Math.max(0,work[i]-possible);
      if (work[i] < 1e-9) { work[i] = 0; output++; }
    }
    time += dt;
  }
  return { power,generated,spent,work,output };
}
function actual(f,horizon,pattern) {
  const state = structuredClone(f.state); let time = 0,index = 0,generated = 0,spent = 0;
  while (time < horizon-1e-10) {
    const dt = Math.min(pattern[index++ % pattern.length],horizon-time), stats = {};
    advanceIndustrialInterval(state,dt,f.systems.processing,stats); time += dt; generated += stats.acceptedGeneration; spent += stats.energySpent;
  }
  f.systems.validate(state);
  return { power: state.locations.habitat.resources.power,generated,spent,work: f.rates.map((_,i) => state.processing.runs[i+1]?.workRemaining ?? 0),output: state.locations.habitat.resources.solarCells };
}
const near = (a,b,tolerance,label) => assert.ok(Math.abs(a-b) <= tolerance,`${label}: ${a} versus ${b} (tolerance ${tolerance})`);
function compare(a,b,f,scale = 1) {
  near(a.power,b.power,scale*Math.max(1e-6,0.005*f.cap),'stored power');
  for (const k of ['generated','spent']) near(a[k],b[k],scale*Math.max(1e-6,0.001*Math.max(b[k],1)),k);
  a.work.forEach((w,i) => near(w,b.work[i],scale*Math.max(1e-6,0.001*f.duration),`run ${i+1}`));
  assert.equal(a.output,b.output);
}
test('battery-full witness integrates concurrent generation without frame-dependent lost energy', () => {
  const f = numericFixture();
  const a = actual(f,1,[1]), b = actual(f,1,[1/60]);
  near(a.power,40,1e-10,'full battery'); near(a.generated,5,1e-10,'captured generation'); near(a.spent,5,1e-10,'spent');
  compare(a,b,f);
});
test('fractional competing loads do not manufacture tiny battery charges or unrepresentable intervals', () => {
  const f = numericFixture({ generation: .5,rates: [.15,.15,.15,.15],power: 0 });
  compare(actual(f,60,[1/60]),reference(f,60,.000125),f);
  compare(actual(f,60,[5]),actual(f,60,[1/60]),f);
});
test('power/work match converged fine reference across capacities, demand, competition, jitter and stalls', () => {
  const patterns = [[1/30],[1/60],[1/144],[.008,.05,.017,.031,.012],[.25],[1]];
  for (const cap of [2,40]) for (const generation of [0,3,8,12]) for (const full of [false,true]) {
    const rates = generation === 0 ? [0,5] : generation === 3 ? [5,4,3] : [5];
    const f = numericFixture({ cap,generation,rates,power: full ? cap : 0 });
    for (const horizon of [1,10,60]) {
      let quantum = .00025, previous = reference(f,horizon,quantum), converged;
      for (let refinement=0;refinement<8;refinement++) {
        quantum /= 2; converged = reference(f,horizon,quantum);
        try { compare(previous,converged,f,.1); break; } catch (error) { if (refinement === 7) throw error; previous = converged; }
      }
      for (const pattern of patterns) compare(actual(f,horizon,pattern),converged,f);
    }
  }
});
test('discrete completion is identical after the 10 ms boundary window and never duplicates', () => {
  const f = numericFixture({ duration: .8,cap: 2,generation: 8,rates: [5,1] });
  for (const pattern of [[1/30],[1/144],[1],[.008,.05,.019]]) compare(actual(f,.811,pattern),reference(f,.811,.000125),f);
  const state = structuredClone(f.state); advanceIndustrialInterval(state,5,f.systems.processing);
  assert.equal(state.locations.habitat.resources.solarCells,2);
  assert.equal(state.worldLedger.entries.filter(e => e.type === 'PROCESS_COMPLETED').length,2);
});
