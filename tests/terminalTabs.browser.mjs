// Run with Playwright available: node --test tests/terminalTabs.browser.mjs
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildGameSystems } from '../js/bootstrap.js';
import { startProcess } from '../js/processing.js';

const { chromium } = createRequire(import.meta.url)("playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const saveKey = "habitat-07-barebones-save";
let server, browser, origin;

before(async () => {
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const file = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
    try {
      const body = await readFile(file);
      response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[path.extname(file)] || "text/plain");
      response.end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { channel: "chrome" } : {}) });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
});

async function installShipFixture(page) {
  await page.route("**/js/locationContent.js", async route => {
    const response = await route.fetch();
    const ship = { name: "Test courier", type: "ship", areaId: "vicinity", initialDockedAtId: "habitat", initialOwnerId: "player",
      description: "A cargo hold and flight console.", remoteDescription: "A test courier.", localTravelDistance: 20,
      initialResources: { power: 30, scrap: 0.07 }, initialInfrastructure: { engine: { quantity: 1 }, solar: { quantity: 1 } } };
    await route.fulfill({ response, body: (await response.text()) + `\nObject.assign(locationDefinitions.locations, ${JSON.stringify({ courier: ship, passenger: { ...ship, name: "Passenger ship", initialOwnerId: null } })});` });
  });
}

test("a new action family links from production content before startup state validation", async t => {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/js/locationContent.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) +
      '\nlocationDefinitions.locations.habitat.actionSets = ["survey"];' });
  });
  await page.route("**/js/app.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace("buildGameSystems()", `buildGameSystems({
      createAdditionalActions: () => [{ id: "surveyHull", name: "Survey hull", collection: "survey", access: "public",
        execute(state, context) { state.locations[context.id].flags.surveyed = true; return "Surveyed."; }
      }]
    })`) });
  });
  await page.goto(origin);
  await page.locator('[data-action="surveyHull"]').click();
  assert.equal((await savedGame(page)).locations.habitat.flags.surveyed, true);
  assert.equal(await page.locator("#terminal-feedback").textContent(), "Surveyed.");
  assert.deepEqual(errors, []);
});

async function command(page, text) {
  await page.locator("#command-input").fill(text);
  await page.locator("#command-input").press("Enter");
}

async function game(t, viewport = { width: 1440, height: 900 }, ships = false) {
  const context = await browser.newContext({ viewport });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  if (ships) await installShipFixture(page);
  await page.goto(origin);
  await page.waitForSelector("#player-actions button");
  return { page, errors };
}

async function generatedGame(t) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/js/locationContent.js", async route => {
    const response = await route.fetch();
    const templates = {
      generatedShip: { type: "ship", name: "Freighter", description: "A generated freighter.", remoteDescription: "A generated freighter.",
        initialResources: { power: 30, scrap: 0.04 }, initialInfrastructure: { engine: { quantity: 1 }, fabricator: { quantity: 1 } },
        sceneObjects: [{ id: "bridge", name: "Bridge console", description: "A quiet bridge." }] },
      generatedDepot: { type: "platform", name: "Depot", description: "A generated depot.", remoteDescription: "A generated depot.",
        initialResources: { power: 10, scrap: 0.04 }, initialInfrastructure: { fabricator: { quantity: 1 } } }
    };
    await route.fulfill({ response, body: (await response.text()) + `\nlocationDefinitions.templates = ${JSON.stringify(templates)};` });
  });
  await page.route("**/js/npcContent.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + '\nnpcDefinitions.merchantTemplate = { spawn: false, name: "Merchant", description: "A visiting merchant.", dialogueGroups: ["habitatCrew"] };' });
  });
  await page.goto(origin); await page.waitForSelector("#player-actions button");
  const fixture = await page.evaluate(async key => {
    const { buildGameSystems } = await import('/js/bootstrap.js');
    const { createEntities } = await import('/js/entityCreation.js');
    const { createGameRuntime } = await import('/js/runtime.js');
    const systems = buildGameSystems();
    const runtime = createGameRuntime({ ...systems, initialState: JSON.parse(localStorage.getItem(key)), save() {} });
    let ids;
    runtime.applyAction(s => { ids = createEntities(s, systems, [
      { type: 'ship', definitionId: 'generatedShip', areaId: 'vicinity', dockedAtId: 'habitat', ownerId: 'player', displayName: 'Carina' },
      { type: 'npc', definitionId: 'merchantTemplate', locationId: 'habitat', displayName: 'Edda' },
      { type: 'site', definitionId: 'generatedDepot', areaId: 'vicinity', ownerId: 'player', displayName: 'Remote bench' }
    ]); });
    return { state: runtime.getState(), ids };
  }, saveKey);
  await replaceSavedGame(page, fixture.state);
  return { page, errors, ids: fixture.ids };
}

async function screenshot(page, name) {
  if (!process.env.TERMINAL_SCREENSHOTS) return;
  await mkdir(process.env.TERMINAL_SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: path.join(process.env.TERMINAL_SCREENSHOTS, `${name}.png`), fullPage: true });
}

for (const width of [1440, 390]) test(`Shipyard drafts, assembly receipt and fuel controls at ${width}px`, async t => {
  const { page, errors } = await game(t, { width, height: 900 });
  await page.route('**/js/app.js', async route => { const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + '\nwindow.__shipyardTest={advance(seconds){runtime.advance(seconds);render();}};' }); });
  const systems = buildGameSystems(), seed = systems.stateServices.createInitialState(91), h = seed.locations.habitat;
  h.resources.structuralFrame = 7; h.resources.reactionMassCartridge = 25; h.resources.power = 10;
  h.infrastructure.installedAntenna.quantity = 1;
  const modules = ['basicAutonomousCore','smallCargoModule','smallFuelTank','basicReactionThruster','basicPowerModule','basicRadioModule','basicExtractionModule'];
  for (const id of modules) h.resources[id] = 1;
  systems.stateServices.validateState(seed);
  await replaceSavedGame(page, seed);
  await page.getByRole('tab', { name: 'Shipyard' }).click();
  assert.equal(await page.locator('#yard-palette button[data-module-id]').count(), 7);
  assert.match(await page.locator('#yard-palette').textContent(), /Recovered.*hardware/);
  assert.equal((await savedGame(page)).worldLedger.entries.length, 0);
  for (const [id, x, y] of [
    ['basicAutonomousCore',0,0],['smallCargoModule',-2,0],['basicPowerModule',1,0],
    ['smallFuelTank',2,0],['basicReactionThruster',3,0],['basicRadioModule',0,-1],['basicExtractionModule',0,1]
  ]) {
    await page.locator(`#yard-palette button[data-module-id="${id}"]`).click();
    await page.locator('#yard-x').fill(String(x)); await page.locator('#yard-y').fill(String(y));
    await page.locator('#yard-place-button').click();
  }
  assert.match(await page.locator('#yard-metrics').textContent(), /DRY MASS 318 kg/);
  assert.match(await page.locator('#yard-frames').textContent(), /Required: 7 \/ Available: 7/);
  await page.locator('#yard-name').fill('Prospector One');
  assert.equal(await page.locator('#yard-assemble').isEnabled(), true);
  await screenshot(page, `shipyard-${width}`);
  await page.locator('#yard-assemble').click();
  const committed = await savedGame(page), id = Object.keys(committed.entities).find(id => committed.locations[id]?.assembly);
  assert.ok(id); assert.equal(committed.entities[id].displayName, 'Prospector One');
  assert.deepEqual(committed.worldLedger.entries.map(e => e.type), ['VESSEL_ASSEMBLED']);
  assert.equal(committed.locations[id].resources.power, 0);
  assert.match(await page.locator('#narrative-stream').textContent(), /assembled.*current.*envelope/s);
  await page.getByRole('tab', { name: 'Locations' }).click();
  assert.match(await page.locator('#vc-status').textContent(), /Prospector One/);
  await page.locator('#vc-fuel-cargo').selectOption('habitat');
  assert.equal(await page.locator('#vc-load').isEnabled(), true);
  await page.locator('#vc-fuel-amount').fill('25');
  await page.locator('#vc-load').click();
  assert.equal((await savedGame(page)).locations[id].fuel.items.reactionMassCartridge, 25);
  await page.reload();
  await page.getByRole('tab', { name: 'Locations' }).click();
  assert.match(await page.locator('#vc-fuel').textContent(), /25 Reaction-Mass Cartridge/);
  await page.evaluate(() => window.__shipyardTest.advance(20));
  await page.locator('#vc-undock').click();
  await page.locator('#vc-area').selectOption('metallicFragmentArea');
  assert.match(await page.locator('#vc-area-quote').textContent(), /6 cartridges/);
  await page.locator('#vc-travel').click(); await page.evaluate(() => window.__shipyardTest.advance(6));
  await page.locator('#vc-site').selectOption('metallicFragment');
  await page.locator('#vc-dock').click(); await page.evaluate(() => window.__shipyardTest.advance(2));
  const titanium = await page.locator('#vc-process option').filter({ hasText: 'Titanium Ore' }).getAttribute('value');
  assert.ok(titanium); await page.locator('#vc-process').selectOption(titanium);
  assert.equal(await page.locator('#vc-start').isEnabled(), true);
  await page.locator('#vc-start').click(); await page.evaluate(() => window.__shipyardTest.advance(21));
  assert.equal((await savedGame(page)).locations[id].resources.titaniumOre, 10000);
  await page.locator('#vc-undock').click(); await page.locator('#vc-area').selectOption('vicinity');
  await page.locator('#vc-travel').click(); await page.evaluate(() => window.__shipyardTest.advance(6));
  await page.locator('#vc-site').selectOption('habitat'); await page.locator('#vc-dock').click();
  await page.evaluate(() => window.__shipyardTest.advance(2));
  await page.locator('#vc-direction').selectOption('unload');
  await page.locator('#vc-transfer-item').selectOption('titaniumOre'); await page.locator('#vc-transfer-amount').fill('0.01');
  await page.locator('#vc-transfer').click();
  assert.equal((await savedGame(page)).locations.habitat.resources.titaniumOre, 10000);
  assert.deepEqual(errors, []);
});

async function savedGame(page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey); }
async function replaceSavedGame(page, saved) {
  await page.evaluate(({ key, saved }) => {
    localStorage.setItem(key, JSON.stringify(saved));
    Storage.prototype.setItem = function () {}; // Preserve the fixture across pagehide.
  }, { key: saveKey, saved });
  await page.reload();
}

