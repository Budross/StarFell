import { buildCatalog } from "./itemCatalog.js";
import { vesselItems } from './vesselContent.js';

// Author new items here. Inventory, recipes, compatible roles, and actions are derived.
export const definitions = {
  recipeCapabilities: ["fabrication"],
  utilities: { power: { name: "Power", baseCapacity: 40, initialQuantity: 0 } },
  infrastructure: {
    engine: { name: "Ship engine", capabilities: ["propulsion"], travelSpeed: 10, initialQuantity: 0 },
    fabricator: { name: "Fabrication facility", capabilities: ["fabrication", "benchAnalysis"], initialQuantity: 0 },
    solar: { name: "Starting solar array", powerPerSecond: 0.5, initialQuantity: 0, initialHealth: 1,
      narrative: { observableTopics:['equipment_condition'] } },
    habitat: { name: "Habitat life support", powerPerSecond: -0.2, initialQuantity: 0 }
  },
  items: {
    ...vesselItems,
    scrap: {
      name: "Metal scrap", description: "Recovered mixed metal.", category: "resource", researchSampleM3: 0.01,
      tags: ["metal"],
      acquisition: [{ id: "salvage", name: "Salvage panels", shortcut: "1", order: 10, amount: 0.01,
        conditions: {} }]
    },
    electronicSalvage: {
      name: "Electronic salvage", description: "Electrical material recovered from local debris.",
      category: "resource", researchSampleM3: 0.005, tags: ["electrical"],
      acquisition: [{ id: "gatherElectronics", name: "Search equipment debris", order: 40, amount: 0.005,
        conditions: {} }]
    },
    siliconMinerals: {
      name: "Silicon-bearing minerals", description: "Mineral feedstock from nearby deposits.",
      category: "resource", researchSampleM3: 0.01, tags: ["mineral", "silicon"],
      acquisition: [{ id: "gatherMinerals", name: "Sample nearby deposits", order: 50, amount: 0.01,
        conditions: {} }]
    },
    iron: {
      name: "Iron structural parts", description: "Prepared metal supports and fittings.",
      category: "component", unitVolumeM3: 0.005, tags: ["metal", "rigid"], roles: { structure: {} },
      recipes: [{ id: "refine", name: "Fabricate structural parts", conditions: { discoveries: ["structuralFabrication"] }, inputs: [{ id: "metal", item: "scrap", quantity: 0.04 }],
        directive: { id: "refineScrap", name: "Refine scrap", aliases: ["refine"], shortcut: "2", order: 20, showLocked: true,
          blockedReason: "Requires knowledge and an operational fabricator. Open Research." } }]
    },
    conductiveParts: {
      name: "Conductive parts", description: "Prepared conductors for electrical assemblies.",
      category: "component", unitVolumeM3: 0.002, tags: ["conductive"], roles: { conductor: {} },
      recipes: [{ id: "fabricate", name: "Fabricate conductive parts", conditions: { discoveries: ["electricalConduction"] }, inputs: [
        { id: "metal", item: "scrap", quantity: 0.02 }, { id: "salvage", item: "electronicSalvage", quantity: 0.005 }
      ] }]
    },
    electronicParts: {
      name: "Electronic parts", description: "Prepared circuitry for control and communications.",
      category: "component", unitVolumeM3: 0.001, tags: ["electronic"], roles: { electronics: {} },
      recipes: [{ id: "fabricate", name: "Fabricate electronic parts", conditions: { discoveries: ["circuitAssembly"] }, inputs: [
        { id: "salvage", item: "electronicSalvage", quantity: 0.01 }
      ] }]
    },
    solarCells: {
      name: "Solar cells", description: "Photovoltaic components. Fabrication includes material processing.",
      category: "component", unitVolumeM3: 0.002, tags: ["photovoltaic"], roles: { photovoltaic: {} },
      recipes: [{ id: "fabricate", name: "Fabricate solar cells", conditions: { discoveries: ["photovoltaicFabrication"] }, inputs: [
        { id: "mineral", item: "siliconMinerals", quantity: 0.02 }, { id: "electronics", item: "electronicParts", quantity: 1 }
      ] }]
    },
    solarPanel: {
      name: "Solar panel", description: "Install to generate an additional 0.5 power per second.",
      category: "product", unitVolumeM3: 0.03, tags: ["power", "solar"],
      recipes: [{ id: "assemble", name: "Assemble solar panel", conditions: { discoveries: ["structuralFabrication", "electricalConduction", "photovoltaicFabrication"] }, inputs: [
        { id: "frame", role: "structure", quantity: 2, defaultItem: "iron" },
        { id: "wiring", role: "conductor", quantity: 1, defaultItem: "conductiveParts" },
        { id: "cells", role: "photovoltaic", quantity: 2, defaultItem: "solarCells" }
      ] }],
      installation: { group: "installedPanels", powerPerSecond: 0.5, conditions: {} },
      maintenance: [{ id: "repairSolar", name: "Repair solar array", aliases: ["repair"], shortcut: "3", order: 30,
        target: "solar", cost: { iron: 2 }, conditions: { discoveries: ["structuralFabrication"] }, showLocked: true,
        blockedReason: "Learn structural fabrication in Research." }]
    },
    batteryBank: {
      name: "Battery Bank", description: "Install to add 10 local power capacity. Stores surplus power automatically without generating or consuming power.",
      category: "product", unitVolumeM3: 0.025, tags: ["power", "storage"],
      recipes: [{ id: "assemble", name: "Assemble battery bank", conditions: { discoveries: ["structuralFabrication", "electricalConduction"] }, inputs: [
        { id: "frame", role: "structure", quantity: 2, defaultItem: "iron" },
        { id: "wiring", role: "conductor", quantity: 2, defaultItem: "conductiveParts" }
      ] }],
      installation: { group: "installedBatteryBanks", capacityBonus: { power: 10 }, conditions: {} }
    },
    mineralExtractor: {
      name: 'Mineral extractor', description: 'Extracts one finite surface-mineral batch at a time.',
      category: 'product', unitVolumeM3: 0.03, tags: ['industrial'],
      recipes: [{ id: 'assemble', name: 'Assemble mineral extractor', conditions: { discoveries: ['structuralFabrication','electricalConduction'] }, inputs: [
        { id: 'frame', item: 'iron', quantity: 2 }, { id: 'wiring', item: 'conductiveParts', quantity: 1 }
      ] }], installation: { group: 'mineralExtractors', capabilities: ['surfaceExtraction'], conditions: {} }
    },
    thermalProcessor: {
      name: 'Thermal processor', description: 'Loads minerals and electronics to process efficient photovoltaic batches.',
      category: 'product', unitVolumeM3: 0.04, tags: ['industrial'],
      recipes: [{ id: 'assemble', name: 'Assemble thermal processor', conditions: { discoveries: ['structuralFabrication','electricalConduction'] }, inputs: [
        { id: 'frame', item: 'iron', quantity: 2 }, { id: 'wiring', item: 'conductiveParts', quantity: 1 }, { id: 'circuits', item: 'electronicParts', quantity: 1 }
      ] }], installation: { group: 'thermalProcessors', capabilities: ['thermalRefining'], conditions: {} }
    },
    radioAntenna: {
      name: "Radio antenna", description: "Connect to habitat communications to scan for a local signal.",
      category: "product", unitVolumeM3: 0.01, tags: ["communications"],
      recipes: [{ id: "assemble", name: "Assemble radio antenna", conditions: { discoveries: ["radioAssembly"] }, inputs: [
        { id: "frame", role: "structure", quantity: 1, defaultItem: "iron" },
        { id: "wiring", role: "conductor", quantity: 1, defaultItem: "conductiveParts" },
        { id: "circuits", role: "electronics", quantity: 1, defaultItem: "electronicParts" }
      ] }],
      installation: { group: "installedAntenna", limit: 1, capabilities: ["radio"], conditions: {} },
      operations: [{ id: "scanSignal", name: "Scan local frequencies", cost: { power: 1 },
        conditions: { capabilities: ["radio"] }, once: true,
        completion: { scope: "global", flag: "localSignalObserved" },
        effects: [{ type: "setFlag", scope: "global", flag: "localSignalObserved", value: true }],
        message: "A repeating signal emerges from the static. The observation is saved for future investigation." }]
    }
  }
};

export const content = buildCatalog(definitions);
