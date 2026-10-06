// Ordinary catalog content; the vessel engine does not switch on these IDs.
const recipe = (name, inputs, discoveries, amount = 1) => [{ id: 'fabricate', name, amount, conditions: { discoveries },
  inputs: Object.entries(inputs).map(([item, quantity]) => ({ id: item, item, quantity })) }];
const component = (name, description, volume, inputs, discoveries, amount = 1, tags = []) => ({ name, description,
  category: 'component', unitVolumeM3: volume, tags, recipes: recipe(`Fabricate ${name.toLowerCase()}`, inputs, discoveries, amount) });
const raw = (name, description, tags) => ({ name, description, category: 'resource', researchSampleM3: 0.01, tags });
const module = (name, description, volume, mass, width, height, category, design, inputs, capabilities = {}, core, supporting = []) => ({
  knowledgeEntry: { notes:[{ id:'moduleFitting',title:'Module fitting',text:'Fit this product as part of a vessel in the Shipyard. Module composition supplies its installed behavior.',learnWhen:{onEncounter:true} }] },
  name, description, category: 'product', unitVolumeM3: volume, tags: ['vesselModule'], recipes: recipe(`Fabricate ${name.toLowerCase()}`, inputs, [design, ...supporting]),
  vesselModule: { role: core ? 'core' : 'attachment', category, footprint: { width, height }, dryMassKg: mass, designDiscoveryId: design, capabilities, ...(core ? { core } : {}) } });