async function processingGame(t,{ power = 10,width = 1440 } = {}) {
  const context = await browser.newContext({ viewport: { width,height: 900 } }); t.after(() => context.close());
  const page = await context.newPage(), errors = []; page.on('pageerror',e => errors.push(e.message));
  const systems = buildGameSystems(), seed = systems.stateServices.createInitialState();
  seed.knowledge.discoveries.photovoltaicFabrication = true;
  const h = seed.locations.habitat;
  h.resources.power = power; h.resources.siliconMinerals = 120000; h.resources.electronicParts = 4;
  h.infrastructure.solar.quantity = h.infrastructure.habitat.quantity = 0;
  h.infrastructure.thermalProcessors.quantity = 2; h.infrastructure.mineralExtractors.quantity = 1;
  await context.addInitScript(({ seed,key }) => { if (!localStorage.getItem(key)) localStorage.setItem(key,JSON.stringify(seed)); },{ seed,key: saveKey });
  await page.route('**/js/app.js',async route => {
    const response = await route.fetch();
    const body = (await response.text()).replace('buildGameSystems()',`buildGameSystems({ createAdditionalActions: systems => [
      { id: 'advanceIndustrialTest',name: 'Advance industrial fixture',scope: 'global',permissions: [],group: 'test',execute(state) { advanceIndustrialInterval(state,30,systems.processing); return 'Advanced'; } },
      { id: 'fillIndustrialTest',name: 'Fill industrial storage',scope: 'global',permissions: [],group: 'test',execute(state) { state.locations.habitat.resources.scrap = 0; const summary = storageSummary(systems.processing.contextFor(state,state.locationId).store,systems.content); state.locations.habitat.resources.scrap = summary.capacityVolumeUnits-summary.usedVolumeUnits; return 'Filled'; } },
      { id: 'unloadIndustrialTest',name: 'Disable machine and clear storage',scope: 'global',permissions: [],group: 'test',execute(state) { state.locations.habitat.resources.scrap = 0; state.locations.habitat.infrastructure.thermalProcessors.enabled = false; advanceIndustrialInterval(state,1,systems.processing); return 'Unloaded'; } }
    ] })`);
    await route.fulfill({ response,body: `import { advanceIndustrialInterval } from './processingSimulation.js';\nimport { storageSummary } from './storage.js';\n${body}` });
  });
  await page.goto(origin); await page.getByRole('tab',{ name: 'Workshop' }).click();
  return { page,errors };
}

// Drive the actual application's frame callback at explicit timestamps. No
// waiting for a real batch, and no test-only gameplay path in production code.
async function narrativeGame(t,{buffered=false,width=1440,legacyLog=false}={}) {
  const context=await browser.newContext({viewport:{width,height:900}}); t.after(()=>context.close());
  const page=await context.newPage(),errors=[]; page.on('pageerror',e=>errors.push(e.message));
  if (legacyLog) {
    page.on('console',message=> { if (message.type()==='error' && message.text().includes('Could not present narrative')) errors.push(message.text()); });
    await page.route('**/js/consoleDisplay.js*',async route=> {
      const response=await route.fetch();
      const body=(await response.text()).replace(/,\s*revealLatest\(\) \{[\s\S]*?position=capturePosition\(\);\s*\}/,'');
      assert.ok(!body.includes('revealLatest'));
      await route.fulfill({response,body});
    });
  }
  const systems=buildGameSystems(),seed=systems.stateServices.createInitialState(1),h=seed.locations.habitat;
  seed.knowledge.discoveries.photovoltaicFabrication=true; seed.knowledge.discoveries.structuralFabrication=true;
  h.resources.power=buffered?4.6:.01; h.resources.siliconMinerals=120000; h.resources.electronicParts=4; h.resources.iron=2;
  h.infrastructure.habitat.quantity=0; h.infrastructure.solar.quantity=buffered?0:1; h.infrastructure.solar.health=.2;
  h.infrastructure.thermalProcessors.quantity=2; h.infrastructure.mineralExtractors.quantity=1;
  if (buffered) { h.resourceNodes.surfaceMinerals.remaining=10000; startProcess(seed,{hostId:'habitat',equipmentId:'mineralExtractors',processId:'surfaceMineralExtraction',sourceLocationId:'habitat',nodeId:'surfaceMinerals'},systems.processing); }
  startProcess(seed,{hostId:'habitat',equipmentId:'thermalProcessors',processId:'processSolarCells'},systems.processing);
  if (buffered) h.resources.scrap=9900000;
  systems.validate(seed);
  await context.addInitScript(({seed,key})=> { window.requestAnimationFrame=()=>0; if (!localStorage.getItem(key)) localStorage.setItem(key,JSON.stringify(seed)); },{seed,key:saveKey});
  await page.route('**/js/app.js',async route=> {
    const response=await route.fetch();
    const body=(await response.text()).replace('safeNarrative(()=>narrativePresentation.committed(result));','window.__lastNarrativeCommit=result; safeNarrative(()=>narrativePresentation.committed(result));');
    await route.fulfill({response,body:body+'\nwindow.__narrativeTest={ frame:gameLoop, state:()=>runtime.getState(), replay(){safeNarrative(()=>narrativePresentation.committed(window.__lastNarrativeCommit));} };'});
  });
  await page.goto(origin); await page.waitForFunction(()=>!!window.__narrativeTest); await page.evaluate(()=>window.__narrativeTest.frame(0));
  return {page,errors};
}

test('observations remain visible with a cached display lacking revealLatest',async t=> {
  const {page,errors}=await narrativeGame(t,{legacyLog:true});
  const assertReceiptVisible=async()=> {
    assert.equal(await page.locator('#terminal-tab-operations').getAttribute('aria-selected'),'true');
    assert.ok(await page.locator('#narrative-stream').evaluate(stream=> {
      const latest=stream.querySelector('.log-entry:last-of-type').getBoundingClientRect(),bounds=stream.getBoundingClientRect();
      return latest.top<bounds.bottom && latest.bottom>bounds.top;
    }));
    assert.equal(await page.locator('#narrative-stream .error').count(),0);
  };
  await command(page,'look');
  await assertReceiptVisible();
  await page.locator('[data-action="observe-equipment:habitat:solar"]').click();
  await assertReceiptVisible();
  await page.locator('[data-action="observe-equipment:habitat:solar"]').click();
  await assertReceiptVisible();
  await talkTo(page,'mira');
  await command(page,'look');
  await assertReceiptVisible();
  assert.deepEqual(errors,[]);
});

for (const width of [1440,390]) test(`explicit narrative repeats, reveals Operations and keeps historical receipts at ${width}px`,async t=> {
  const {page,errors}=await narrativeGame(t,{width});
  await command(page,'look'); const first=await page.locator('#narrative-stream .narrative-entry').last().textContent();
  assert.ok(await page.locator('#narrative-stream').evaluate(stream=>{const latest=stream.querySelector('.log-entry:last-of-type').getBoundingClientRect(),bounds=stream.getBoundingClientRect(); return latest.top<bounds.bottom && latest.bottom>bounds.top;}));
  assert.equal(await page.locator('#observe-equipment').count(),0);
  await screenshot(page,`narrative-operations-${width}`);
  const count=await page.locator('#narrative-stream .narrative-entry').count();
  await page.locator('#narrative-stream').evaluate(stream=>{stream.scrollTop=0;});
  await command(page,'look'); assert.equal(await page.locator('#narrative-stream .narrative-entry').count(),count+1);
  assert.ok(await page.locator('#narrative-stream').evaluate(stream=>{const latest=stream.querySelector('.log-entry:last-of-type').getBoundingClientRect(),bounds=stream.getBoundingClientRect(); return latest.top<bounds.bottom && latest.bottom>bounds.top;}));
  assert.equal(await page.locator('#narrative-stream .narrative-entry').last().textContent(),first);
  assert.equal(await page.locator('#observe-equipment').count(),0);
  assert.equal(await page.locator('#observe-location, #inspect-equipment, #map-observe, [data-inspect-equipment], [data-key="observe"]').count(),0);
  const beforeInspection=await page.evaluate(key=>localStorage.getItem(key),saveKey);
  await page.locator('[data-action="observe-equipment:habitat:solar"]').click();
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),saveKey),beforeInspection);
  assert.equal(await page.locator('#terminal-tab-operations').getAttribute('aria-selected'),'true');
  assert.match(await page.locator('#narrative-stream .narrative-entry').last().textContent(),/Solar|solar/);
  await page.evaluate(()=>window.__narrativeTest.frame(1000));
  assert.ok((await page.locator('#narrative-stream .narrative-entry').allTextContents()).includes(first));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true); assert.deepEqual(errors,[]);
});
test('world power edges append one dynamic Operations receipt, suppress duplicates and preserve Workshop focus',async t=> {
  const {page,errors}=await narrativeGame(t); await page.getByRole('tab',{name:'Workshop'}).click();
  assert.equal(await page.locator('[data-action="observe-equipment:habitat:thermalProcessors"]').count(),0);
  const select=page.locator('#processing-machines select').last(); await select.focus();
  const original=await page.locator('#narrative-stream .narrative-entry').allTextContents();
  await page.evaluate(()=>window.__narrativeTest.frame(500));
  assert.equal(await page.locator('#narrative-stream .narrative-entry').count(),original.length+1);
  assert.equal(await page.locator('[data-action="observe-equipment:habitat:thermalProcessors"]').count(),1);
  const update=await page.locator('#narrative-stream .narrative-entry').last().textContent(); assert.match(update,/limiting|reduced progress/); assert.doesNotMatch(update,/Habitat 05 is|stopped/);
  assert.equal(await page.locator('#terminal-tab-workshop').getAttribute('aria-selected'),'true'); assert.equal(await select.evaluate(e=>e===document.activeElement),true);
  assert.ok(await page.locator('#terminal-tab-operations').evaluate(e=>e.classList.contains('has-updates')));
  await page.evaluate(()=> {window.__narrativeTest.replay(); for(let i=1;i<=50;i++) window.__narrativeTest.frame(500+i*100);});
  assert.equal(await page.locator('#narrative-stream .narrative-entry').count(),original.length+1);
  assert.deepEqual((await page.locator('#narrative-stream .narrative-entry').allTextContents()).slice(0,original.length),original);
  await command(page,'repairSolar'); const beforeRestoration=await page.locator('#narrative-stream .narrative-entry').count();
  await page.evaluate(()=>window.__narrativeTest.frame(6000));
  assert.equal(await page.locator('#narrative-stream .narrative-entry').count(),beforeRestoration+1);
  await page.evaluate(()=>window.__narrativeTest.frame(6100)); assert.equal(await page.locator('#narrative-stream .narrative-entry').count(),beforeRestoration+1);
  await page.getByRole('tab',{name:/Operations/}).click(); assert.equal(await page.locator('#terminal-tab-operations').getAttribute('aria-label'),'Operations');
  assert.deepEqual(errors,[]);
});
test('a committed frame consolidates depletion, buffered output and power loss without claiming delivery',async t=> {
  const {page,errors}=await narrativeGame(t,{buffered:true}); await page.getByRole('tab',{name:'Workshop'}).click();
  const count=await page.locator('#narrative-stream .narrative-entry').count(); await page.evaluate(()=>window.__narrativeTest.frame(30000));
  assert.equal(await page.locator('#narrative-stream .narrative-entry').count(),count+1);
  const update=await page.locator('#narrative-stream .narrative-entry').last().textContent(); assert.doesNotMatch(update,/delivered to storage|Habitat 05 is/); assert.match(update,/finished material|deposit|waiting for power/);
  const s=await savedGame(page); assert.equal(s.locations.habitat.resourceNodes.surfaceMinerals.remaining,0); assert.equal(s.processing.runs[1].phase,'delivery');
  assert.equal(await page.locator('#terminal-tab-workshop').getAttribute('aria-selected'),'true'); assert.deepEqual(errors,[]);
});
test('failed frame saving emits no procedural update; reload starts with one observation and no automatic replay',async t=> {
  const {page,errors}=await narrativeGame(t); const count=await page.locator('#narrative-stream .narrative-entry').count();
  const saved=await page.evaluate(key=>localStorage.getItem(key),saveKey);
  await page.evaluate(()=> {window.__oldSave=Storage.prototype.setItem; Storage.prototype.setItem=function(){throw new Error('Narrative save fixture failure');}; window.__narrativeTest.frame(500);});
  assert.equal(await page.locator('#narrative-stream .narrative-entry').count(),count); assert.equal(await page.evaluate(key=>localStorage.getItem(key),saveKey),saved);
  await page.evaluate(()=> {Storage.prototype.setItem=window.__oldSave;}); await page.reload();
  assert.equal(await page.locator('#narrative-stream .narrative-entry').count(),2); // opening plus authored tutorial
  assert.doesNotMatch(await page.locator('#narrative-stream').textContent(),/limiting|reduced progress/); assert.deepEqual(errors,[]);
});
test('NPC supplements use Operations, preserve authored conversations and never save generated speech',async t=> {
  const {page,errors}=await narrativeGame(t); await talkTo(page,'mira');
  assert.equal(await page.locator('#terminal-tab-people').getAttribute('aria-selected'),'true');
  const greeting=await page.locator('#narrative-stream .narrative-entry').last().textContent(); assert.match(greeting,/Mira: “Hello\./);
  const authored=await page.locator('.dialogue-transcript').textContent(),dialogue=JSON.stringify((await savedGame(page)).dialogue);
  await page.locator('[data-key="topics"]').focus(); await page.evaluate(()=>window.__narrativeTest.frame(500));
  assert.equal(await page.locator('#terminal-tab-people').getAttribute('aria-selected'),'true'); assert.equal(await page.evaluate(()=>document.activeElement.dataset.key),'topics');
  assert.equal(await page.locator('.dialogue-transcript').textContent(),authored); assert.equal(JSON.stringify((await savedGame(page)).dialogue),dialogue); assert.ok(!dialogue.includes(greeting));
  assert.equal(await page.locator('[data-key="observe"]').count(),0);
  await command(page,'look'); assert.equal(await page.locator('#terminal-tab-operations').getAttribute('aria-selected'),'true');
  assert.equal(await page.locator('.dialogue-transcript').textContent(),authored); assert.deepEqual(errors,[]);
});

