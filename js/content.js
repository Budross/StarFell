import { buildCatalog } from "./itemCatalog.js";
import { vesselItems } from './vesselContent.js';

// Author new items here. Inventory, recipes, compatible roles, and actions are derived.
export const definitions = {
  recipeCapabilities: ["fabrication"],
  utilities: { power: { name: "Power", baseCapacity: 40, initialQuantity: 0 } },
  infrastructure: {
    engine: { name: "Ship engine", capabilities: [], travelSpeed: 10, initialQuantity: 0 },
    fabricator: { name: "Fabrication facility", capabilities: [{ type: "fabrication" }, { type: "benchAnalysis" }], initialQuantity: 0 },
    solar: { name: "Starting solar array", powerPerSecond: 0.5, initialQuantity: 0, initialHealth: 1,
      narrative: { observableTopics:['equipment_condition'] } },
    habitat: { name: "Habitat life support", powerPerSecond: -0.2, initialQuantity: 0 }
  },
  items: {
    ...vesselItems,
    scrap: {
      name: "Metal Scrap", description: "Recovered mixed metal.", category: "resource", researchSampleM3: 0.01,
      knowledgeEntry: { summary:"Mixed metal recovered from damaged structures.",notes:[
        { id:'bulkHandling',title:'Storage',text:'Metal scrap is stored by bulk volume in m³.',learnWhen:{onEncounter:true} },
        { id:'structuralUse',title:'Structural fabrication',text:'Prepared metal stock can be fabricated into supports and fittings.',learnWhen:{conditions:{discoveries:['structuralFabrication']}} }
      ] },
      tags: ["metal"],
      acquisition: [{ id: "salvage", name: "Salvage panels", shortcut: "1", order: 10, amount: 0.01,
        conditions: {} }]
    },
    electronicSalvage: {
      name: "Electronic Scrap", description: "Electrical material recovered from local debris.",
      category: "resource", researchSampleM3: 0.005, tags: ["electrical"],
      acquisition: [{ id: "gatherElectronics", name: "Search equipment debris", order: 40, amount: 0.005,
        conditions: {} }]
    },
    siliconMinerals: {
      name: "Silicon-bearing minerals", description: "Mineral feedstock from nearby deposits.",
      knowledgeEntry: { notes:[{ id:'photovoltaics',title:'Photovoltaic feedstock',text:'Silicon-bearing feedstock is useful in producing photovoltaic cells.',learnWhen:{conditions:{discoveries:['photovoltaicFabrication']}} }] },
      category: "resource", researchSampleM3: 0.01, tags: ["mineral", "silicon"],
      acquisition: [{ id: "gatherMinerals", name: "Sample nearby deposits", order: 50, amount: 0.01,
        conditions: {} }]
    },
    iron: {
      name: "Iron structural parts", description: "Prepared metal supports and fittings.",
      knowledgeEntry: { notes:[{ id:'structure',title:'Structural ingredient',text:'These prepared parts serve as approved structural ingredients. The known recipe determines the required quantity.',learnWhen:{conditions:{discoveries:['structuralFabrication']}} }] },
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
      knowledgeEntry: { notes:[{ id:'installation',title:'Installation',text:'Stored panels produce no power. Install one on an eligible owned host to add generation.',learnWhen:{onEncounter:true} }] },
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
      ] }], installation: { group: 'mineralExtractors', capabilities: [{"type":"surfaceExtraction"}], conditions: {} }
    },
    thermalProcessor: {
      name: 'Thermal processor', description: 'Loads minerals and electronics to process efficient photovoltaic batches.',
      category: 'product', unitVolumeM3: 0.04, tags: ['industrial'],
      recipes: [{ id: 'assemble', name: 'Assemble thermal processor', conditions: { discoveries: ['structuralFabrication','electricalConduction'] }, inputs: [
        { id: 'frame', item: 'iron', quantity: 2 }, { id: 'wiring', item: 'conductiveParts', quantity: 1 }, { id: 'circuits', item: 'electronicParts', quantity: 1 }
      ] }], installation: { group: 'thermalProcessors', capabilities: [{"type":"thermalRefining"}], conditions: {} }
    },
    radioAntenna: {
      name: "Radio antenna", description: "Connect to habitat communications to scan for a local signal.",
      category: "product", unitVolumeM3: 0.01, tags: ["communications"],
      recipes: [{ id: "assemble", name: "Assemble radio antenna", conditions: { discoveries: ["radioAssembly"] }, inputs: [
        { id: "frame", role: "structure", quantity: 1, defaultItem: "iron" },
        { id: "wiring", role: "conductor", quantity: 1, defaultItem: "conductiveParts" },
        { id: "circuits", role: "electronics", quantity: 1, defaultItem: "electronicParts" }
      ] }],
      installation: { group: "installedAntenna", limit: 1, capabilities: [{"type":"radioCommunication"},{"type":"signalScanning"}], conditions: {} }
    },
    water: {
  "name": "Water",
  "description": "Prepared water for electrolysis and industrial feed.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "tags": [
    "water"
  ],
  "materialProfile": {
    "character": "water"
  }
},
    hydrogen: {
  "name": "Hydrogen",
  "description": "Chemical feedstock. Volume is a standard packed-storage equivalent, not free-gas volume. Not compatible with cartridge vessel tanks.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "tags": [
    "chemical"
  ],
  "materialProfile": {
    "character": "gas"
  }
},
    oxygen: {
  "name": "Oxygen",
  "description": "Electrolysis coproduct used in oxygen-assisted metal recovery. Standard packed-storage equivalent volume.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "tags": [
    "chemical"
  ],
  "materialProfile": {
    "character": "gas"
  }
},
    steelAlloy: {
  "name": "Steel",
  "description": "Bulk recovered or alloyed structural steel; fabricate discrete fittings and frames from it.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "tags": [
    "metal",
    "rigid"
  ],
  "materialProfile": {
    "character": "metal"
  },
  "roles": {
    "structuralMaterial": {
      "unitsPerM3": 200
    }
  },
  "recipeContributions": [
    {
      "id": "fromSteel",
      "name": "Form steel structural fittings",
      "amount": 1,
      "inputs": [
        {
          "id": "steelAlloy",
          "item": "steelAlloy",
          "quantity": 0.003
        }
      ],
      "conditions": {
        "discoveries": [
          "structuralFabrication", "waterChemistry"
        ]
      },
      "output": "iron"
    },
    {
      "id": "steelFrame",
      "name": "Fabricate steel frame",
      "amount": 1,
      "inputs": [
        {
          "id": "steelAlloy",
          "item": "steelAlloy",
          "quantity": 0.008
        }
      ],
      "conditions": {
        "discoveries": [
          "modularStructures", "waterChemistry"
        ]
      },
      "output": "structuralFrame"
    }
  ]
},
    polymerFeedstock: {
  "name": "Polymer",
  "description": "Bulk polymer feed for seals and insulation.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "tags": [
    "carbon"
  ],
  "materialProfile": {
    "character": "polymer"
  },
  "recipeContributions": [
    {
      "id": "fromPolymer",
      "name": "Fabricate polymer seals",
      "amount": 5,
      "inputs": [
        {
          "id": "polymerFeedstock",
          "item": "polymerFeedstock",
          "quantity": 0.002
        }
      ],
      "conditions": {
        "discoveries": [
          "polymerSynthesis"
        ]
      },
      "output": "polymerSealPack"
    }
  ]
},
    mineralResidue: {
  "name": "Mineral Residue",
  "description": "Spent mixed residue occupies cargo space. Discard deliberately when necessary; its original elemental composition is not recoverable from this mixed stock.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "tags": [],
  "materialProfile": {
    "character": "residue"
  }
},
    titanium: {
  "name": "Titanium",
  "description": "Refined titanium feed for lightweight alloy preparation.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "tags": [
    "metal",
    "titanium"
  ],
  "materialProfile": {
    "character": "metal"
  }
},
    titaniumAlloy: {
  "name": "Titanium Alloy",
  "description": "Bulk lightweight engineering alloy for pressure shells and formed structural members.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "tags": [
    "metal",
    "titanium"
  ],
  "materialProfile": {
    "character": "metal"
  },
  "roles": {
    "lightweightMaterial": {
      "unitsPerM3": 200
    }
  },
  "recipeContributions": [
    {
      "id": "fromBulkAlloy",
      "name": "Fabricate lightweight pressure vessel",
      "amount": 1,
      "inputs": [
        {
          "id": "titaniumAlloy",
          "item": "titaniumAlloy",
          "quantity": 0.008
        },
        {
          "id": "polymerSealPack",
          "item": "polymerSealPack",
          "quantity": 2
        }
      ],
      "conditions": {
        "discoveries": [
          "pressureSystems"
        ]
      },
      "output": "pressureVessel"
    },
    {
      "id": "formBulkStock",
      "name": "Form standardized alloy members",
      "amount": 2,
      "inputs": [
        {
          "id": "titaniumAlloy",
          "item": "titaniumAlloy",
          "quantity": 0.008
        }
      ],
      "conditions": {
        "discoveries": [
          "lightAlloyMetallurgy"
        ]
      },
      "output": "titaniumAlloyStock"
    }
  ]
},
    rareEarthConcentrate: {
  "name": "Rare Earth Concentrate",
  "description": "Concentrated feed for alternative magnetic-material separation routes.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "tags": [
    "rareEarth"
  ],
  "materialProfile": {
    "character": "mineral"
  }
},
    magneticRareEarthMaterial: {
  "name": "Magnetic Material",
  "description": "Separated bulk magnetic material for discrete permanent-magnet hardware.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "tags": [
    "rareEarth"
  ],
  "materialProfile": {
    "character": "metal"
  },
  "recipeContributions": [
    {
      "id": "fromSeparatedMaterial",
      "name": "Fabricate permanent magnet hardware",
      "amount": 2,
      "inputs": [
        {
          "id": "magneticRareEarthMaterial",
          "item": "magneticRareEarthMaterial",
          "quantity": 0.002
        },
        {
          "id": "conductiveParts",
          "item": "conductiveParts",
          "quantity": 1
        }
      ],
      "conditions": {
        "discoveries": [
          "permanentMagnetMachinery"
        ]
      },
      "output": "magneticAlloyParts"
    }
  ]
},
    basicPressureVessel: {
  "name": "Basic Pressure Vessel",
  "description": "Reusable basic pressure vessel for industrial machinery.",
  "category": "component",
  "unitVolumeM3": 0.06,
  "engineeringFunctions": [
    "containment"
  ],
  "recipes": [
    {
      "id": "recover",
      "name": "Build basic pressure vessel from recovered hardware",
      "amount": 1,
      "inputs": [
        {
          "id": "iron",
          "item": "iron",
          "quantity": 3
        },
        {
          "id": "polymerSealPack",
          "item": "polymerSealPack",
          "quantity": 2
        }
      ],
      "conditions": {
        "discoveries": [
          "structuralFabrication",
          "electricalConduction"
        ]
      }
    }
  ]
},
    motorAssembly: {
  "name": "Motor Assembly",
  "description": "Reusable motor assembly for industrial machinery.",
  "category": "component",
  "unitVolumeM3": 0.015,
  "engineeringFunctions": [
    "controlledMotion"
  ],
  "recipes": [
    {
      "id": "recover",
      "name": "Build motor assembly from recovered hardware",
      "amount": 1,
      "inputs": [
        {
          "id": "iron",
          "item": "iron",
          "quantity": 2
        },
        {
          "id": "conductiveParts",
          "item": "conductiveParts",
          "quantity": 2
        }
      ],
      "conditions": {
        "discoveries": [
          "structuralFabrication",
          "electricalConduction"
        ]
      }
    }
  ]
},
    pumpAssembly: {
  "name": "Pump Assembly",
  "description": "Reusable pump assembly for industrial machinery.",
  "category": "component",
  "unitVolumeM3": 0.025,
  "engineeringFunctions": [
    "fluidHandling"
  ],
  "recipes": [
    {
      "id": "recover",
      "name": "Build pump assembly from recovered hardware",
      "amount": 1,
      "inputs": [
        {
          "id": "motorAssembly",
          "item": "motorAssembly",
          "quantity": 1
        },
        {
          "id": "iron",
          "item": "iron",
          "quantity": 1
        },
        {
          "id": "polymerSealPack",
          "item": "polymerSealPack",
          "quantity": 1
        }
      ],
      "conditions": {
        "discoveries": [
          "structuralFabrication",
          "electricalConduction"
        ]
      }
    }
  ]
},
    valveAssembly: {
  "name": "Valve and Manifold Assembly",
  "description": "Reusable valve and manifold assembly for industrial machinery.",
  "category": "component",
  "unitVolumeM3": 0.008,
  "engineeringFunctions": [
    "fluidHandling"
  ],
  "recipes": [
    {
      "id": "recover",
      "name": "Build valve and manifold assembly from recovered hardware",
      "amount": 1,
      "inputs": [
        {
          "id": "iron",
          "item": "iron",
          "quantity": 1
        },
        {
          "id": "polymerSealPack",
          "item": "polymerSealPack",
          "quantity": 1
        }
      ],
      "conditions": {
        "discoveries": [
          "structuralFabrication",
          "electricalConduction"
        ]
      }
    }
  ]
},
    powerController: {
  "name": "Power Controller",
  "description": "Reusable power controller for industrial machinery.",
  "category": "component",
  "unitVolumeM3": 0.008,
  "engineeringFunctions": [
    "powerConditioning"
  ],
  "recipes": [
    {
      "id": "recover",
      "name": "Build power controller from recovered hardware",
      "amount": 1,
      "inputs": [
        {
          "id": "conductiveParts",
          "item": "conductiveParts",
          "quantity": 2
        },
        {
          "id": "electronicParts",
          "item": "electronicParts",
          "quantity": 1
        }
      ],
      "conditions": {
        "discoveries": [
          "circuitAssembly"
        ]
      }
    }
  ]
},
    electrodeSeparatorStack: {
  "name": "Electrode and Gas Separation Stack",
  "description": "Reusable electrode and gas separation stack for industrial machinery.",
  "category": "component",
  "unitVolumeM3": 0.02,
  "engineeringFunctions": [
    "electrochemicalConversion",
    "chemicalSeparation"
  ],
  "recipes": [
    {
      "id": "recover",
      "name": "Build electrode and gas separation stack from recovered hardware",
      "amount": 1,
      "inputs": [
        {
          "id": "conductiveParts",
          "item": "conductiveParts",
          "quantity": 2
        },
        {
          "id": "polymerSealPack",
          "item": "polymerSealPack",
          "quantity": 2
        },
        {
          "id": "iron",
          "item": "iron",
          "quantity": 1
        }
      ],
      "conditions": {
        "discoveries": [
          "structuralFabrication",
          "electricalConduction"
        ]
      }
    }
  ]
},
    thermalChamber: {
  "name": "Thermal Chamber",
  "description": "Reusable thermal chamber for industrial machinery.",
  "category": "component",
  "unitVolumeM3": 0.04,
  "engineeringFunctions": [
    "thermalProcessing"
  ],
  "recipes": [
    {
      "id": "recover",
      "name": "Build thermal chamber from recovered hardware",
      "amount": 1,
      "inputs": [
        {
          "id": "iron",
          "item": "iron",
          "quantity": 3
        },
        {
          "id": "conductiveParts",
          "item": "conductiveParts",
          "quantity": 2
        },
        {
          "id": "electronicParts",
          "item": "electronicParts",
          "quantity": 1
        }
      ],
      "conditions": {
        "discoveries": [
          "structuralFabrication",
          "electricalConduction"
        ]
      }
    }
  ]
},
    separationAssembly: {
  "name": "Separation Assembly",
  "description": "Reusable separation assembly for industrial machinery.",
  "category": "component",
  "unitVolumeM3": 0.03,
  "engineeringFunctions": [
    "chemicalSeparation"
  ],
  "recipes": [
    {
      "id": "recover",
      "name": "Build separation assembly from recovered hardware",
      "amount": 1,
      "inputs": [
        {
          "id": "motorAssembly",
          "item": "motorAssembly",
          "quantity": 1
        },
        {
          "id": "controlBus",
          "item": "controlBus",
          "quantity": 1
        },
        {
          "id": "polymerSealPack",
          "item": "polymerSealPack",
          "quantity": 2
        }
      ],
      "conditions": {
        "discoveries": [
          "structuralFabrication",
          "electricalConduction"
        ]
      }
    }
  ]
},
    electrolysisPlant: {
  "name": "Electrolysis Plant",
  "description": "Install to split prepared water into hydrogen and oxygen in powered batches.",
  "category": "product",
  "unitVolumeM3": 0.3,
  "recipes": [
    {
      "id": "assemble",
      "name": "Assemble electrolysis plant",
      "amount": 1,
      "inputs": [
        {
          "id": "basicPressureVessel",
          "item": "basicPressureVessel",
          "quantity": 1
        },
        {
          "id": "pumpAssembly",
          "item": "pumpAssembly",
          "quantity": 1
        },
        {
          "id": "valveAssembly",
          "item": "valveAssembly",
          "quantity": 1
        },
        {
          "id": "electrodeSeparatorStack",
          "item": "electrodeSeparatorStack",
          "quantity": 1
        },
        {
          "id": "powerController",
          "item": "powerController",
          "quantity": 1
        },
        {
          "id": "electronicParts",
          "item": "electronicParts",
          "quantity": 1
        }
      ],
      "conditions": {
        "discoveries": [
          "waterChemistry"
        ]
      }
    },
    {
      "id": "industrialAssembly",
      "name": "Assemble electrolysis plant with bulk structural material",
      "amount": 1,
      "inputs": [
        {
          "id": "steelAlloy",
          "item": "steelAlloy",
          "quantity": 0.015
        },
        {
          "id": "pumpAssembly",
          "item": "pumpAssembly",
          "quantity": 1
        },
        {
          "id": "valveAssembly",
          "item": "valveAssembly",
          "quantity": 1
        },
        {
          "id": "electrodeSeparatorStack",
          "item": "electrodeSeparatorStack",
          "quantity": 1
        },
        {
          "id": "powerController",
          "item": "powerController",
          "quantity": 1
        },
        {
          "id": "electronicParts",
          "item": "electronicParts",
          "quantity": 1
        }
      ],
      "conditions": {
        "discoveries": [
          "waterChemistry",
          "structuralFabrication", "waterChemistry"
        ]
      }
    }
  ],
  "installation": {
    "group": "electrolysisPlants",
    "capabilities": [{"type":"electrolysis"}]
  },
  "design": {
    "family": "electrolysis",
    "principles": [
      "waterChemistry"
    ]
  },
  "physicalProfile": {
    "form": "cylindrical",
    "surface": "machined",
    "exposedFeatures": [
      "pipework",
      "conductorRuns"
    ]
  }
},
    chemicalReactor: {
  "name": "Chemical Reactor",
  "description": "Install to turn carbonaceous feed and hydrogen into polymer feedstock, with spent residue to handle.",
  "category": "product",
  "unitVolumeM3": 0.3,
  "recipes": [
    {
      "id": "assemble",
      "name": "Assemble chemical reactor",
      "amount": 1,
      "inputs": [
        {
          "id": "basicPressureVessel",
          "item": "basicPressureVessel",
          "quantity": 1
        },
        {
          "id": "pumpAssembly",
          "item": "pumpAssembly",
          "quantity": 1
        },
        {
          "id": "valveAssembly",
          "item": "valveAssembly",
          "quantity": 1
        },
        {
          "id": "thermalChamber",
          "item": "thermalChamber",
          "quantity": 1
        },
        {
          "id": "powerController",
          "item": "powerController",
          "quantity": 1
        }
      ],
      "conditions": {
        "discoveries": [
          "waterChemistry",
          "polymerSynthesis"
        ]
      }
    }
  ],
  "installation": {
    "group": "chemicalSynthesisPlants",
    "capabilities": [{"type":"chemicalSynthesis"}]
  },
  "design": {
    "family": "chemicalSynthesis",
    "principles": [
      "waterChemistry",
      "polymerSynthesis"
    ]
  },
  "physicalProfile": {
    "form": "cylindrical",
    "surface": "machined",
    "exposedFeatures": [
      "pipework",
      "conductorRuns"
    ]
  }
},
    separationPlant: {
  "name": "Material Separation Plant",
  "description": "Install to concentrate rare-earth feed and separate magnetic material. Lower-power separation leaves more residue than the electromagnetic route.",
  "category": "product",
  "unitVolumeM3": 0.35,
  "recipes": [
    {
      "id": "assemble",
      "name": "Assemble material separation plant",
      "amount": 1,
      "inputs": [
        {
          "id": "basicPressureVessel",
          "item": "basicPressureVessel",
          "quantity": 1
        },
        {
          "id": "separationAssembly",
          "item": "separationAssembly",
          "quantity": 1
        },
        {
          "id": "pumpAssembly",
          "item": "pumpAssembly",
          "quantity": 1
        },
        {
          "id": "powerController",
          "item": "powerController",
          "quantity": 1
        }
      ],
      "conditions": {
        "discoveries": [
          "industrialSeparation"
        ]
      }
    }
  ],
  "installation": {
    "group": "materialConcentrationPlants",
    "capabilities": [{"type":"materialConcentration"},{"type":"materialSeparation"}]
  },
  "design": {
    "family": "materialConcentration",
    "principles": [
      "industrialSeparation"
    ]
  },
  "physicalProfile": {
    "form": "cylindrical",
    "surface": "machined",
    "exposedFeatures": [
      "pipework",
      "conductorRuns"
    ]
  }
},
    vacuumFurnace: {
  "name": "Vacuum Refining Furnace",
  "description": "Install to refine titanium-bearing feed and prepare bulk titanium alloy in powered batches.",
  "category": "product",
  "unitVolumeM3": 0.4,
  "recipes": [
    {
      "id": "assemble",
      "name": "Assemble vacuum refining furnace",
      "amount": 1,
      "inputs": [
        {
          "id": "thermalChamber",
          "item": "thermalChamber",
          "quantity": 2
        },
        {
          "id": "basicPressureVessel",
          "item": "basicPressureVessel",
          "quantity": 1
        },
        {
          "id": "pumpAssembly",
          "item": "pumpAssembly",
          "quantity": 1
        },
        {
          "id": "powerController",
          "item": "powerController",
          "quantity": 1
        }
      ],
      "conditions": {
        "discoveries": [
          "industrialTitanium"
        ]
      }
    }
  ],
  "installation": {
    "group": "vacuumRefiningPlants",
    "capabilities": [{"type":"vacuumRefining"}]
  },
  "design": {
    "family": "vacuumRefining",
    "principles": [
      "industrialTitanium"
    ]
  },
  "physicalProfile": {
    "form": "cylindrical",
    "surface": "machined",
    "exposedFeatures": [
      "pipework",
      "conductorRuns"
    ]
  }
},
    electromagneticSeparator: {
  "name": "Electromagnetic Separator",
  "description": "Install to recover more magnetic material from concentrate, using more power and a larger machine than basic separation.",
  "category": "product",
  "unitVolumeM3": 0.5,
  "recipes": [
    {
      "id": "assemble",
      "name": "Assemble electromagnetic separator",
      "amount": 1,
      "inputs": [
        {
          "id": "separationAssembly",
          "item": "separationAssembly",
          "quantity": 2
        },
        {
          "id": "magneticAlloyParts",
          "item": "magneticAlloyParts",
          "quantity": 2
        },
        {
          "id": "powerController",
          "item": "powerController",
          "quantity": 2
        }
      ],
      "conditions": {
        "discoveries": [
          "industrialSeparation"
        ]
      }
    }
  ],
  "installation": {
    "group": "electromagneticSeparationPlants",
    "capabilities": [{"type":"electromagneticSeparation"}]
  },
  "design": {
    "family": "electromagneticSeparation",
    "principles": [
      "industrialSeparation"
    ]
  },
  "physicalProfile": {
    "form": "boxy",
    "surface": "machined",
    "exposedFeatures": [
      "pipework",
      "conductorRuns"
    ]
  }
},
  
  "ironOre": {
  "name": "Iron Ore",
  "description": "Iron Ore is part of the industrial material vocabulary.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "mineral"
  }
},
  "copperOre": {
  "name": "Copper Ore",
  "description": "Copper Ore is part of the industrial material vocabulary.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "mineral"
  }
},
  "aluminumOre": {
  "name": "Aluminum Ore",
  "description": "Aluminum Ore is part of the industrial material vocabulary.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "mineral"
  }
},
  "nickelOre": {
  "name": "Nickel Ore",
  "description": "Nickel Ore is part of the industrial material vocabulary.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "mineral"
  }
},
  "lithiumOre": {
  "name": "Lithium Ore",
  "description": "Lithium Ore is part of the industrial material vocabulary. Production and industrial uses are not yet available.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "mineral"
  }
},
  "uraniumOre": {
  "name": "Uranium Ore",
  "description": "Uranium Ore is part of the industrial material vocabulary. Production and industrial uses are not yet available.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "mineral"
  }
},
  "silica": {
  "name": "Silica",
  "description": "Silica is part of the industrial material vocabulary.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "mineral"
  }
},
  "carbon": {
  "name": "Carbon",
  "description": "Carbon is part of the industrial material vocabulary.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "mineral"
  }
},
  "nitrogen": {
  "name": "Nitrogen",
  "description": "Nitrogen is part of the industrial material vocabulary. Production and industrial uses are not yet available.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "gas"
  }
},
  "sulfur": {
  "name": "Sulfur",
  "description": "Sulfur is part of the industrial material vocabulary. Production and industrial uses are not yet available.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "mineral"
  }
},
  "methane": {
  "name": "Methane",
  "description": "Methane is part of the industrial material vocabulary. Production and industrial uses are not yet available.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "gas"
  }
},
  "ammonia": {
  "name": "Ammonia",
  "description": "Ammonia is part of the industrial material vocabulary. Production and industrial uses are not yet available.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "gas"
  }
},
  "refinedIron": {
  "name": "Iron",
  "description": "Iron is part of the industrial material vocabulary.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "metal"
  },
  "recipeContributions": [
    {
      "id": "fittings",
      "name": "Fabricate Iron structural parts",
      "inputs": [
        {
          "id": "refinedIron",
          "item": "refinedIron",
          "quantity": 0.004
        }
      ],
      "conditions": {
        "discoveries": [
          "structuralFabrication"
        ]
      },
      "output": "iron",
      "amount": 1
    }
  ]
},
  "copper": {
  "name": "Copper",
  "description": "Copper is part of the industrial material vocabulary.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "metal"
  },
  "recipeContributions": [
    {
      "id": "conductors",
      "name": "Fabricate Conductive parts",
      "inputs": [
        {
          "id": "copper",
          "item": "copper",
          "quantity": 0.002
        },
        {
          "id": "polymerFeedstock",
          "item": "polymerFeedstock",
          "quantity": 0.001
        }
      ],
      "conditions": {
        "discoveries": [
          "electricalConduction",
          "waterChemistry"
        ]
      },
      "output": "conductiveParts",
      "amount": 2
    }
  ]
},
  "aluminum": {
  "name": "Aluminum",
  "description": "Aluminum is part of the industrial material vocabulary.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "metal"
  }
},
  "nickel": {
  "name": "Nickel",
  "description": "Nickel is part of the industrial material vocabulary.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "metal"
  }
},
  "tungsten": {
  "name": "Tungsten",
  "description": "Tungsten is part of the industrial material vocabulary.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "metal"
  },
  "recipeContributions": [
    {
      "id": "formedMembers",
      "name": "Fabricate Tungsten Alloy Stock",
      "inputs": [
        {
          "id": "tungsten",
          "item": "tungsten",
          "quantity": 0.004
        },
        {
          "id": "refinedIron",
          "item": "refinedIron",
          "quantity": 0.002
        }
      ],
      "conditions": {
        "discoveries": [
          "tungstenMetallurgy"
        ]
      },
      "output": "tungstenAlloyStock",
      "amount": 2
    }
  ]
},
  "lithium": {
  "name": "Lithium",
  "description": "Lithium is part of the industrial material vocabulary. Production and industrial uses are not yet available.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "metal"
  }
},
  "silicon": {
  "name": "Silicon",
  "description": "Silicon is part of the industrial material vocabulary.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "metal"
  },
  "recipeContributions": [
    {
      "id": "electronics",
      "name": "Fabricate Electronic parts",
      "inputs": [
        {
          "id": "silicon",
          "item": "silicon",
          "quantity": 0.001
        },
        {
          "id": "copper",
          "item": "copper",
          "quantity": 0.001
        },
        {
          "id": "polymerFeedstock",
          "item": "polymerFeedstock",
          "quantity": 0.001
        }
      ],
      "conditions": {
        "discoveries": [
          "circuitAssembly",
          "waterChemistry"
        ]
      },
      "output": "electronicParts",
      "amount": 2
    },
    {
      "id": "photovoltaics",
      "name": "Fabricate Solar cells",
      "inputs": [
        {
          "id": "silicon",
          "item": "silicon",
          "quantity": 0.003
        },
        {
          "id": "copper",
          "item": "copper",
          "quantity": 0.001
        },
        {
          "id": "glass",
          "item": "glass",
          "quantity": 0.002
        }
      ],
      "conditions": {
        "discoveries": [
          "photovoltaicFabrication"
        ]
      },
      "output": "solarCells",
      "amount": 2
    }
  ]
},
  "uranium": {
  "name": "Uranium",
  "description": "Uranium is part of the industrial material vocabulary. Production and industrial uses are not yet available.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "metal"
  }
},
  "aluminumAlloy": {
  "name": "Aluminum Alloy",
  "description": "Aluminum Alloy is part of the industrial material vocabulary.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "metal"
  },
  "recipeContributions": [
    {
      "id": "frames",
      "name": "Fabricate Structural Frame",
      "inputs": [
        {
          "id": "aluminumAlloy",
          "item": "aluminumAlloy",
          "quantity": 0.01
        }
      ],
      "conditions": {
        "discoveries": [
          "lightAlloyMetallurgy"
        ]
      },
      "output": "structuralFrame",
      "amount": 1
    }
  ]
},
  "nickelAlloy": {
  "name": "Nickel Alloy",
  "description": "Nickel Alloy is part of the industrial material vocabulary.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "metal"
  },
  "recipeContributions": [
    {
      "id": "chambers",
      "name": "Fabricate Thermal Chamber",
      "inputs": [
        {
          "id": "nickelAlloy",
          "item": "nickelAlloy",
          "quantity": 0.008
        },
        {
          "id": "conductiveParts",
          "item": "conductiveParts",
          "quantity": 2
        },
        {
          "id": "electronicParts",
          "item": "electronicParts",
          "quantity": 1
        }
      ],
      "conditions": {
        "discoveries": [
          "industrialTitanium"
        ]
      },
      "output": "thermalChamber",
      "amount": 1
    }
  ]
},
  "glass": {
  "name": "Glass",
  "description": "Glass is part of the industrial material vocabulary.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "ceramic"
  }
},
  "ceramic": {
  "name": "Ceramic",
  "description": "Ceramic is part of the industrial material vocabulary.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "ceramic"
  },
  "recipeContributions": [
    {
      "id": "internals",
      "name": "Fabricate High-Temperature Ceramic",
      "inputs": [
        {
          "id": "ceramic",
          "item": "ceramic",
          "quantity": 0.004
        }
      ],
      "conditions": {
        "discoveries": [
          "highTempCeramics"
        ]
      },
      "output": "highTempCeramic",
      "amount": 2
    }
  ]
},
  "composite": {
  "name": "Composite",
  "description": "Composite is part of the industrial material vocabulary.",
  "category": "resource",
  "researchSampleM3": 0.001,
  "materialProfile": {
    "character": "composite"
  },
  "recipeContributions": [
    {
      "id": "panels",
      "name": "Fabricate Carbon Composite Panel",
      "inputs": [
        {
          "id": "composite",
          "item": "composite",
          "quantity": 0.008
        }
      ],
      "conditions": {
        "discoveries": [
          "compositeFabrication"
        ]
      },
      "output": "carbonCompositePanel",
      "amount": 2
    }
  ]
},
  "autonomousControlAssembly": {
  "name": "Autonomous Control Assembly",
  "description": "Prepared subsystem for the reproducible Prospector design. Its bill preserves the corresponding module's parts.",
  "category": "component",
  "unitVolumeM3": 0.08,
  "engineeringFunctions": [
    "control"
  ],
  "recipes": [
    {
      "id": "fabricate",
      "name": "Fabricate Autonomous Control Assembly",
      "inputs": [
        {
          "id": "structuralFrame",
          "item": "structuralFrame",
          "quantity": 2
        },
        {
          "id": "controlBus",
          "item": "controlBus",
          "quantity": 2
        },
        {
          "id": "electronicParts",
          "item": "electronicParts",
          "quantity": 1
        }
      ],
      "conditions": {
        "discoveries": [
          "autonomousCoreDesign"
        ]
      },
      "amount": 1
    }
  ]
},
  "cargoStructure": {
  "name": "Cargo Structure",
  "description": "Prepared subsystem for the reproducible Prospector design. Its bill preserves the corresponding module's parts.",
  "category": "component",
  "unitVolumeM3": 0.08,
  "engineeringFunctions": [
    "loadSupport"
  ],
  "recipes": [
    {
      "id": "fabricate",
      "name": "Fabricate Cargo Structure",
      "inputs": [
        {
          "id": "structuralFrame",
          "item": "structuralFrame",
          "quantity": 3
        }
      ],
      "conditions": {
        "discoveries": [
          "modularStructures"
        ]
      },
      "amount": 1
    }
  ]
},
  "fuelHandlingAssembly": {
  "name": "Fuel Handling Assembly",
  "description": "Prepared subsystem for the reproducible Prospector design. Its bill preserves the corresponding module's parts.",
  "category": "component",
  "unitVolumeM3": 0.08,
  "engineeringFunctions": [
    "containment"
  ],
  "recipes": [
    {
      "id": "fabricate",
      "name": "Fabricate Fuel Handling Assembly",
      "inputs": [
        {
          "id": "structuralFrame",
          "item": "structuralFrame",
          "quantity": 2
        },
        {
          "id": "controlBus",
          "item": "controlBus",
          "quantity": 1
        }
      ],
      "conditions": {
        "discoveries": [
          "propellantHandling"
        ]
      },
      "amount": 1
    }
  ]
},
  "propulsionAssembly": {
  "name": "Propulsion Assembly",
  "description": "Prepared subsystem for the reproducible Prospector design. Its bill preserves the corresponding module's parts.",
  "category": "component",
  "unitVolumeM3": 0.08,
  "engineeringFunctions": [
    "controlledMotion"
  ],
  "recipes": [
    {
      "id": "fabricate",
      "name": "Fabricate Propulsion Assembly",
      "inputs": [
        {
          "id": "structuralFrame",
          "item": "structuralFrame",
          "quantity": 2
        },
        {
          "id": "controlBus",
          "item": "controlBus",
          "quantity": 1
        },
        {
          "id": "conductiveParts",
          "item": "conductiveParts",
          "quantity": 1
        }
      ],
      "conditions": {
        "discoveries": [
          "reactionPropulsion"
        ]
      },
      "amount": 1
    }
  ]
},
  "powerAssembly": {
  "name": "Power Assembly",
  "description": "Prepared subsystem for the reproducible Prospector design. Its bill preserves the corresponding module's parts.",
  "category": "component",
  "unitVolumeM3": 0.08,
  "engineeringFunctions": [
    "powerConditioning"
  ],
  "recipes": [
    {
      "id": "fabricate",
      "name": "Fabricate Power Assembly",
      "inputs": [
        {
          "id": "structuralFrame",
          "item": "structuralFrame",
          "quantity": 2
        },
        {
          "id": "controlBus",
          "item": "controlBus",
          "quantity": 1
        },
        {
          "id": "solarCells",
          "item": "solarCells",
          "quantity": 2
        }
      ],
      "conditions": {
        "discoveries": [
          "photovoltaicFabrication"
        ]
      },
      "amount": 1
    }
  ]
},
  "communicationsPackage": {
  "name": "Communications Package",
  "description": "Prepared subsystem for the reproducible Prospector design. Its bill preserves the corresponding module's parts.",
  "category": "component",
  "unitVolumeM3": 0.08,
  "engineeringFunctions": [
    "control"
  ],
  "recipes": [
    {
      "id": "fabricate",
      "name": "Fabricate Communications Package",
      "inputs": [
        {
          "id": "structuralFrame",
          "item": "structuralFrame",
          "quantity": 1
        },
        {
          "id": "controlBus",
          "item": "controlBus",
          "quantity": 1
        },
        {
          "id": "electronicParts",
          "item": "electronicParts",
          "quantity": 1
        }
      ],
      "conditions": {
        "discoveries": [
          "radioAssembly"
        ]
      },
      "amount": 1
    }
  ]
},
  "extractionAssembly": {
  "name": "Extraction Assembly",
  "description": "Prepared subsystem for the reproducible Prospector design. Its bill preserves the corresponding module's parts.",
  "category": "component",
  "unitVolumeM3": 0.08,
  "engineeringFunctions": [
    "controlledMotion"
  ],
  "recipes": [
    {
      "id": "fabricate",
      "name": "Fabricate Extraction Assembly",
      "inputs": [
        {
          "id": "structuralFrame",
          "item": "structuralFrame",
          "quantity": 2
        },
        {
          "id": "controlBus",
          "item": "controlBus",
          "quantity": 1
        },
        {
          "id": "conductiveParts",
          "item": "conductiveParts",
          "quantity": 1
        }
      ],
      "conditions": {
        "discoveries": [
          "modularExtraction"
        ]
      },
      "amount": 1
    }
  ]
},
  "integratedRareEarthRefinery": {
  "name": "Integrated Rare Earth Refinery",
  "description": "A compact concentrate refinery combining water electrolysis and hydrogen-assisted separation. Sequential batches take longer; oxygen and residue remain cargo outputs.",
  "category": "product",
  "unitVolumeM3": 0.45,
  "recipes": [
    {
      "id": "assemble",
      "name": "Assemble integrated rare earth refinery",
      "inputs": [
        {
          "id": "basicPressureVessel",
          "item": "basicPressureVessel",
          "quantity": 1
        },
        {
          "id": "pumpAssembly",
          "item": "pumpAssembly",
          "quantity": 2
        },
        {
          "id": "valveAssembly",
          "item": "valveAssembly",
          "quantity": 1
        },
        {
          "id": "electrodeSeparatorStack",
          "item": "electrodeSeparatorStack",
          "quantity": 1
        },
        {
          "id": "powerController",
          "item": "powerController",
          "quantity": 2
        },
        {
          "id": "separationAssembly",
          "item": "separationAssembly",
          "quantity": 1
        },
        {
          "id": "thermalChamber",
          "item": "thermalChamber",
          "quantity": 1
        },
        {
          "id": "steelAlloy",
          "item": "steelAlloy",
          "quantity": 0.02
        }
      ],
      "conditions": {
        "discoveries": [
          "integratedRefineryDesign",
          "waterChemistry",
          "industrialSeparation"
        ]
      },
      "amount": 1
    }
  ],
  "installation": {
    "group": "integratedRefineries",
    "capabilities": [{"type":"integratedSeparation"}]
  },
  "physicalProfile": {
    "form": "cylindrical",
    "surface": "machined",
    "exposedFeatures": [
      "pipework",
      "conductorRuns"
    ]
  },
  "design": {
    "family": "concentrateRefinery",
    "principles": [
      "integratedRefineryDesign"
    ],
    "derivedFrom": [
      {
        "kind": "item",
        "id": "electrolysisPlant"
      },
      {
        "kind": "item",
        "id": "chemicalReactor"
      }
    ]
  }
}
}
};

export const content = buildCatalog(definitions);