const tank = capacityM3 => ({ fuelStorage: { capacityM3, acceptedFuelItemIds: ['reactionMassCartridge'] } });
const drive = (travelSpeed, distancePerFuelUnit) => ({ propulsion: { travelSpeed, distancePerFuelUnit, fuelItemId: 'reactionMassCartridge' } });
export const vesselItems = {
  titaniumOre: raw('Titanium Ore', 'Titanium-bearing metallic ore suitable for lightweight structural alloys.', ['metal', 'titanium']),
  carbonaceousRock: raw('Carbonaceous Rock', 'Carbon-rich asteroid material containing useful organic and carbon compounds.', ['carbonaceous', 'carbon']),
  rareEarthMinerals: {
  "name": "Rare Earth Ore",
  "description": "Mineral feedstock for permanent magnets and advanced electrical machinery.",
  "category": "resource",
  "researchSampleM3": 0.01,
  "tags": [
    "mineral",
    "rareEarth"
  ]
},
  tungstenOre: raw('Tungsten Ore', 'Dense tungsten-bearing ore useful in high-temperature and high-wear equipment.', ['metal', 'tungsten']),
  waterIce: raw('Water Ice', 'Frozen water-bearing material from cold deposits. Feedstock for coolant containers and future industrial chemistry.', ['ice', 'water']),
  structuralFrame: component('Structural Frame', 'Welded iron framing for modules, assembly and general machinery.', 0.02, { iron: 2 }, ['modularStructures'], 1, ['metal', 'rigid']),
  controlBus: component('Control Bus', 'Conductors and circuitry for machine control and module interfaces.', 0.005, { conductiveParts: 1, electronicParts: 1 }, ['circuitAssembly'], 1, ['electronic', 'conductive']),
  reactionMassCartridge: component('Reaction-Mass Cartridge', 'Packaged mineral reaction mass. Load into a compatible tank before travel.', 0.01, { siliconMinerals: 0.05, iron: 1 }, ['propellantHandling'], 5),
  titaniumAlloyStock: {
  "name": "Titanium Alloy Stock",
  "description": "Light alloy members for machine frames and pressure structures.",
  "category": "component",
  "unitVolumeM3": 0.005,
  "tags": [
    "metal",
    "titanium"
  ],
  "recipes": [
    {
      "id": "fabricate",
      "name": "Fabricate titanium alloy stock",
      "amount": 2,
      "conditions": {
        "discoveries": [
          "lightAlloyMetallurgy"
        ]
      },
      "inputs": [
        {
          "id": "titaniumOre",
          "item": "titaniumOre",
          "quantity": 0.04
        },
        {
          "id": "iron",
          "item": "iron",
          "quantity": 1
        }
      ],
      "retiredWhen": {
        "capabilities": [
          "vacuumRefining"
        ],
        "discoveries": [
          "industrialTitanium"
        ]
      }
    }
  ]
},
  carbonCompositePanel: component('Carbon Composite Panel', 'Lightweight panels for cargo structures and equipment housings.', 0.02, { carbonaceousRock: 0.04, siliconMinerals: 0.01 }, ['compositeFabrication'], 2, ['carbon']),
  polymerSealPack: {
  "name": "Polymer Seal Pack",
  "description": "Sealing and insulation hardware for tanks, pumps and pressure systems.",
  "category": "component",
  "unitVolumeM3": 0.002,
  "tags": [
    "carbon"
  ],
  "recipes": [
    {
      "id": "fabricate",
      "name": "Fabricate polymer seal pack",
      "amount": 5,
      "conditions": {
        "discoveries": [
          "polymerSynthesis"
        ]
      },
      "inputs": [
        {
          "id": "carbonaceousRock",
          "item": "carbonaceousRock",
          "quantity": 0.02
        }
      ],
      "retiredWhen": {
        "capabilities": [
          "chemicalSynthesis",
          "electrolysis"
        ],
        "discoveries": [
          "waterChemistry"
        ]
      }
    }
  ]
},
  magneticAlloyParts: {
  "name": "Magnetic Alloy Parts",
  "description": "Magnetic machine parts for motors, generators and actuators.",
  "category": "component",
  "unitVolumeM3": 0.003,
  "tags": [],
  "recipes": [
    {
      "id": "fabricate",
      "name": "Fabricate magnetic alloy parts",
      "amount": 2,
      "conditions": {
        "discoveries": [
          "permanentMagnetMachinery"
        ]
      },
      "inputs": [
        {
          "id": "rareEarthMinerals",
          "item": "rareEarthMinerals",
          "quantity": 0.02
        },
        {
          "id": "conductiveParts",
          "item": "conductiveParts",
          "quantity": 1
        }
      ],
      "retiredWhen": {
        "capabilities": [
          "materialSeparation"
        ],
        "discoveries": [
          "industrialSeparation"
        ]
      }
    }
  ]
},
  precisionActuator: component('Precision Actuator', 'Controlled motion for robotics, mining and industrial automation.', 0.005, { magneticAlloyParts: 1, controlBus: 1, structuralFrame: 1 }, ['precisionActuation']),
  tungstenAlloyStock: component('Tungsten Alloy Stock', 'Dense alloy stock for heat, wear and heavy loads.', 0.005, { tungstenOre: 0.03, iron: 1 }, ['tungstenMetallurgy'], 2, ['metal', 'tungsten']),
  tungstenToolHead: component('Tungsten Tool Head', 'Wear-resistant tooling for drills, cutters and extraction machines.', 0.008, { tungstenAlloyStock: 1, structuralFrame: 1 }, ['tungstenMetallurgy']),
  highTempCeramic: component('High-Temperature Ceramic', 'Ceramic internals for thrusters, insulation and refining machinery.', 0.006, { siliconMinerals: 0.02, tungstenAlloyStock: 1 }, ['highTempCeramics'], 2),
  pressureVessel: component('Pressure Vessel', 'A sealed engineering Component for tanks and industrial process machinery.', 0.1, { titaniumAlloyStock: 2, polymerSealPack: 2 }, ['pressureSystems']),
  magneticDriveAssembly: component('Magnetic Drive Assembly', 'A drive Component for propulsion and industrial motors.', 0.025, { magneticAlloyParts: 2, precisionActuator: 1, controlBus: 1 }, ['permanentMagnetMachinery', 'precisionActuation']),
  coolantCanister: component('Coolant Canister', 'Contained ice-derived coolant stock for future machinery. No automatic consumption.', 0.15, { waterIce: 0.03, pressureVessel: 1, polymerSealPack: 1 }, ['pressureSystems']),
  basicCrewedCore: module('Basic Crewed Core', 'An operator-carrying core made with explored structural and sealing materials.', 4, 220, 2, 2, 'Core', 'crewedCoreDesign', { structuralFrame: 8, titaniumAlloyStock: 4, carbonCompositePanel: 4, polymerSealPack: 4, pressureVessel: 2, controlBus: 3, electronicParts: 2 }, {}, { vesselClass: 'crewed', controlMode: 'direct', boardable: true }, ['pressureSystems', 'compositeFabrication']),
  basicAutonomousCore: module('Basic Autonomous Core', 'A simple commanded platform core. Cannot carry occupants.', 0.5, 45, 1, 1, 'Core', 'autonomousCoreDesign', { structuralFrame: 2, controlBus: 2, electronicParts: 1 }, {}, { vesselClass: 'autonomous', controlMode: 'commanded', boardable: false }),
  smallCargoModule: module('Small Cargo Module', 'A broad cargo block with 0.50 m³ usable storage.', 1.5, 85, 2, 2, 'Logistics', 'modularStructures', { structuralFrame: 3 }, { cargoStorage: { capacityM3: 0.5 } }),
  smallFuelTank: module('Small Fuel Tank', 'An empty tank holding 25 cartridges when loaded.', 0.8, 35, 1, 2, 'Logistics', 'modularStructures', { structuralFrame: 2, controlBus: 1 }, tank(0.25), undefined, ['propellantHandling']),
  basicReactionThruster: module('Basic Reaction Thruster', 'Simple propulsion using loaded reaction-mass cartridges.', 0.8, 55, 1, 2, 'Propulsion', 'reactionPropulsion', { structuralFrame: 2, controlBus: 1, conductiveParts: 1 }, drive(10, 10)),
  basicPowerModule: module('Basic Power Module', 'Generates 0.50 power/s and provides a 10-unit reserve.', 0.5, 25, 1, 1, 'Systems', 'photovoltaicFabrication', { structuralFrame: 2, controlBus: 1, solarCells: 2 }, { equipment: { powerPerSecond: 0.5, capacityBonus: { power: 10 } } }),
  basicRadioModule: module('Basic Radio Module', 'Supports remote commands when the operator also has an operational radio.', 0.25, 8, 1, 1, 'Systems', 'radioAssembly', { structuralFrame: 1, controlBus: 1, electronicParts: 1 }, { equipment: { capabilities: [{"type":"radioCommunication"}] } }),
  basicExtractionModule: module('Basic Extraction Module', 'Processes finite surface-resource batches in available machine slots.', 1, 65, 1, 2, 'Industrial', 'modularExtraction', { structuralFrame: 2, controlBus: 1, conductiveParts: 1 }, { equipment: { capabilities: [{"type":"surfaceExtraction"}] } }),
  lightweightCargoModule: module('Lightweight Cargo Module', 'Lighter cargo hardware with 0.60 m³ storage and elongated mounting.', 1.2, 45, 1, 3, 'Logistics', 'lightweightCargoDesign', { titaniumAlloyStock: 2, carbonCompositePanel: 2, structuralFrame: 1 }, { cargoStorage: { capacityM3: 0.6 } }),
  improvedFuelTank: module('Improved Fuel Tank', 'A wider, lighter empty tank with space for 60 cartridges.', 0.9, 25, 2, 1, 'Logistics', 'improvedFuelTankDesign', { pressureVessel: 2, titaniumAlloyStock: 2, polymerSealPack: 2, structuralFrame: 1 }, tank(0.6)),
  efficientDriveModule: module('Efficient Drive Module', 'Faster, fuel-efficient propulsion with a larger footprint and continuous power demand.', 1.2, 70, 1, 3, 'Propulsion', 'efficientDriveDesign', { magneticDriveAssembly: 1, highTempCeramic: 2, tungstenAlloyStock: 2, structuralFrame: 1 }, { ...drive(15, 18), equipment: { powerPerSecond: -0.05 } }),
  improvedExtractionModule: module('Improved Extraction Module', 'Larger machinery with twice the Processing speed and 1.5 times instantaneous power demand.', 1.4, 80, 2, 2, 'Industrial', 'improvedExtractionDesign', { tungstenToolHead: 1, precisionActuator: 1, controlBus: 1, structuralFrame: 2 }, { equipment: { capabilities: [{"type":"surfaceExtraction"}], processing: { speedMultiplier: 2, powerMultiplier: 1.5 } } })
};
const evidence = (id, samples, insight, observation) => ({ id, insight, once: true, observation, samples: { items: samples, minSamples: samples.length, maxSamples: samples.length,
  ...(samples.length > 1 ? { distinct: samples.map(item => ({ items: [item] })) } : {}) } });