test('Processing UI explains no-power rejection and preserves loaded stock and IDs',async t => {
  const { page,errors } = await processingGame(t,{ power: 0 });
  const button = page.getByRole('button',{ name: 'Load & start batch',exact: true }).first();
  assert.equal(await button.isDisabled(),true);
  assert.match(await page.locator('#processing-machines').textContent(),/Cannot start — insufficient power/);
  assert.match(await page.locator('#processing-machines').textContent(),/Loaded material is committed/);
  const saved = await savedGame(page); assert.equal(saved.locations.habitat.resources.siliconMinerals,120000); assert.equal(saved.processing.nextRunId,1);
  assert.deepEqual(errors,[]);
});
for (const width of [1440,390]) test(`Processing UI loads, stages, reviews loss and unloads disabled equipment at ${width}px`,async t => {
  const { page,errors } = await processingGame(t,{ width });
  const selector = page.locator('#processing-machines select').last(); await selector.focus();
  await page.waitForTimeout(100); assert.equal(await selector.evaluate(e => document.activeElement === e),true);
  await page.getByRole('button',{ name: 'Load & start batch',exact: true }).first().click();
  let saved = await savedGame(page); assert.equal(saved.locations.habitat.resources.siliconMinerals,80000); assert.equal(saved.processing.nextRunId,2);
  await page.getByRole('button',{ name: 'Abort batch…',exact: true }).click();
  assert.match(await page.locator('.processing-review').textContent(),/loaded materials.*will be lost/);
  await page.locator('.processing-review').getByRole('button',{ name: 'Cancel',exact: true }).click(); assert.equal(await page.locator('.processing-review').count(),0);
  await command(page,'fillIndustrialTest');
  assert.ok((await savedGame(page)).locations.habitat.resources.scrap > 9000000,await page.locator('#terminal-feedback').textContent());
  await command(page,'advanceIndustrialTest');
  assert.ok((await savedGame(page)).processing.runs[1],JSON.stringify((await savedGame(page)).worldLedger.entries.slice(-3)));
  assert.match(await page.locator('[data-run-id="1"]').textContent(),/Batch complete.*Output hopper: 2 solar cells/);
  saved = await savedGame(page); assert.equal(saved.processing.runs[1].phase,'delivery'); assert.equal(saved.locations.habitat.resources.solarCells,0);
  await page.getByRole('button',{ name: 'Discard finished batch…',exact: true }).click();
  assert.match(await page.locator('.processing-review').textContent(),/held inside the machine will be lost/);
  await page.locator('.processing-review').getByRole('button',{ name: 'Cancel',exact: true }).click();
  await page.reload(); await page.getByRole('tab',{ name: 'Workshop' }).click();
  assert.match(await page.locator('[data-run-id="1"]').textContent(),/Output hopper/);
  await command(page,'unloadIndustrialTest'); saved = await savedGame(page);
  assert.equal(saved.locations.habitat.resources.solarCells,2); assert.deepEqual(saved.processing.runs,{});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
  await page.locator('#processing-machines').scrollIntoViewIfNeeded();
  await screenshot(page,`processing-${width}`); assert.deepEqual(errors,[]);
});

test("shared cargo displays exact decimals and transfers one quantum through reload", async t => {
  const { page, errors } = await game(t);
  await command(page, "salvage");
  await page.getByRole("tab", { name: "Workshop" }).click();
  assert.match(await page.locator("#cargo-summary").textContent(), /0.01 m³ \/ 10 m³/);
  await page.locator("#transfer-asset").selectOption("scrap");
  await page.locator("#transfer-amount").fill("0.0000001");
  assert.equal(await page.locator("#transfer-submit").isDisabled(), true);
  await page.locator("#transfer-amount").fill("0.000001");
  await page.locator("#transfer-submit").click();
  assert.equal((await savedGame(page)).locations.supplyPlatform.resources.scrap, 1);
  assert.match(await page.locator("#item-inventory").textContent(), /0.009999 m³/);
  await page.reload(); await page.getByRole("tab", { name: "Workshop" }).click();
  assert.match(await page.locator("#cargo-summary").textContent(), /0.009999 m³/);
  assert.deepEqual(errors, []);
});

for (const width of [1440, 390]) test(`discard previews, cancellation, confirmation and overload recovery at ${width}px`, async t => {
  const { page, errors } = await game(t, { width, height: 900 });
  await command(page, "salvage");
  const saved = await savedGame(page); saved.locations.habitat.resources.scrap = 0;
  saved.locations.habitat.resources.radioAntenna = 1100;
  saved.locations.habitat.infrastructure.installedAntenna.quantity = 1;
  await replaceSavedGame(page, saved);
  await page.getByRole("tab", { name: "Workshop" }).click();
  assert.match(await page.locator("#cargo-summary").textContent(), /11 m³ \/ 10 m³.*1 m³ overloaded/);
  await page.locator("#discard-asset").selectOption("radioAntenna");
  await page.locator("#discard-amount").fill("100");
  await page.locator("#discard-review").click();
  assert.match(await page.locator("#discard-preview").textContent(), /100 radio antenna.*1 m³/);
  await screenshot(page, `storage-discard-${width}`);
  await page.locator("#discard-cancel").click();
  assert.equal((await savedGame(page)).locations.habitat.resources.radioAntenna, 1100);
  await page.locator("#discard-review").click();
  await page.locator("#discard-confirm").evaluate(button => { button.click(); button.click(); });
  assert.equal((await savedGame(page)).locations.habitat.resources.radioAntenna, 1000);
  assert.doesNotMatch(await page.locator("#cargo-summary").textContent(), /overloaded/);
  assert.equal(await page.locator("#discard-confirmation").isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.reload(); assert.equal((await savedGame(page)).locations.habitat.resources.radioAntenna, 1000);
  assert.deepEqual(errors, []);
});

test("discard save failure and a switch to private passenger inventory preserve cargo", async t => {
  const { page, errors } = await game(t, undefined, true);
  await command(page, "salvage");
  await page.getByRole("tab", { name: "Workshop" }).click();
  await page.locator("#discard-asset").selectOption("scrap"); await page.locator("#discard-amount").fill("0.01");
  await page.locator("#discard-review").click();
  await page.evaluate(() => { window.testSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error("Test save failure"); }; });
  await page.locator("#discard-confirm").click();
  assert.match(await page.locator("#terminal-feedback").textContent(), /Test save failure/);
  assert.equal((await savedGame(page)).locations.habitat.resources.scrap, 10000);
  await page.evaluate(() => { Storage.prototype.setItem = window.testSetItem; });
  await page.locator("#discard-amount").fill("0.01"); await page.locator("#discard-review").click();
  await command(page, "board:passenger");
  await page.getByRole("tab", { name: "Workshop" }).click();
  assert.equal(await page.locator("#cargo-summary").textContent(), "Cargo is private.");
  assert.equal(await page.locator("#discard-confirmation").isVisible(), false);
  assert.equal(await page.locator("#discard-preview").textContent(), "");
  assert.equal(await page.locator("#discard-amount").inputValue(), "");
  assert.equal(await page.locator("#transfer-space").textContent(), "");
  assert.equal(await page.locator("#discard-review").isDisabled(), true);
  assert.deepEqual(errors, []);
});

test("old save migration persists once and a failed migration write preserves the old save", async t => {
  const old = JSON.parse(await readFile(path.join(root, "tests/fixtures/storage-legacy-saves.json"), "utf8"))[6];
  const { page, errors } = await game(t);
  await replaceSavedGame(page, old);
  assert.equal((await savedGame(page)).saveVersion, 9);
  assert.equal((await savedGame(page)).locations.habitat.resources.scrap, 70000);
  assert.match(await page.locator("#narrative-stream").textContent(), /shared volume storage/);
  await page.reload();
  assert.doesNotMatch(await page.locator("#narrative-stream").textContent(), /shared volume storage/);
  assert.deepEqual(errors, []);
  await page.evaluate(({ key, old }) => {
    localStorage.setItem(key, JSON.stringify(old)); Storage.prototype.setItem = function () {};
  }, { key: saveKey, old });
  await page.addInitScript(() => { Storage.prototype.setItem = function () { throw new Error("Migration save failure"); }; });
  await page.reload();
  assert.equal((await savedGame(page)).saveVersion, 6);
  assert.equal((await savedGame(page)).locations.habitat.resources.scrap, 7);
  assert.equal(await page.locator("#command-input").isDisabled(), true);
  assert.ok(errors.some(e => e.includes("Migration save failure")));
});
async function learnStructure(page) {
  await command(page, "inspect:habitat:fitting");
  await command(page, "salvage");
  await page.getByRole("tab", { name: "Research", exact: true }).click();
  await page.locator('[data-sample="scrap"]').check();
  await page.locator("#research-submit").click();
  assert.equal((await savedGame(page)).knowledge.discoveries.structuralFabrication, true);
  await page.getByRole("tab", { name: "Operations" }).click();
}
async function talkTo(page, npcId) {
  await page.locator("#terminal-tab-people").click();
  await page.locator(`[data-key="person:${npcId}"]`).click();
  await page.locator('[data-key="talk"]').click();
}

async function selectMapNode(page, id) {
  const canvas = page.locator("#location-map");
  await canvas.focus();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    if (await canvas.getAttribute("data-selected") === id) return;
  }
  throw new Error(`Could not select map node ${id} via keyboard navigation`);
}

