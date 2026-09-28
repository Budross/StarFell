import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { buildGameSystems } from "../js/bootstrap.js";
import { migrateState, validateState } from "../js/stateCore.js";
import { LEGACY_STORAGE } from "../js/storageMigration.js";
import { locationDefinitions } from "../js/locationContent.js";
import { npcDefinitions } from "../js/npcContent.js";
import { definitions } from "../js/content.js";
import { buildCatalog } from "../js/itemCatalog.js";
import { storageSummary } from "../js/storage.js";

const fixtures = JSON.parse(readFileSync(new URL("./fixtures/storage-legacy-saves.json", import.meta.url)));
const systems = buildGameSystems();
const migrate = (s, system = systems, notices = [], legacy) => migrateState(s, system.content, system.world, system.people, notices, system.research, legacy);

for (let version = 1; version <= 6; version++) test(`literal version ${version} inventory migrates once and preserves its source`, () => {
  const original = structuredClone(fixtures[version]), notices = [];
  const migrated = migrate(original, systems, notices);
  assert.deepEqual(original, fixtures[version]); assert.equal(migrated.saveVersion, 9);
  assert.equal(migrated.locations.habitat.resources.scrap, 70000);
  assert.equal(migrated.locations.habitat.resources.electronicSalvage, 15000);
  assert.equal(migrated.locations.habitat.resources.siliconMinerals, 20000);
  assert.equal(migrated.locations.habitat.resources.iron, 2);
  assert.equal(migrated.npcs.mira.inventory.scrap, 40000);
  assert.equal(migrated.simulationTime, 42);
  assert.ok(notices.some(n => n.includes("shared volume")));
  const reloadNotices = []; assert.deepEqual(migrate(migrated, systems, reloadNotices), migrated); assert.deepEqual(reloadNotices, []);
});

test("new sites, NPCs, and items initialize in new units exactly once", () => {
  const source = structuredClone(locationDefinitions), npcs = structuredClone(npcDefinitions), items = structuredClone(definitions);
  source.locations.newSite = { ...source.locations.supplyPlatform, name: "New site", initialResources: { scrap: 0.03 } };
  npcs.newNpc = { ...npcs.mira, name: "New NPC", initialInventory: { scrap: 0.02 } };
  items.items.newBulk = { name: "New bulk", category: "resource", researchSampleM3: 0.001, initialQuantity: 0.02 };
  const s = buildGameSystems({ locationSource: source, npcSource: npcs, content: buildCatalog(items) });
  for (const version of [1, 3, 4, 5, 6]) {
    const saved = migrate(fixtures[version], s);
    assert.equal(saved.locations.newSite.resources.scrap, 30000);
    assert.equal(saved.locations.habitat.resources.newBulk, 0);
    assert.equal(saved.npcs.newNpc.inventory.scrap, 20000);
    assert.deepEqual(migrate(saved, s), saved);
  }
});

test("full historical caps migrate to valid cargo without loss", () => {
  const old = structuredClone(fixtures[6]);
  for (const [id, item] of Object.entries(LEGACY_STORAGE.items)) old.locations.habitat.resources[id] = item.baseCapacity;
  const next = migrate(old);
  const summary = storageSummary(systems.contextFor(next).store, systems.content);
  assert.equal(summary.usedVolumeUnits, 2150000); assert.equal(summary.overloadVolumeUnits, 0);
  validateState(next, systems.content, systems.world, systems.people, systems.research);
});

test("invalid legacy quantities, removed IDs and unknown conversion metadata fail without mutation", () => {
  for (const mutate of [s => s.locations.habitat.resources.scrap = 61, s => s.locations.habitat.resources.scrap = 0.5,
    s => s.locations.habitat.resources.scrap = -1, s => s.locations.habitat.resources.missing = 0,
    s => s.npcs.mira.inventory.scrap = 21, s => s.locations.vicinity.resources.scrap = 1, s => s.saveVersion = 8]) {
    const saved = structuredClone(fixtures[6]); mutate(saved); const before = structuredClone(saved);
    assert.throws(() => migrate(saved)); assert.deepEqual(saved, before);
  }
  const metadata = structuredClone(LEGACY_STORAGE); delete metadata.volumeUnitsPerLegacyUnit.scrap;
  assert.throws(() => migrate(fixtures[6], systems, [], metadata), /conversion/);
  metadata.volumeUnitsPerLegacyUnit.scrap = Number.MAX_SAFE_INTEGER;
  assert.throws(() => migrate(fixtures[6], systems, [], metadata), /overflow/);
  const source = structuredClone(definitions); source.items.scrap.category = "component";
  delete source.items.scrap.researchSampleM3; source.items.scrap.unitVolumeM3 = 0.01; source.items.scrap.acquisition[0].amount = 1;
  // Changing category also requires correcting raw recipe quantities in the new catalog.
  for (const item of Object.values(source.items)) for (const recipe of item.recipes ?? []) for (const slot of recipe.inputs) if (slot.item === "scrap") slot.quantity *= 100;
  const s = buildGameSystems({ content: buildCatalog(source), npcSource: { ...npcDefinitions, mira: { ...npcDefinitions.mira, initialInventory: { scrap: 4 }, inventoryCapacities: { scrap: 20 } } } });
  assert.throws(() => migrate(fixtures[6], s), /Explicit legacy/);
});

test("migration preserves active ship journeys, journal/RNG, and equipment", () => {
  const source = structuredClone(locationDefinitions);
  source.locations.courier = { name: "Courier", description: "Ship", remoteDescription: "Ship", type: "ship", areaId: "vicinity", initialOwnerId: "player",
    initialResources: { power: 20 }, initialInfrastructure: { engine: { quantity: 1 } } };
  const s = buildGameSystems({ locationSource: source });
  const old = structuredClone(fixtures[6]);
  old.locations.courier = { ownerId: "player", areaId: "vicinity", dockedAtId: null,
    resources: { ...old.locations.habitat.resources, scrap: 7, power: 20 }, infrastructure: structuredClone(old.locations.habitat.infrastructure), flags: {}, journey: null };
  old.locations.courier.infrastructure.engine.quantity = 1;
  old.locationId = "courier";
  // Obtain the real journey schema using normal navigation, then retain legacy inventory.
  const current = migrate(old, s);
  s.actions.find(a => a.id === "travel").execute(current, s.contextFor(current), { targetId: "outerReach" });
  old.locations.courier.journey = structuredClone(current.locations.courier.journey);
  old.locations.courier.resources.power = current.locations.courier.resources.power;
  const next = migrate(old, s);
  assert.deepEqual(next.locations.courier.journey, old.locations.courier.journey);
  assert.deepEqual(next.research, old.research);
  for (const [id,machine] of Object.entries(old.locations.courier.infrastructure)) assert.deepEqual(next.locations.courier.infrastructure[id],machine);
  assert.equal(next.locations.courier.infrastructure.mineralExtractors.quantity,0);
  assert.equal(next.locations.courier.infrastructure.thermalProcessors.quantity,0);
  assert.equal(next.locations.courier.resources.scrap, 70000);
});