const discovery = (name, eligibility, first, second, firstInsight = 4) => ({ name, description: `Reusable engineering knowledge: ${name.toLowerCase()}.`, families: ['materials', 'mechanics'], threshold: 10,
  eligibility: { discoveries: eligibility }, evidence: [evidence('materialStudy', first, firstInsight, `The first experiment establishes a repeatable material behavior.`), evidence('hardwareStudy', second, 10 - firstInsight, `Prepared hardware establishes ${name.toLowerCase()}.`)] });
export const vesselDiscoveries = {
  modularStructures: discovery('Modular structures', ['structuralFabrication'], ['iron'], ['iron', 'conductiveParts']),
  autonomousCoreDesign: discovery('Autonomous core design', ['modularStructures', 'circuitAssembly'], ['electronicParts'], ['electronicParts', 'conductiveParts'], 6),
  reactionPropulsion: { ...discovery('Reaction propulsion', ['modularStructures', 'electricalConduction'], ['iron', 'conductiveParts'], ['electronicParts', 'conductiveParts']), evidence: [
    ...discovery('Reaction propulsion', [], ['iron', 'conductiveParts'], ['electronicParts', 'conductiveParts']).evidence,
    evidence('recoveredHardware', ['basicReactionThruster'], 10, 'The sacrificed reaction assembly reveals how its drive hardware is constructed.')] },
  propellantHandling: discovery('Propellant handling', ['modularStructures'], ['siliconMinerals'], ['siliconMinerals', 'iron']),
  modularExtraction: discovery('Modular extraction', ['modularStructures', 'electricalConduction'], ['siliconMinerals'], ['siliconMinerals', 'conductiveParts']),
  lightAlloyMetallurgy: discovery('Light-alloy metallurgy', ['structuralFabrication'], ['titaniumOre'], ['titaniumOre', 'iron']),
  polymerSynthesis: discovery('Polymer synthesis', ['electricalConduction'], ['carbonaceousRock'], ['carbonaceousRock', 'siliconMinerals']),
  compositeFabrication: discovery('Composite fabrication', ['polymerSynthesis'], ['carbonaceousRock'], ['carbonaceousRock', 'polymerSealPack']),
  permanentMagnetMachinery: discovery('Permanent-magnet machinery', ['electricalConduction', 'circuitAssembly'], ['rareEarthMinerals'], ['rareEarthMinerals', 'conductiveParts']),
  precisionActuation: discovery('Precision actuation', ['permanentMagnetMachinery', 'circuitAssembly'], ['magneticAlloyParts'], ['magneticAlloyParts', 'controlBus']),
  tungstenMetallurgy: discovery('Tungsten metallurgy', ['structuralFabrication'], ['tungstenOre'], ['tungstenOre', 'iron']),
  pressureSystems: discovery('Pressure systems', ['lightAlloyMetallurgy', 'polymerSynthesis'], ['titaniumAlloyStock'], ['titaniumAlloyStock', 'polymerSealPack']),
  highTempCeramics: discovery('High-temperature ceramics', ['tungstenMetallurgy'], ['siliconMinerals'], ['siliconMinerals', 'tungstenAlloyStock']),
  crewedCoreDesign: discovery('Crewed core design', ['pressureSystems', 'compositeFabrication'], ['titaniumAlloyStock', 'carbonCompositePanel'], ['pressureVessel', 'controlBus']),
  lightweightCargoDesign: discovery('Lightweight cargo design', ['lightAlloyMetallurgy', 'compositeFabrication'], ['titaniumAlloyStock'], ['titaniumAlloyStock', 'carbonCompositePanel']),
  improvedFuelTankDesign: discovery('Improved fuel tank design', ['pressureSystems'], ['pressureVessel'], ['pressureVessel', 'polymerSealPack']),
  efficientDriveDesign: discovery('Efficient drive design', ['permanentMagnetMachinery', 'precisionActuation', 'highTempCeramics'], ['magneticDriveAssembly'], ['tungstenAlloyStock', 'highTempCeramic']),
  improvedExtractionDesign: discovery('Improved extraction design', ['precisionActuation', 'tungstenMetallurgy'], ['precisionActuator'], ['tungstenToolHead', 'controlBus'])
};
export const vesselResearchHints = [
  { conditions: { discoveries: ['structuralFabrication'], not: { discoveries: ['modularStructures'] } }, text: 'Study iron alone, then iron with conductive parts, to learn modular framing. Recovered hardware can be assembled before its fabrication design is known.' },
  { conditions: { discoveries: ['modularStructures'], not: { discoveries: ['autonomousCoreDesign'] } }, text: 'Study electronic parts alone and with conductive parts for autonomous control. Study minerals alone and with iron or conductors for fuel handling and extraction.' },
  { conditions: { discoveries: ['autonomousCoreDesign'] }, text: 'A prospector needs core, cargo, tank, drive, power, radio and extraction. Install a Habitat radio too. Load cartridges and wait for power before launch; the nearby metallic fragment has new ores.' },
  { conditions: { discoveries: ['lightAlloyMetallurgy'] }, text: 'Carbon-rich material enables seals and composites; rare-earth minerals enable magnets; tungsten enables tooling. Extra basic tanks can extend a crude vessel’s return journey.' }
];