test("fresh opening appears once and Workshop explains undiscovered recipes", async t => {
  const { page, errors } = await game(t);
  const entries = await page.locator("#narrative-stream .narrative-entry").allTextContents();
  assert.equal(entries.length, 3);
  assert.match(entries[0], /power conduit hums beneath your feet/);
  assert.match(entries[1], /fractured bracket/);
  assert.match(entries[2], /research a new design/);
  assert.doesNotMatch(entries.join(" "), /Solar array degraded\. Inspect/);
  await page.getByRole("tab", { name: "Workshop" }).click();
  assert.match(await page.locator("#recipe-select option").textContent(), /gather materials.*Research/);
  assert.equal(await page.locator("#recipe-select").isDisabled(), true);
  await page.reload();
  assert.doesNotMatch(await page.locator("#narrative-stream").textContent(), /power conduit hums/);
  assert.deepEqual(errors, []);
});

test("terminal tour only changes presentation and restores the selected tab", async t => {
  const { page, errors } = await game(t);
  assert.equal(await page.evaluate(key => {
    const before = localStorage.getItem(key);
    document.querySelector("#tour-start").click();
    const titles = [];
    for (let i = 0; i < 6; i++) {
      titles.push(document.querySelector(".ui-tour-title").textContent);
      document.querySelector('[data-tour="next"]').click();
    }
    return localStorage.getItem(key) === before &&
      titles.join("|") === "Operations|Research|Workshop|Locations|People|Shipyard" &&
      document.querySelector("#terminal-tab-operations").getAttribute("aria-selected") === "true" &&
      document.querySelectorAll(".ui-tour-highlight").length === 0;
  }, saveKey), true);
  assert.deepEqual(errors, []);
});

test("startup, keyboard navigation, hidden controls, and presentation-only switching", async t => {
  const { page, errors } = await game(t);
  const operations = page.getByRole("tab", { name: "Operations" });
  const workshop = page.getByRole("tab", { name: "Workshop" });
  assert.equal(await operations.getAttribute("aria-selected"), "true");
  assert.equal(await page.getByRole("tabpanel").count(), 1);
  assert.equal(await page.locator("#recipe-select").isVisible(), false);
  assert.equal(await page.locator(".instrument-bay #item-inventory").count(), 0);
  await screenshot(page, "operations-desktop");
  await operations.focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await workshop.getAttribute("aria-selected"), "true");
  assert.equal(await workshop.evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator("#narrative-stream").isVisible(), false);
  assert.equal(await page.locator("#command-input").isVisible(), true);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "workshop-panel");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "discard-asset");
  await workshop.focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "Locations" }).getAttribute("aria-selected"), "true");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "People" }).getAttribute("aria-selected"), "true");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "Research", exact: true }).getAttribute("aria-selected"), "true");
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "Shipyard", exact: true }).getAttribute("aria-selected"), "true");
  await page.keyboard.press("ArrowRight");
  assert.equal(await operations.getAttribute("aria-selected"), "true");
  await page.keyboard.press("End");
  assert.equal(await page.getByRole("tab", { name: "Shipyard", exact: true }).getAttribute("aria-selected"), "true");
  await page.keyboard.press("Home");
  assert.equal(await operations.getAttribute("aria-selected"), "true");
  // Compare synchronously so the unrelated five-second autosave cannot race us.
  assert.equal(await page.evaluate(key => {
    const before = localStorage.getItem(key);
    document.querySelector("#terminal-tab-workshop").click();
    document.querySelector("#terminal-tab-operations").click();
    return localStorage.getItem(key) === before;
  }, saveKey), true);
  assert.deepEqual(errors, []);
});

test("Workshop crafting, feedback, selections, commands, and reload", async t => {
  const { page, errors } = await game(t);
  await learnStructure(page);
  for (let i = 0; i < 4; i++) await page.keyboard.press("1");
  await page.getByRole("tab", { name: "Workshop" }).click();
  const recipeId = await page.locator("#recipe-select option").evaluateAll(options => options.find(option => /structural/i.test(option.textContent)).value);
  await page.locator("#recipe-select").selectOption(recipeId);
  const selections = await page.locator("#ingredient-slots select").evaluateAll(selects => selects.map(el => el.value));
  await page.locator("#command-input").fill("salvage");
  for (let i = 0; i < 4; i++) {
    await page.getByRole("tab", { name: "Operations" }).click();
    await page.getByRole("tab", { name: "Workshop" }).click();
  }
  assert.equal(await page.locator("#recipe-select").inputValue(), recipeId);
  assert.deepEqual(await page.locator("#ingredient-slots select").evaluateAll(selects => selects.map(el => el.value)), selections);
  assert.equal(await page.locator("#command-input").inputValue(), "salvage");
  await screenshot(page, "workshop-desktop");
  await page.locator("#craft-button").click();
  let state = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
  assert.equal(state.locations.habitat.resources.iron, 1);
  assert.equal(state.locations.habitat.resources.scrap, 0);
  assert.match(await page.locator("#terminal-feedback").textContent(), /Created/);
  await page.locator("#command-input").fill("craft");
  await page.locator("#command-input").press("Enter");
  assert.match(await page.locator("#terminal-feedback").textContent(), /Requires/);
  assert.equal(await page.locator("#terminal-feedback").getAttribute("class"), "terminal-feedback error");
  await page.locator("#command-input").fill("salvage");
  await page.locator("#command-input").press("Enter");
  state = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
  assert.equal(state.locations.habitat.resources.scrap, 10000);
  await page.getByRole("tab", { name: "Operations" }).click();
  assert.match(await page.locator("#narrative-stream").textContent(), /Created 1 iron structural parts/);
  await page.reload();
  await page.waitForSelector("#player-actions button");
  assert.equal(await page.getByRole("tab", { name: "Operations" }).getAttribute("aria-selected"), "true");
  await page.getByRole("tab", { name: "Workshop" }).click();
  assert.equal(await page.locator("#recipe-select").inputValue(), recipeId);
  assert.deepEqual(errors, []);
});

test("hidden log receives messages, preserves reading position and follows the tail", async t => {
  const { page, errors } = await game(t);
  const publish = count => page.evaluate(async count => {
    const { publish } = await import("/js/eventBus.js");
    for (let i = 0; i < count; i++) publish({ author: "TEST", type: "system", text: `Scroll test message ${i}` });
  }, count);
  await publish(80);
  const anchor = await page.locator("#narrative-stream").evaluate(stream => {
    stream.scrollTop = stream.scrollHeight / 2;
    const top = stream.getBoundingClientRect().top;
    const entry = [...stream.children].find(el => el.getBoundingClientRect().bottom > top);
    entry.dataset.testAnchor = "true";
    return entry.getBoundingClientRect().top - top;
  });
  await page.getByRole("tab", { name: "Workshop" }).click();
  await publish(40);
  assert.equal(await page.locator("#narrative-stream > div").count(), 100);
  assert.equal(await page.locator('#observe-equipment').count(),0);
  await page.getByRole("tab", { name: "Operations" }).click();
  const restored = await page.locator("#narrative-stream").evaluate(stream => stream.querySelector("[data-test-anchor]").getBoundingClientRect().top - stream.getBoundingClientRect().top);
  assert.ok(Math.abs(anchor - restored) < 2, `${anchor} -> ${restored}`);
  await page.locator("#narrative-stream").evaluate(stream => { stream.scrollTop = stream.scrollHeight; });
  await page.getByRole("tab", { name: "Workshop" }).click();
  await publish(5);
  await page.getByRole("tab", { name: "Operations" }).click();
  assert.ok(await page.locator("#narrative-stream").evaluate(stream => stream.scrollHeight - stream.scrollTop - stream.clientHeight < 2));
  assert.deepEqual(errors, []);
});

test("a future third panel registers without controller changes, with validation and focus recovery", async t => {
  const { page } = await game(t);
  const result = await page.evaluate(async () => {
    const { default: terminalTabs } = await import("/js/terminalTabs.js");
    const list = document.createElement("div"), container = document.createElement("div");
    document.body.append(list, container);
    const controller = terminalTabs({ tabList: list, panelContainer: container });
    const panels = ["test-first", "test-second", "test-research"].map(id => {
      const panel = document.createElement("section");
      panel.innerHTML = "<input>";
      container.append(panel);
      controller.registerTab({ id, label: id, panel });
      return panel;
    });
    controller.activateTab("test-first");
    panels[0].querySelector("input").focus();
    controller.activateTab("test-research");
    const failures = [];
    for (const attempt of [
      () => controller.activateTab("missing"),
      () => controller.registerTab({ id: "test-first", label: "Duplicate", panel: panels[0] }),
      () => controller.registerTab({ id: "reused", label: "Reused", panel: panels[1] }),
      () => controller.registerTab({ id: "outside", label: "Outside", panel: document.createElement("section") }),
      () => controller.registerTab({ id: "empty", label: " ", panel: panels[1] })
    ]) { try { attempt(); failures.push(false); } catch { failures.push(true); } }
    return {
      failures, active: controller.getActiveTabId(), focused: document.activeElement.id,
      hidden: panels.map(panel => panel.hidden),
      selected: [...list.children].map(button => [button.getAttribute("aria-selected"), button.tabIndex]),
      links: [...list.children].every(button => document.getElementById(button.getAttribute("aria-controls")).getAttribute("aria-labelledby") === button.id)
    };
  });
  assert.deepEqual(result.failures, [true, true, true, true, true]);
  assert.equal(result.active, "test-research");
  assert.equal(result.focused, "terminal-tab-test-research");
  assert.deepEqual(result.hidden, [true, true, false]);
  assert.deepEqual(result.selected, [["false", -1], ["false", -1], ["true", 0]]);
  assert.equal(result.links, true);
});

test("additional tabs scroll into view without moving the page", async t => {
  const { page } = await game(t);
  const result = await page.evaluate(async () => {
    const { default: terminalTabs } = await import("/js/terminalTabs.js");
    const list = document.createElement("div"), container = document.createElement("div");
    list.className = "terminal-tabs";
    list.style.cssText = "width:240px; margin-left:70px; position:fixed; top:0;";
    document.body.append(list, container);
    const controller = terminalTabs({ tabList: list, panelContainer: container });
    for (const id of ["additional-first", "additional-second", "additional-third", "additional-fourth"]) {
      const panel = document.createElement("section");
      container.append(panel);
      controller.registerTab({ id, label: id, panel });
    }
    const pageScroll = window.scrollY;
    controller.activateTab("additional-fourth");
    const rightVisible = list.lastElementChild.getBoundingClientRect().right <= list.getBoundingClientRect().right + 1;
    const scrolled = list.scrollLeft > 0;
    controller.activateTab("additional-first");
    const leftVisible = list.firstElementChild.getBoundingClientRect().left >= list.getBoundingClientRect().left - 1;
    return { rightVisible, leftVisible, scrolled, pageUnchanged: pageScroll === window.scrollY };
  });
  assert.deepEqual(result, { rightVisible: true, leftVisible: true, scrolled: true, pageUnchanged: true });
});

test("simulation continues while Workshop is active", async t => {
  const { page, errors } = await game(t);
  await page.getByRole("tab", { name: "Workshop" }).click();
  const before = await page.locator("#active-time").textContent();
  await page.waitForFunction(before => document.querySelector("#active-time").textContent !== before, before);
  assert.equal(await page.getByRole("tab", { name: "Workshop" }).getAttribute("aria-selected"), "true");
  assert.deepEqual(errors, []);
});

test("responsive panels keep controls reachable and preserve Workshop scroll", async t => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 900, height: 620 }]) {
    const { page, errors } = await game(t, viewport);
    await page.getByRole("tab", { name: "Workshop" }).click();
    await page.locator("#recipe-select").scrollIntoViewIfNeeded();
    await screenshot(page, `workshop-${viewport.width}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const savedScroll = await page.locator("#workshop-panel").evaluate(el => { el.scrollTop = 150; return el.scrollTop; });
    await page.getByRole("tab", { name: "Operations" }).click();
    await page.getByRole("tab", { name: "Workshop" }).click();
    assert.equal(await page.locator("#workshop-panel").evaluate(el => el.scrollTop), savedScroll);
    const input = await page.locator("#command-input").boundingBox();
    const crt = await page.locator(".crt").boundingBox();
    assert.ok(input.y >= crt.y && input.y + input.height <= crt.y + crt.height);
    assert.deepEqual(errors, []);
  }
});

test("malformed saves show the original failure and remain untouched", async t => {
  const context = await browser.newContext();
  t.after(() => context.close());
  const page = await context.newPage();
  await page.addInitScript(key => localStorage.setItem(key, "{bad save"), saveKey);
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector("#terminal-feedback").classList.contains("error"));
  assert.match(await page.locator("#terminal-feedback").textContent(), /could not be loaded.*preserved/);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), "{bad save");
  assert.equal(await page.locator("#command-input").isDisabled(), true);
});

test("location browsing, selection and zoom are presentation-only; travel updates every local display", async t => {
  const { page, errors } = await game(t, undefined, true);
  await learnStructure(page);
  await page.keyboard.press("1");
  await page.getByRole("tab", { name: "Locations" }).click();
  await selectMapNode(page, "vicinity");
  assert.equal(await page.locator("#map-sidebar").isVisible(), true);
  const before = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
  assert.equal(before.locationId, "habitat");
  assert.equal(await page.locator("#current-location").textContent(), "Habitat 05");
  await screenshot(page, "locations-network-desktop");
  for (let i = 0; i < 3; i++) await page.locator("#map-in").click();
  assert.equal(await page.locator("#location-map").getAttribute("data-view"), "vicinity");
  await selectMapNode(page, "supplyPlatform");
  assert.equal(await page.locator("#inventory-location").textContent(), "Habitat 05");
  await screenshot(page, "locations-local-desktop");
  assert.equal(await page.locator("#map-action").isDisabled(), true);
  await command(page, "board:courier");
  await command(page, "undock");
  await page.getByRole("tab", { name: "Locations" }).click();
  await page.locator("#map-action").click();
  assert.equal(await page.locator("#current-location").textContent(), "Test courier");
  await page.waitForFunction(() => document.querySelector("#navigation-status").textContent.includes("Docked at Supply platform"));
  await command(page, "disembark:supplyPlatform");
  assert.equal(await page.getByRole("tab", { name: "Operations" }).getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#current-location").textContent(), "Supply platform");
  assert.equal(await page.locator("#inventory-location").textContent(), "Supply platform");
  assert.equal(await page.locator("#power-capacity").textContent(), "20");
  assert.equal(await page.locator("#solar-health").isVisible(), false);
  assert.equal(await page.locator("#map-sidebar").isVisible(), false);
  assert.match(await page.locator("#narrative-stream").textContent(), /supply platform provides storage space/i);
  const path = await page.locator('.pfw-chart-wrap path[fill="none"]').getAttribute("d");
  assert.ok(!path.includes("L"), "Power history must restart with one sample after travel");
  await page.getByRole("tab", { name: "Workshop" }).click();
  await page.locator("#recipe-select").selectOption("iron:refine");
  assert.match(await page.locator("#craft-requirement").textContent(), /capability/);
  await page.locator("#command-input").fill("salvage"); await page.locator("#command-input").press("Enter");
  assert.match(await page.locator("#terminal-feedback").textContent(), /not recognized/);
  await page.reload(); await page.waitForFunction(() => document.querySelector("#current-location").textContent === "Supply platform");
  assert.match(await page.locator("#narrative-stream").textContent(), /supply platform provides storage space/i);
  assert.doesNotMatch(await page.locator("#narrative-stream").textContent(), /soft hum of the habitat/);
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--location-tint")), "#22221c");
  assert.deepEqual(errors, []);
});

test("transfer form sends and receives cargo through saved actions", async t => {
  const { page, errors } = await game(t);
  for (let i = 0; i < 3; i++) await page.keyboard.press("1");
  await page.getByRole("tab", { name: "Workshop" }).click();
  await page.locator("#transfer-asset").selectOption("scrap");
  await page.locator("#transfer-amount").fill("0.02");
  await page.locator("#transfer-submit").click();
  let saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
  assert.equal(saved.locations.habitat.resources.scrap, 10000);
  assert.equal(saved.locations.supplyPlatform.resources.scrap, 20000);
  await page.locator("#transfer-source").selectOption("supplyPlatform");
  await page.locator("#transfer-destination").selectOption("habitat");
  await page.locator("#transfer-amount").fill("0.01"); await page.locator("#transfer-submit").click();
  saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
  assert.equal(saved.locations.habitat.resources.scrap, 20000);
  assert.equal(saved.locations.supplyPlatform.resources.scrap, 10000);
  await page.locator("#transfer-amount").fill("99");
  assert.equal(await page.locator("#transfer-submit").isDisabled(), true);
  assert.match(await page.locator("#transfer-reason").textContent(), /Insufficient/);
  await page.locator("#command-input").fill("transfer"); await page.locator("#command-input").press("Enter");
  assert.match(await page.locator("#terminal-feedback").textContent(), /Choose endpoints/);
  assert.deepEqual(errors, []);
});

test("failed travel preserves location, tab, tint, graph history and arrival log", async t => {
  const { page, errors } = await game(t, undefined, true);
  await page.getByRole("tab", { name: "Locations" }).click(); await page.locator("#map-current").click();
  await selectMapNode(page, "courier");
  const original = await page.locator("#narrative-stream .log-entry").allTextContents();
  await page.evaluate(() => { Storage.prototype.setItem = function () { throw new Error("Test save failure"); }; });
  await page.locator("#map-action").click();
  assert.equal(await page.getByRole("tab", { name: "Locations" }).getAttribute("aria-selected"), "true");
  assert.equal(await page.locator("#current-location").textContent(), "Habitat 05");
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--location-tint")), "#1e2520");
  assert.match(await page.locator("#terminal-feedback").textContent(), /Test save failure/);
  assert.doesNotMatch(await page.locator("#narrative-stream").textContent(), /Empty storage racks/);
  assert.deepEqual((await page.locator("#narrative-stream .log-entry").allTextContents()).slice(0,original.length),original);
  assert.deepEqual(errors, []);
});

test("mousewheel zoom, unselected dominance and bounded local views", async t => {
  const { page, errors } = await game(t);
  await page.getByRole("tab", { name: "Locations" }).click();
  const canvas = page.locator("#location-map");
  await canvas.hover();
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -100);
  await page.waitForFunction(() => Number(document.querySelector("#location-map").dataset.zoom) >= 2.5);
  assert.equal(await canvas.getAttribute("data-view"), "network", "No dominant centered node means no automatic entry");
  await canvas.focus(); await page.keyboard.press("Escape");
  const box = await canvas.boundingBox();
  const scale = Math.min((box.width - 150) / 100, (box.height - 100) / 100);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 45 * scale, box.y + box.height / 2 + 22.5 * scale, { steps: 5 }); await page.mouse.up();
  for (let i = 0; i < 5; i++) await page.locator("#map-in").click();
  // Panning stays in screen pixels as zoom grows. Center the target again at the larger scale if necessary.
  if (await canvas.getAttribute("data-view") === "network") {
    const z = Number(await canvas.getAttribute("data-zoom"));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 45 * scale * (z - 1), box.y + box.height / 2 + 22.5 * scale * (z - 1), { steps: 5 }); await page.mouse.up();
    await page.locator("#map-in").click();
  }
  if (await canvas.getAttribute("data-view") === "network") await page.locator("#map-current").click();
  assert.equal(await canvas.getAttribute("data-view"), "vicinity");
  for (let i = 0; i < 12; i++) await page.locator("#map-in").click();
  assert.equal(await canvas.getAttribute("data-view"), "vicinity");
  assert.ok(Number(await canvas.getAttribute("data-zoom")) <= 5);
  for (let i = 0; i < 10; i++) { if (await canvas.getAttribute("data-view") === "network") break; await page.locator("#map-out").click(); }
  assert.equal(await canvas.getAttribute("data-view"), "network");
  assert.equal(await page.locator("#current-location").textContent(), "Habitat 05");
  assert.deepEqual(errors, []);
});

test("ship area travel resumes after reload, pauses when hidden, and preserves aboard identity", async t => {
  const { page, errors } = await game(t, undefined, true);
  await command(page, "board:courier"); await command(page, "undock");
  await command(page, "travel:outerReach");
  let saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
  assert.equal(saved.locationId, "courier");
  assert.equal(saved.locations.courier.areaId, "vicinity");
  assert.ok(saved.locations.courier.journey.remaining > 0);
  assert.ok(saved.locations.courier.resources.power < 26);
  await screenshot(page, "ship-in-transit");
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
  const remaining = saved.locations.courier.journey.remaining;
  const status = await page.locator("#navigation-status").textContent();
  await page.waitForTimeout(1200);
  assert.equal(await page.locator("#navigation-status").textContent(), status);
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#current-location").textContent === "Test courier");
  const reloaded = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
  assert.equal(reloaded.locations.courier.journey.remaining, remaining);
  assert.equal(reloaded.locations.courier.resources.power, saved.locations.courier.resources.power);
  await page.getByRole("tab", { name: "Locations" }).click(); await page.locator("#map-current").click();
  await selectMapNode(page, "courier");
  assert.match(await page.locator("#map-description").textContent(), /En route to Outer/);
  try {
    await page.waitForFunction(() => document.querySelector("#navigation-status").textContent === "Outer collector reach · Undocked");
  } catch (error) {
    error.message += '\n' + await page.locator('#narrative-stream').textContent();
    throw error;
  }
  assert.equal(await page.locator("#current-location").textContent(), "Test courier");
  assert.equal(await page.locator("#inventory-location").textContent(), "Test courier");
  assert.match(await page.locator("#narrative-stream").textContent(), /Test courier arrived in Outer collector reach/);
  // An automatic arrival posts to Operations without changing the selected tab.
  assert.equal(await page.getByRole("tab", { name: "Operations" }).getAttribute("aria-selected"), "false");
  await command(page, "dock:derelict");
  await page.waitForFunction(() => document.querySelector("#navigation-status").textContent.includes("Docked at Derelict relay"));
  await command(page, "disembark:derelict");
  assert.equal(await page.locator("#current-location").textContent(), "Derelict relay");
  assert.equal(await page.locator(".power-module").isVisible(), false);
  await command(page, "board:courier");
  assert.equal(await page.locator(".power-module").isVisible(), true);
  assert.deepEqual(errors, []);
});

test("unowned passenger ship navigation hides assets and clears previous crafting and transfer controls", async t => {
  const { page, errors } = await game(t, { width: 390, height: 844 }, true);
  await learnStructure(page);
  await page.getByRole("tab", { name: "Workshop" }).click();
  await page.locator("#recipe-select").selectOption("iron:refine");
  await command(page, "board:passenger");
  assert.equal(await page.locator("#current-location").textContent(), "Passenger ship");
  assert.equal(await page.locator(".power-module").isVisible(), false);
  assert.equal(await page.locator(".flow-module").isVisible(), false);
  assert.equal(await page.locator("#asset-access").isVisible(), true);
  await page.getByRole("tab", { name: "Workshop" }).click();
  assert.equal(await page.locator("#recipe-select").isDisabled(), true);
  assert.equal(await page.locator("#ingredient-slots select").count(), 0);
  assert.equal(await page.locator("#transfer-source option").count(), 0);
  assert.equal(await page.locator("#transfer-submit").isDisabled(), true);
  assert.ok((await page.locator("#item-inventory dd").allTextContents()).every(text => text === "Private"));
  await screenshot(page, "ship-passenger-private-mobile");
  await command(page, "craftSelected");
  assert.match(await page.locator("#terminal-feedback").textContent(), /ownership/);
  await command(page, "undock"); await command(page, "dock:supplyPlatform");
  await page.waitForFunction(() => document.querySelector("#navigation-status").textContent.includes("Docked at Supply platform"));
  await command(page, "disembark:supplyPlatform");
  await page.getByRole("tab", { name: "Workshop" }).click();
  assert.equal(await page.locator("#recipe-select").isDisabled(), false);
  assert.equal(await page.locator("#recipe-select").inputValue(), "iron:refine");
  assert.equal(await page.locator(".power-module").isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});

test("failed arrival saving leaves the journey intact and does not announce docking", async t => {
  const { page, errors } = await game(t, undefined, true);
  await learnStructure(page);
  await command(page, "board:courier"); await command(page, "undock"); await command(page, "dock:supplyPlatform");
  await page.getByRole("tab", { name: "Locations" }).click();
  const saved = await page.evaluate(key => localStorage.getItem(key), saveKey);
  await page.evaluate(() => {
    window.originalSave = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new Error("Arrival save failure"); };
  });
  await page.waitForFunction(() => document.querySelector("#terminal-feedback").textContent.includes("Progress paused"));
  assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), saved);
  assert.equal(await page.getByRole("tab", { name: "Locations" }).getAttribute("aria-selected"), "true");
  assert.doesNotMatch(await page.locator("#narrative-stream").textContent(), /courier docked at Supply/);
  await page.evaluate(() => { Storage.prototype.setItem = window.originalSave; });
  await command(page, "selectRecipe:iron:refine");
  await page.waitForFunction(() => document.querySelector("#navigation-status").textContent.includes("Docked at Supply platform"));
  assert.match(await page.locator("#narrative-stream").textContent(), /courier docked at Supply/);
  assert.deepEqual(errors, []);
});

test("touch, keyboard, narrow map layout and reduced-motion alternatives", async t => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: "reduce" });
  t.after(() => context.close()); const page = await context.newPage(); const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin); await page.getByRole("tab", { name: "Locations" }).tap();
  await page.locator("#map-current").tap();
  await selectMapNode(page, "supplyPlatform");
  await screenshot(page, "locations-mobile");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator("#map-close").isVisible(), true);
  await page.locator("#map-close").tap();
  assert.equal(await page.locator("#location-map").evaluate(el => el === document.activeElement), true);
  await page.locator("#location-map").focus(); await page.keyboard.press("Escape");
  assert.equal(await page.locator("#location-map").getAttribute("data-view"), "network");
  await selectMapNode(page, "vicinity"); await page.keyboard.press("Enter");
  assert.equal(await page.locator("#location-map").getAttribute("data-view"), "vicinity");
  assert.equal(await page.locator(".console").evaluate(el => getComputedStyle(el).transitionDuration), "0s");
  await page.getByRole("tab", { name: "Workshop" }).tap();
  await page.locator("#transfer-submit").scrollIntoViewIfNeeded();
  assert.equal(await page.locator("#transfer-submit").isVisible(), true);
  assert.deepEqual(errors, []);
});

test("People browsing is presentation only; requests persist across tabs, inspection and reload", async t => {
  const { page, errors } = await game(t);
  const before = await savedGame(page);
  await page.locator("#people-shortcut").click();
  await page.locator('[data-key="person:oren"]').click();
  assert.deepEqual((await savedGame(page)).dialogue, before.dialogue);
  await page.locator('[data-key="talk"]').click();
  await page.locator('[data-key="topics"]').click();
  await page.locator('[data-key="reply:orenRequest"]').click();
  await screenshot(page, "people-desktop");
  await page.locator('[data-key="reply:accept"]').click();
  assert.equal((await savedGame(page)).npcs.oren.flags.requestAccepted, true);
  assert.match(await page.locator("#people-detail").textContent(), /inspection directive/);
  await page.getByRole("tab", { name: "Workshop" }).click();
  assert.equal(await page.locator("#conversation-resume").isVisible(), true);
  await page.reload();
  assert.equal(await page.getByRole("tab", { name: "Operations" }).getAttribute("aria-selected"), "true");
  await page.locator("#conversation-resume").click();
  assert.match(await page.locator("#people-detail").textContent(), /inspection directive/);
  await page.locator('[data-key="topics"]').click();
  assert.equal(await page.locator('[data-key="reply:orenFollowup"]').getAttribute("aria-disabled"), "true");
  await command(page, "inspect:habitat:collectors");
  assert.equal(await page.locator('[data-key="reply:orenFollowup"]').getAttribute("aria-disabled"), null);
  await page.locator('[data-key="reply:orenFollowup"]').click();
  await page.locator('[data-key="reply:report"]').click();
  assert.equal((await savedGame(page)).npcs.oren.flags.requestCompleted, true);
  await page.locator('[data-key="topics"]').click();
  assert.equal(await page.locator('[data-key="reply:orenThanks"]').isVisible(), true);
  assert.deepEqual(errors, []);
});

test("dialogue failures preserve passage and terminal relocation leaves a readable farewell", async t => {
  const { page, errors } = await game(t);
  await page.addInitScript(key => {
    const state = JSON.parse(localStorage.getItem(key)); state.npcs.mira.flags.requestCompleted = true;
    localStorage.setItem(key, JSON.stringify(state));
  }, saveKey);
  await page.reload(); await talkTo(page, "mira"); await page.locator('[data-key="topics"]').click();
  await page.locator('[data-key="reply:miraDeparture"]').click();
  const before = await savedGame(page);
  await page.evaluate(() => { window.realSave = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error("Test save failure"); }; });
  await page.locator('[data-key="reply:agree"]').click();
  assert.match(await page.locator("#people-error").textContent(), /Test save failure/);
  assert.deepEqual((await savedGame(page)).dialogue, before.dialogue);
  assert.equal(await page.locator('[data-key="reply:agree"]').isVisible(), true);
  assert.equal(await page.locator(".dialogue-receipt").count(), 0);
  await page.evaluate(() => { Storage.prototype.setItem = window.realSave; });
  await page.locator('[data-key="reply:agree"]').click();
  assert.match(await page.locator(".dialogue-receipt").textContent(), /meet you at the relay/);
  assert.equal((await savedGame(page)).npcs.mira.locationId, "derelict");
  assert.equal((await savedGame(page)).dialogue.active, null);
  assert.equal(await page.locator('[data-key="person:mira"]').count(), 0);
  assert.equal(await page.locator("#terminal-tab-people").getAttribute("aria-selected"), "true");
  await screenshot(page, "people-farewell");
  assert.deepEqual(errors, []);
});

test("People mobile flow preserves conversation while browsing, ignores digit directives and maintains focus", async t => {
  const { page, errors } = await game(t, { width: 390, height: 844 });
  await talkTo(page, "mira"); await page.locator('[data-key="topics"]').click();
  await page.locator('[data-key="reply:miraIntroduction"]').click();
  await screenshot(page, "people-mobile");
  assert.equal(await page.locator(".people-roster").isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const scrap = (await savedGame(page)).locations.habitat.resources.scrap;
  await page.locator('[data-key="reply:shutdown"]').focus(); await page.keyboard.press("1");
  assert.equal((await savedGame(page)).locations.habitat.resources.scrap, scrap);
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), "reply:shutdown");
  await page.locator('[data-key="back"]').click();
  assert.equal(await page.locator(".people-roster").isVisible(), true);
  await page.locator('[data-key="person:oren"]').click();
  assert.equal(await page.locator('[data-key="talk"]').count(), 0);
  await page.locator('[data-key="resume"]').click();
  assert.equal((await savedGame(page)).dialogue.active.nodeId, "intro");
  await page.locator('[data-key="reply:shutdown"]').click();
  assert.equal((await savedGame(page)).dialogue.active.nodeId, "shutdown");
  await page.locator('[data-key="leave"]').click();
  assert.equal((await savedGame(page)).dialogue.active, null);
  assert.deepEqual(errors, []);
});

test("ship arrival during dialogue keeps People selected and disembarking closes contact", async t => {
  const { page, errors } = await game(t, undefined, true);
  await page.addInitScript(key => {
    const state = JSON.parse(localStorage.getItem(key)); state.npcs.mira.locationId = "courier";
    localStorage.setItem(key, JSON.stringify(state));
  }, saveKey);
  await page.reload(); await command(page, "board:courier"); await talkTo(page, "mira");
  await command(page, "undock"); await command(page, "dock:supplyPlatform");
  await page.locator('[data-key="topics"]').focus();
  await page.waitForFunction(() => document.querySelector("#navigation-status").textContent.includes("Docked at Supply platform"));
  assert.equal(await page.locator("#terminal-tab-people").getAttribute("aria-selected"), "true");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), "topics");
  assert.equal((await savedGame(page)).dialogue.active.npcId, "mira");
  assert.match(await page.locator("#narrative-stream").textContent(), /courier docked at Supply/);
  await command(page, "disembark:supplyPlatform");
  assert.equal((await savedGame(page)).dialogue.active, null);
  assert.match(await page.locator("#terminal-feedback").textContent(), /contact was lost/);
  assert.deepEqual(errors, []);
});

test("current-version content recovery notifies and preserves NPC and request history", async t => {
  const { page, errors } = await game(t);
  await talkTo(page, "mira"); await page.locator('[data-key="topics"]').click();
  await page.locator('[data-key="reply:miraIntroduction"]').click();
  const before = await savedGame(page);
  await page.route("**/js/npcContent.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + '\nnpcDefinitions.mira.excludeConversations = ["miraIntroduction"];' });
  });
  await page.reload();
  assert.equal((await savedGame(page)).dialogue.active, null);
  assert.deepEqual((await savedGame(page)).dialogue.history, before.dialogue.history);
  assert.match(await page.locator("#narrative-stream").textContent(), /Dialogue content changed/);
  assert.deepEqual(errors, []);
});

test("long dialogue and wrapping replies stay reachable without moving the reader on simulation updates", async t => {
  const { page, errors } = await game(t, { width: 900, height: 900 });
  await page.route("**/js/dialogueContent.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      dialogueDefinitions.conversations.miraIntroduction.nodes.intro.text = "A long account of the habitat's history and the unanswered questions about the collector network. ".repeat(20);
      dialogueDefinitions.conversations.miraIntroduction.nodes.intro.choices = Array.from({length: 12}, (_, i) => ({id: "reply" + i, text: "Ask about the maintenance ledger and what it reveals about the unfinished collectors, observation " + i, destinationNode: "thanks"}));` });
  });
  await page.reload(); await talkTo(page, "mira"); await page.locator('[data-key="topics"]').click();
  await page.locator('[data-key="reply:miraIntroduction"]').click();
  const last = page.locator('[data-key="reply:reply11"]');
  await last.scrollIntoViewIfNeeded(); await last.focus();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const position = await page.locator(".people-layout").evaluate(el => { el.scrollTop = 200; return el.scrollTop; });
  const transcriptCount = await page.locator(".dialogue-passage").count();
  await page.waitForTimeout(200);
  assert.equal(await page.locator(".people-layout").evaluate(el => el.scrollTop), position);
  assert.equal(await page.locator(".dialogue-passage").count(), transcriptCount);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.key), "reply:reply11");
  await last.click();
  assert.equal((await savedGame(page)).dialogue.active.nodeId, "thanks");
  assert.deepEqual(errors, []);
});

test("Research previews are read-only, experiments advance knowledge, and exhausted setups spend nothing", async t => {
  const { page, errors } = await game(t);
  assert.equal(await page.locator('[data-action="refineScrap"]').isDisabled(), true);
  for (let i = 0; i < 3; i++) await command(page, "salvage");
  await command(page, "research");
  assert.match(await page.locator("#research-facility").textContent(), /No power needed/);
  const before = await savedGame(page);
  await page.locator('[data-sample="scrap"]').check();
  assert.match(await page.locator("#research-cost").textContent(), /0.01 m³ metal scrap/);
  assert.equal(await page.locator("#research-submit").isEnabled(), true);
  assert.doesNotMatch(await page.locator("#research-knowledge").textContent(), /Photovoltaic|Radio assembly|Structural fabrication/);
  assert.deepEqual((await savedGame(page)).research, before.research);
  await page.getByRole("tab", { name: "Workshop" }).click();
  await page.getByRole("tab", { name: "Research", exact: true }).click();
  assert.equal(await page.locator('[data-sample="scrap"]').isChecked(), true);
  await page.locator("#research-submit").click();
  assert.equal((await savedGame(page)).research.attemptCount, 1);
  assert.equal((await savedGame(page)).knowledge.discoveries.structuralFabrication, undefined);
  assert.match(await page.locator("#terminal-feedback").textContent(), /advanced/);
  await screenshot(page, "research-partial-desktop");
  await page.locator("#research-submit").click();
  const learned = await savedGame(page);
  assert.equal(learned.knowledge.discoveries.structuralFabrication, true);
  assert.equal(learned.locations.habitat.resources.scrap, 10000);
  assert.equal(await page.locator("#research-journal li").count(), 2);
  assert.match(await page.locator("#research-knowledge").textContent(), /Structural fabrication/);
  assert.equal(await page.locator("#research-submit").isDisabled(), true);
  assert.match(await page.locator("#research-reason").textContent(), /no new evidence/);
  await page.evaluate(async () => {
    const { executeAction } = await import("/js/app.js");
    let reason = "";
    try { executeAction("research:experiment", { methodId: "bench", items: ["scrap"] }); } catch (error) { reason = error.message; }
    if (!reason.includes("no new evidence")) throw new Error(`Expected exhausted research, received: ${reason}`);
  });
  assert.deepEqual((await savedGame(page)).research, learned.research);
  await screenshot(page, "research-discovery-desktop");
  await page.reload(); await page.getByRole("tab", { name: "Research", exact: true }).click();
  assert.equal(await page.locator("#research-journal li").count(), 2);
  assert.equal(await page.locator('[data-sample="scrap"]').isChecked(), false);
  await page.getByRole("tab", { name: "Workshop" }).click();
  assert.ok((await page.locator("#recipe-select option").allTextContents()).some(text => /structural/.test(text)));
  assert.deepEqual(errors, []);
});

test("Research save failures do not publish discoveries or consume the next random outcome", async t => {
  const { page, errors } = await game(t);
  await command(page, "salvage"); await command(page, "inspect:habitat:fitting"); await command(page, "research");
  await page.locator('[data-sample="scrap"]').check();
  const before = await savedGame(page);
  await page.evaluate(() => { window.originalSave = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new Error("Research save failure"); }; });
  await page.locator("#research-submit").click();
  assert.match(await page.locator("#terminal-feedback").textContent(), /Research save failure/);
  assert.deepEqual((await savedGame(page)).research, before.research);
  assert.equal(await page.locator("#research-journal li").count(), 0);
  assert.doesNotMatch(await page.locator("#narrative-stream").textContent(), /Discovered:/);
  await page.evaluate(() => { Storage.prototype.setItem = window.originalSave; });
  await page.locator("#research-submit").click();
  assert.equal((await savedGame(page)).knowledge.discoveries.structuralFabrication, true);
  assert.equal((await savedGame(page)).locations.habitat.resources.scrap, 0);
  assert.deepEqual(errors, []);
});

test("Research clears samples on location changes and keeps passenger assets private", async t => {
  const { page, errors } = await game(t, { width: 390, height: 844 }, true);
  await learnStructure(page); await command(page, "salvage"); await command(page, "research");
  await page.locator('[data-sample="scrap"]').check();
  await command(page, "board:passenger"); await command(page, "research");
  assert.equal(await page.locator("#research-samples input:checked").count(), 0);
  assert.equal(await page.locator("#research-samples label:visible").count(), 0);
  assert.equal(await page.locator("#research-submit").isDisabled(), true);
  assert.match(await page.locator("#research-knowledge").textContent(), /Structural fabrication/);
  assert.match(await page.locator("#research-facility").textContent(), /private/);
  await screenshot(page, "research-passenger-mobile");
  await command(page, "disembark:habitat"); await command(page, "research");
  assert.equal(await page.locator('[data-sample="scrap"]').isChecked(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});

test("Mira's technical advice supplies a saved optional clue to research", async t => {
  const { page, errors } = await game(t);
  await talkTo(page, "mira"); await page.locator('[data-key="topics"]').click();
  await page.locator('[data-key="reply:miraBenchAdvice"]').click();
  await page.locator('[data-key="reply:note"]').click();
  assert.equal((await savedGame(page)).npcs.mira.flags.benchAdvice, true);
  await command(page, "gatherElectronics"); await command(page, "research");
  await page.locator('[data-sample="electronicSalvage"]').check();
  await page.locator("#research-submit").click();
  assert.equal((await savedGame(page)).knowledge.discoveries.electricalConduction, true);
  assert.match(await page.locator("#research-journal").textContent(), /Mira/);
  assert.deepEqual(errors, []);
});

test("legacy research migration preserves former recipes and reports the compatibility grant", async t => {
  const { page, errors } = await game(t);
  await command(page, "salvage");
  await page.evaluate(key => {
    const saved = JSON.parse(localStorage.getItem(key)); saved.saveVersion = 5; delete saved.research;
    for (const [id, local] of Object.entries(saved.locations)) local.ownerId = saved.entities[id].ownerId;
    delete saved.entities; delete saved.entityIds;
    saved.locations.habitat.resources.scrap = 1;
    saved.npcs.mira.inventory.scrap = 4;
    localStorage.setItem(key, JSON.stringify(saved));
    // Prevent the pagehide handler from replacing this test's legacy fixture.
    Storage.prototype.setItem = function () {};
  }, saveKey);
  await page.reload(); await command(page, "research");
  const saved = await savedGame(page);
  assert.equal(saved.saveVersion, 9); assert.equal(saved.research.legacyKnowledge, true);
  assert.equal(saved.locations.habitat.resources.scrap, 10000);
  assert.equal(await page.locator(".research-discovery").count(), 6);
  assert.equal(await page.locator("#research-journal li").count(), 0);
  assert.equal(await page.locator("#research-legacy").isVisible(), true);
  assert.match(await page.locator("#narrative-stream").textContent(), /fabrication knowledge has been preserved/);
  assert.deepEqual(errors, []);
});

test("Research keyboard controls, mobile layout and a long journal stay usable", async t => {
  const { page, errors } = await game(t, { width: 390, height: 844 });
  await command(page, "salvage"); await command(page, "research");
  await page.locator('[data-sample="scrap"]').focus(); await page.keyboard.press("Space");
  assert.equal(await page.locator('[data-sample="scrap"]').isChecked(), true);
  const time = await page.locator("#active-time").textContent();
  await page.waitForFunction(time => document.querySelector("#active-time").textContent !== time, time);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.sample), "scrap");
  await page.locator("#research-submit").click();
  await screenshot(page, "research-390");
  const result = await page.evaluate(async key => {
    const { validateState } = await import("/js/state.js");
    const s = JSON.parse(localStorage.getItem(key)), entry = s.research.attempts[0];
    s.research.attemptCount = 100;
    s.research.attempts = Array.from({ length: 100 }, (_, i) => ({ ...structuredClone(entry), id: i + 1,
      observations: ["Careful examination reveals a material property that deserves comparison with the next sample. ".repeat(12)], discoveries: [] }));
    validateState(s); localStorage.setItem(key, JSON.stringify(s)); Storage.prototype.setItem = function () {};
    return true;
  }, saveKey);
  assert.equal(result, true); await page.reload(); await command(page, "research");
  assert.equal(await page.locator("#research-journal li").count(), 100);
  const last = page.locator("#research-journal li").last(); await last.scrollIntoViewIfNeeded();
  const position = await page.locator("#research-journal").evaluate(el => el.scrollTop);
  assert.ok(position > 0);
  await page.waitForTimeout(200);
  assert.equal(await page.locator("#research-journal").evaluate(el => el.scrollTop), position);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await screenshot(page, "research-journal-390");
  await page.setViewportSize({ width: 900, height: 620 });
  await page.locator("#research-submit").scrollIntoViewIfNeeded(); await screenshot(page, "research-900");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});

test("new research evidence is available after reload without resetting existing progress", async t => {
  const { page, errors } = await game(t);
  await command(page, "salvage"); await command(page, "salvage"); await command(page, "research");
  await page.locator('[data-sample="scrap"]').check(); await page.locator("#research-submit").click();
  const before = await savedGame(page);
  await page.route("**/js/research/researchContent.js", async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      researchDefinitions.discoveries.structuralFabrication.evidence.push({ id: "surfaceTest", samples: { allTags: ["metal"] }, insight: 1, observation: "A newly authored surface test confirms the metal's working properties." });` });
  });
  await page.reload(); await command(page, "research");
  const restored = await savedGame(page);
  assert.deepEqual(restored.research.insight, before.research.insight);
  assert.deepEqual(restored.research.credits, before.research.credits);
  assert.equal(restored.research.rng, before.research.rng);
  assert.equal(restored.research.attemptCount, 1);
  await page.locator('[data-sample="scrap"]').check(); await page.locator("#research-submit").click();
  assert.equal((await savedGame(page)).research.credits["structuralFabrication/surfaceTest/base"], 1);
  assert.match(await page.locator("#research-journal").textContent(), /newly authored surface test/);
  assert.deepEqual(errors, []);
});

test("generated instances use browser rosters, map commands, scenes, and saved contact lifecycle", async t => {
  const { page, errors, ids: [ship, npc] } = await generatedGame(t);
  await command(page, 'talk');
  await page.locator(`[data-key="person:${npc}"]`).click();
  await page.locator('[data-key="talk"]').click();
  assert.match(await page.locator('#people-detail').textContent(), /Edda/);
  assert.equal((await savedGame(page)).dialogue.met[npc], true);
  await page.locator('[data-key="leave"]').click();
  await command(page, `board:${ship}`);
  assert.equal(await page.locator('#current-location').textContent(), 'Carina');
  await command(page, `inspect:${ship}:bridge`);
  assert.match(await page.locator('#narrative-stream').textContent(), /quiet bridge/);
  await page.getByRole('tab', { name: 'Locations' }).click();
  await page.locator('#map-current').click(); await selectMapNode(page, ship);
  assert.equal(await page.locator('#map-name').textContent(), 'Carina');
  await page.reload();
  assert.equal(await page.locator('#current-location').textContent(), 'Carina');
  await command(page, 'disembark:habitat');
  await command(page, 'talk'); await page.locator(`[data-key="person:${npc}"]`).click(); await page.locator('[data-key="talk"]').click();
  const retired = await page.evaluate(async ({ key, npc }) => {
    const { buildGameSystems } = await import('/js/bootstrap.js');
    const { createGameRuntime } = await import('/js/runtime.js');
    const { retireEntity } = await import('/js/entityLifecycle.js');
    const systems = buildGameSystems(), runtime = createGameRuntime({ ...systems, initialState: JSON.parse(localStorage.getItem(key)), save() {} });
    runtime.applyAction(s => retireEntity(s, npc, systems));
    return runtime.getState();
  }, { key: saveKey, npc });
  await replaceSavedGame(page, retired); await command(page, 'talk');
  assert.equal(await page.locator(`[data-key="person:${npc}"]`).count(), 0);
  assert.equal((await savedGame(page)).dialogue.active, null);
  assert.equal((await savedGame(page)).dialogue.met[npc], true);
  assert.deepEqual(errors, []);
});

test("generated research history and controller access render independently of title ownership", async t => {
  const { page, errors, ids: [, , depot] } = await generatedGame(t);
  const state = await savedGame(page); state.locationId = depot;
  await replaceSavedGame(page, state); await command(page, 'research');
  await page.locator('[data-sample="scrap"]').check();
  await page.locator('#research-submit').click();
  assert.match(await page.locator('#research-journal').textContent(), /Remote bench/);
  const changed = await page.evaluate(async ({ key, depot }) => {
    const { buildGameSystems } = await import('/js/bootstrap.js');
    const { createGameRuntime } = await import('/js/runtime.js');
    const { retireEntity } = await import('/js/entityLifecycle.js');
    const { setEntityOwner, setEntityController } = await import('/js/authority.js');
    const systems = buildGameSystems(), runtime = createGameRuntime({ ...systems, initialState: JSON.parse(localStorage.getItem(key)), save() {} });
    runtime.applyAction(s => {
      s.locationId = 'habitat'; retireEntity(s, depot, systems);
      setEntityOwner(s, 'habitat', 'mira'); setEntityController(s, 'habitat', 'player', 'mira');
    });
    return runtime.getState();
  }, { key: saveKey, depot });
  await replaceSavedGame(page, changed); await command(page, 'research');
  assert.match(await page.locator('#research-journal').textContent(), /Remote bench/);
  await command(page, 'salvage');
  await page.getByRole('tab', { name: 'Workshop' }).click();
  assert.equal(await page.locator('#asset-access').isVisible(), false);
  assert.match(await page.locator('#cargo-summary').textContent(), /0.01 m³/);
  assert.equal((await savedGame(page)).entities.habitat.ownerId, 'mira');
  assert.equal((await savedGame(page)).entities.habitat.controllerId, 'player');
  assert.deepEqual(errors, []);
});

async function roundTwoGame(t, trigger, blocked = false) {
  const context = await browser.newContext(); t.after(() => context.close());
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const effects = [
    { type: 'spawnEntity', spec: { type: 'ship', definitionId: 'rewardShip', areaId: 'vicinity', dockedAtId: 'current', ownerId: 'player', displayName: 'Reward shuttle' } },
    { type: 'activateLocation', targetId: 'supplyPlatform' },
    { type: 'grantItem', itemId: 'electronicParts', amount: 1 },
    { type: 'setFlag', scope: 'global', flag: 'roundTwoReward', value: true },
    ...(blocked ? [{ type: 'deactivateEntity', targetId: 'habitat' }] : [])
  ];
  await page.route('**/js/locationContent.js', async route => {
    const response = await route.fetch();
    const template = { type: 'ship', name: 'Shuttle', description: 'A new shuttle.', remoteDescription: 'A new shuttle.',
      initialInfrastructure: { engine: { quantity: 1 } }, sceneObjects: [{ id: 'bridge', name: 'Bridge', description: 'A reward shuttle bridge.' }] };
    await route.fulfill({ response, body: (await response.text()) + `
      locationDefinitions.templates = { rewardShip: ${JSON.stringify(template)} };
      locationDefinitions.locations.supplyPlatform.initialLifecycle = 'inactive';
      ${trigger === 'inspection' ? `locationDefinitions.locations.habitat.sceneObjects.find(object => object.id === 'collectors').effects = ${JSON.stringify(effects)};` : ''}` });
  });
  if (trigger === 'research') await page.route('**/js/research/researchContent.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()) + `
      researchDefinitions.bonusChance = 1;
      researchDefinitions.discoveries.structuralFabrication.threshold = 1;
      researchDefinitions.discoveries.structuralFabrication.evidence = [{ id: 'metal', samples: { items: ['scrap'] }, insight: 1, once: true, observation: 'A reward experiment.' }];
      researchDefinitions.discoveries.structuralFabrication.effects = ${JSON.stringify(effects)};` });
  });
  await page.goto(origin); await page.waitForSelector('#player-actions button');
  return { page, errors };
}

test('authored inspection spawns and activates entities visible in navigation and after reload', async t => {
  const { page, errors } = await roundTwoGame(t, 'inspection');
  assert.equal((await savedGame(page)).entities.supplyPlatform.lifecycle, 'inactive');
  await command(page, 'inspect:habitat:collectors');
  const saved = await savedGame(page);
  assert.equal(saved.entityIds.next, 2);
  assert.equal(saved.locations.habitat.resources.electronicParts, 1);
  assert.equal(saved.entities.supplyPlatform.lifecycle, 'active');
  assert.equal(saved.locations.habitat.flags['examined:collectors'], true);
  assert.deepEqual(saved.worldLedger.entries.map(e => e.type), ['ENTITY_CREATED', 'ENTITY_ACTIVATED']);
  await command(page, 'board:gen_ship_1');
  assert.equal(await page.locator('#current-location').textContent(), 'Reward shuttle');
  await command(page, 'inspect:gen_ship_1:bridge');
  assert.match(await page.locator('#narrative-stream').textContent(), /reward shuttle bridge/);
  await page.getByRole('tab', { name: 'Locations' }).click();
  await page.locator('#map-current').click(); await selectMapNode(page, 'gen_ship_1');
  assert.equal(await page.locator('#map-name').textContent(), 'Reward shuttle');
  await page.reload();
  const restored = await savedGame(page);
  assert.equal(restored.entityIds.next, 2);
  assert.equal(restored.locations.habitat.resources.electronicParts, 1);
  assert.equal(restored.entities.supplyPlatform.lifecycle, 'active');
  assert.deepEqual(restored.worldLedger, saved.worldLedger);
  assert.deepEqual(errors, []);
});

test('experimental completion rewards spawn once and survive research UI reload', async t => {
  const { page, errors } = await roundTwoGame(t, 'research');
  await command(page, 'salvage'); await command(page, 'research');
  await page.locator('[data-sample="scrap"]').check(); await page.locator('#research-submit').click();
  const learned = await savedGame(page);
  assert.equal(learned.knowledge.discoveries.structuralFabrication, true);
  assert.equal(learned.entityIds.next, 2);
  assert.equal(learned.flags.roundTwoReward, true);
  assert.equal(learned.locations.habitat.resources.electronicParts, 1);
  assert.deepEqual(learned.worldLedger.entries.map(e => e.type), ['RESEARCH_COMPLETED', 'ENTITY_CREATED', 'ENTITY_ACTIVATED']);
  assert.match(await page.locator('#research-journal').textContent(), /reward experiment/);
  await page.reload(); await command(page, 'research');
  const restored = await savedGame(page);
  assert.deepEqual(restored.research, learned.research);
  assert.deepEqual(restored.worldLedger, learned.worldLedger);
  assert.equal(restored.entityIds.next, 2);
  assert.equal(restored.locations.habitat.resources.electronicParts, 1);
  assert.deepEqual(errors, []);
});

test('blocked experimental rewards publish feedback without partial research or entity changes', async t => {
  const { page, errors } = await roundTwoGame(t, 'research', true);
  await command(page, 'salvage'); await command(page, 'research');
  await page.locator('[data-sample="scrap"]').check();
  const before = await savedGame(page);
  await page.locator('#research-submit').click();
  assert.match(await page.locator('#terminal-feedback').textContent(), /Nothing was spent/);
  const after = await savedGame(page);
  assert.deepEqual(after.research, before.research);
  assert.deepEqual(after.entityIds, before.entityIds);
  assert.deepEqual(after.knowledge, before.knowledge);
  assert.deepEqual(after.worldLedger, before.worldLedger);
  assert.equal(after.locations.habitat.resources.scrap, before.locations.habitat.resources.scrap);
  assert.equal(after.locations.habitat.resources.electronicParts, 0);
  assert.equal(after.entities.supplyPlatform.lifecycle, 'inactive');
  assert.equal(after.flags.roundTwoReward, undefined);
  assert.equal(await page.locator('#research-journal li').count(), 0);
  assert.deepEqual(errors, []);
});

test('ledger defaults missing v8 history without replay and retains removed content through a subsequent action', async t => {
  const { page, errors } = await game(t);
  const initial = await savedGame(page);
  assert.deepEqual(initial.worldLedger, { nextId: 1, entries: [] });
  const old = structuredClone(initial); delete old.worldLedger;
  await replaceSavedGame(page, old); await page.waitForSelector('#player-actions button');
  const canonical = await savedGame(page);
  assert.equal(canonical.saveVersion, 9); assert.deepEqual(canonical.worldLedger, { nextId: 1, entries: [] });
  canonical.worldLedger = { nextId: 2, entries: [{ id: 1, type: 'RESOURCE_TRANSFERRED', time: 0,
    actorId: 'player', targetId: 'supplyPlatform', locationId: 'habitat', areaId: 'vicinity', importance: 0.2,
    data: { sourceId: 'habitat', destinationId: 'supplyPlatform', resourceId: 'removedMaterial', quantityKind: 'bulk', amount: 42 } }] };
  await replaceSavedGame(page, canonical); await page.waitForSelector('#player-actions button');
  await command(page, 'salvage');
  assert.deepEqual((await savedGame(page)).worldLedger, canonical.worldLedger);
  assert.match(await page.locator('#terminal-feedback').textContent(), /Recovered/);
  assert.deepEqual(errors, []);
});

test('malformed historical identities stop startup and preserve the original ledger save', async t => {
  const { page, errors } = await game(t), saved = await savedGame(page);
  saved.worldLedger = { nextId: 2, entries: [{ id: 1, type: 'ENTITY_DEACTIVATED', time: 0,
    actorId: null, targetId: 'missingIdentity', locationId: null, areaId: null, importance: 0.4,
    data: { previousLifecycle: 'active' } }] };
  await replaceSavedGame(page, saved);
  await page.waitForFunction(() => document.querySelector('#command-input').disabled);
  assert.match(await page.locator('#terminal-feedback').textContent(), /preserved.*world-ledger/i);
  assert.deepEqual(await savedGame(page), saved);
  assert.equal(errors.length, 1); assert.match(errors[0], /Missing entity/);
});
