// Bulk authored amounts are m³; component amounts are whole counts.
export const processingDefinitions = [
{ id: 'surfaceMineralExtraction', name: 'Extract surface minerals', kind: 'extraction', capability: 'surfaceExtraction',
    sourceRequirements: { tags: ['solid','surface'] }, batchM3: 0.01, duration: 20, powerRate: 0.08, startConditions: {} },
{ id: 'processSolarCells', name: 'Process photovoltaic cells', kind: 'refining', capability: 'thermalRefining',
    inputs: [{ itemId: 'siliconMinerals', amount: 0.04 }, { itemId: 'electronicParts', amount: 1 }],
    outputs: [{ itemId: 'solarCells', amount: 2 }], duration: 30, powerRate: 0.15,
    startConditions: { discoveries: ['photovoltaicFabrication'] } },
{ id: 'prospectResource', name: 'Prospect raw material', kind: 'extraction', capability: 'surfaceExtraction', sourceRequirements: { tags: ['solid', 'prospectable'] },
    batchM3: 0.01, duration: 20, powerRate: 0.08, hostKinds: ['site', 'ship'], startConditions: {} },
{
  "id": "prepareWater",
  "name": "Prepare water from ice",
  "kind": "refining",
  "operation": "refining",
  "capability": "thermalRefining",
  "inputs": [
    {
      "itemId": "waterIce",
      "amount": 0.02
    }
  ],
  "outputs": [
    {
      "itemId": "water",
      "amount": 0.018
    }
  ],
  "duration": 15,
  "powerRate": 0.08,
  "startConditions": {
    "discoveries": [
      "waterChemistry"
    ]
  }
},
{
  "id": "electrolyzeWater",
  "name": "Electrolyze prepared water",
  "kind": "refining",
  "operation": "refining",
  "capability": "electrolysis",
  "inputs": [
    {
      "itemId": "water",
      "amount": 0.018
    }
  ],
  "outputs": [
    {
      "itemId": "hydrogen",
      "amount": 0.002
    },
    {
      "itemId": "oxygen",
      "amount": 0.016
    }
  ],
  "duration": 30,
  "powerRate": 0.2,
  "startConditions": {
    "discoveries": [
      "waterChemistry"
    ]
  },
  "revision": 1
},
{
  "id": "synthesizePolymer",
  "name": "Synthesize polymer feedstock",
  "kind": "refining",
  "operation": "refining",
  "capability": "chemicalSynthesis",
  "inputs": [
    {
      "itemId": "carbonaceousRock",
      "amount": 0.01
    },
    {
      "itemId": "hydrogen",
      "amount": 0.002
    }
  ],
  "outputs": [
    {
      "itemId": "polymerFeedstock",
      "amount": 0.008
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.002
    }
  ],
  "duration": 25,
  "powerRate": 0.12,
  "startConditions": {
    "discoveries": [
      "polymerSynthesis",
      "waterChemistry"
    ]
  }
},
{
  "id": "recoverSteel",
  "name": "Recover steel with oxygen",
  "kind": "refining",
  "operation": "refining",
  "capability": "thermalRefining",
  "inputs": [
    {
      "itemId": "scrap",
      "amount": 0.02
    },
    {
      "itemId": "oxygen",
      "amount": 0.004
    }
  ],
  "outputs": [
    {
      "itemId": "steelAlloy",
      "amount": 0.012
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.008
    }
  ],
  "duration": 20,
  "powerRate": 0.12,
  "startConditions": {
    "discoveries": [
      "structuralFabrication",
      "waterChemistry"
    ]
  }
},
{
  "id": "refineTitanium",
  "name": "Refine titanium-bearing feed",
  "kind": "refining",
  "operation": "refining",
  "capability": "vacuumRefining",
  "inputs": [
    {
      "itemId": "titaniumOre",
      "amount": 0.04
    }
  ],
  "outputs": [
    {
      "itemId": "titanium",
      "amount": 0.012
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.02
    }
  ],
  "duration": 40,
  "powerRate": 0.2,
  "startConditions": {
    "discoveries": [
      "industrialTitanium"
    ]
  }
},
{
  "id": "alloyTitanium",
  "name": "Prepare titanium engineering alloy",
  "kind": "refining",
  "operation": "refining",
  "capability": "vacuumRefining",
  "inputs": [
    {
      "itemId": "titanium",
      "amount": 0.01
    }
  ],
  "outputs": [
    {
      "itemId": "titaniumAlloy",
      "amount": 0.01
    }
  ],
  "duration": 20,
  "powerRate": 0.15,
  "startConditions": {
    "discoveries": [
      "industrialTitanium"
    ]
  }
},
{
  "id": "concentrateRareEarth",
  "name": "Concentrate rare-earth feed",
  "kind": "refining",
  "operation": "refining",
  "capability": "materialConcentration",
  "inputs": [
    {
      "itemId": "rareEarthMinerals",
      "amount": 0.02
    }
  ],
  "outputs": [
    {
      "itemId": "rareEarthConcentrate",
      "amount": 0.008
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.012
    }
  ],
  "duration": 20,
  "powerRate": 0.1,
  "startConditions": {
    "discoveries": [
      "industrialSeparation"
    ]
  }
},
{
  "id": "separateMagneticMaterial",
  "name": "Separate magnetic material",
  "kind": "refining",
  "operation": "refining",
  "capability": "materialSeparation",
  "inputs": [
    {
      "itemId": "rareEarthConcentrate",
      "amount": 0.008
    }
  ],
  "outputs": [
    {
      "itemId": "magneticRareEarthMaterial",
      "amount": 0.002
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.006
    }
  ],
  "duration": 30,
  "powerRate": 0.12,
  "startConditions": {
    "discoveries": [
      "industrialSeparation"
    ]
  }
},
{
  "id": "electromagneticRecovery",
  "name": "High-power magnetic-material recovery",
  "kind": "refining",
  "operation": "refining",
  "capability": "electromagneticSeparation",
  "inputs": [
    {
      "itemId": "rareEarthConcentrate",
      "amount": 0.008
    }
  ],
  "outputs": [
    {
      "itemId": "magneticRareEarthMaterial",
      "amount": 0.004
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.004
    }
  ],
  "duration": 25,
  "powerRate": 0.4,
  "startConditions": {
    "discoveries": [
      "industrialSeparation"
    ]
  }
},
{
  "id": "sortScrap",
  "name": "Recover iron from scrap",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "thermalRefining",
  "duration": 20,
  "powerRate": 0.12,
  "inputs": [
    {
      "itemId": "scrap",
      "amount": 0.02
    }
  ],
  "outputs": [
    {
      "itemId": "refinedIron",
      "amount": 0.012
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.008
    }
  ],
  "startConditions": {
    "discoveries": [
      "structuralFabrication"
    ]
  }
},
{
  "id": "refineIron",
  "name": "Refine iron",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "thermalRefining",
  "duration": 20,
  "powerRate": 0.12,
  "inputs": [
    {
      "itemId": "ironOre",
      "amount": 0.02
    }
  ],
  "outputs": [
    {
      "itemId": "refinedIron",
      "amount": 0.012
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.008
    }
  ],
  "startConditions": {
    "discoveries": [
      "structuralFabrication"
    ]
  }
},
{
  "id": "recoverCopper",
  "name": "Recover copper from electronic scrap",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "thermalRefining",
  "duration": 20,
  "powerRate": 0.12,
  "inputs": [
    {
      "itemId": "electronicSalvage",
      "amount": 0.02
    }
  ],
  "outputs": [
    {
      "itemId": "copper",
      "amount": 0.006
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.014
    }
  ],
  "startConditions": {
    "discoveries": [
      "electricalConduction"
    ]
  }
},
{
  "id": "refineCopper",
  "name": "Refine copper",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "thermalRefining",
  "duration": 20,
  "powerRate": 0.12,
  "inputs": [
    {
      "itemId": "copperOre",
      "amount": 0.02
    }
  ],
  "outputs": [
    {
      "itemId": "copper",
      "amount": 0.012
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.008
    }
  ],
  "startConditions": {
    "discoveries": [
      "electricalConduction"
    ]
  }
},
{
  "id": "prepareSilica",
  "name": "Separate silica",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "thermalRefining",
  "duration": 20,
  "powerRate": 0.12,
  "inputs": [
    {
      "itemId": "siliconMinerals",
      "amount": 0.02
    }
  ],
  "outputs": [
    {
      "itemId": "silica",
      "amount": 0.015
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.005
    }
  ],
  "startConditions": {
    "discoveries": [
      "semiconductorBehavior"
    ]
  }
},
{
  "id": "prepareCarbon",
  "name": "Separate carbon",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "thermalRefining",
  "duration": 20,
  "powerRate": 0.12,
  "inputs": [
    {
      "itemId": "carbonaceousRock",
      "amount": 0.02
    }
  ],
  "outputs": [
    {
      "itemId": "carbon",
      "amount": 0.012
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.008
    }
  ],
  "startConditions": {
    "discoveries": [
      "polymerSynthesis"
    ]
  }
},
{
  "id": "refineSilicon",
  "name": "Refine silicon",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "thermalRefining",
  "duration": 20,
  "powerRate": 0.12,
  "inputs": [
    {
      "itemId": "silica",
      "amount": 0.01
    },
    {
      "itemId": "carbon",
      "amount": 0.002
    }
  ],
  "outputs": [
    {
      "itemId": "silicon",
      "amount": 0.006
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.006
    }
  ],
  "startConditions": {
    "discoveries": [
      "semiconductorBehavior"
    ]
  }
},
{
  "id": "makeGlass",
  "name": "Make glass",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "thermalRefining",
  "duration": 20,
  "powerRate": 0.12,
  "inputs": [
    {
      "itemId": "silica",
      "amount": 0.01
    }
  ],
  "outputs": [
    {
      "itemId": "glass",
      "amount": 0.009
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.001
    }
  ],
  "startConditions": {
    "discoveries": [
      "semiconductorBehavior"
    ]
  }
},
{
  "id": "makeCeramic",
  "name": "Make ceramic",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "thermalRefining",
  "duration": 20,
  "powerRate": 0.12,
  "inputs": [
    {
      "itemId": "silica",
      "amount": 0.01
    },
    {
      "itemId": "carbon",
      "amount": 0.002
    }
  ],
  "outputs": [
    {
      "itemId": "ceramic",
      "amount": 0.01
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.002
    }
  ],
  "startConditions": {
    "discoveries": [
      "highTempCeramics"
    ]
  }
},
{
  "id": "makeComposite",
  "name": "Make composite",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "chemicalSynthesis",
  "duration": 20,
  "powerRate": 0.12,
  "inputs": [
    {
      "itemId": "carbon",
      "amount": 0.008
    },
    {
      "itemId": "polymerFeedstock",
      "amount": 0.004
    }
  ],
  "outputs": [
    {
      "itemId": "composite",
      "amount": 0.01
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.002
    }
  ],
  "startConditions": {
    "discoveries": [
      "compositeFabrication",
      "waterChemistry"
    ]
  }
},
{
  "id": "alloySteel",
  "name": "Alloy steel",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "thermalRefining",
  "duration": 20,
  "powerRate": 0.12,
  "inputs": [
    {
      "itemId": "refinedIron",
      "amount": 0.01
    },
    {
      "itemId": "carbon",
      "amount": 0.002
    }
  ],
  "outputs": [
    {
      "itemId": "steelAlloy",
      "amount": 0.01
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.002
    }
  ],
  "startConditions": {
    "discoveries": [
      "structuralFabrication"
    ]
  }
},
{
  "id": "refineAluminum",
  "name": "Refine aluminum",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "vacuumRefining",
  "duration": 20,
  "powerRate": 0.12,
  "inputs": [
    {
      "itemId": "aluminumOre",
      "amount": 0.02
    }
  ],
  "outputs": [
    {
      "itemId": "aluminum",
      "amount": 0.012
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.008
    }
  ],
  "startConditions": {
    "discoveries": [
      "industrialTitanium"
    ]
  }
},
{
  "id": "alloyAluminum",
  "name": "Alloy aluminum",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "vacuumRefining",
  "duration": 20,
  "powerRate": 0.12,
  "inputs": [
    {
      "itemId": "aluminum",
      "amount": 0.01
    },
    {
      "itemId": "copper",
      "amount": 0.001
    }
  ],
  "outputs": [
    {
      "itemId": "aluminumAlloy",
      "amount": 0.011
    }
  ],
  "startConditions": {
    "discoveries": [
      "industrialTitanium"
    ]
  }
},
{
  "id": "refineNickel",
  "name": "Refine nickel",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "vacuumRefining",
  "duration": 20,
  "powerRate": 0.12,
  "inputs": [
    {
      "itemId": "nickelOre",
      "amount": 0.02
    }
  ],
  "outputs": [
    {
      "itemId": "nickel",
      "amount": 0.012
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.008
    }
  ],
  "startConditions": {
    "discoveries": [
      "industrialTitanium"
    ]
  }
},
{
  "id": "alloyNickel",
  "name": "Alloy nickel",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "vacuumRefining",
  "duration": 20,
  "powerRate": 0.12,
  "inputs": [
    {
      "itemId": "nickel",
      "amount": 0.008
    },
    {
      "itemId": "refinedIron",
      "amount": 0.002
    }
  ],
  "outputs": [
    {
      "itemId": "nickelAlloy",
      "amount": 0.01
    }
  ],
  "startConditions": {
    "discoveries": [
      "industrialTitanium"
    ]
  }
},
{
  "id": "refineTungsten",
  "name": "Refine tungsten",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "vacuumRefining",
  "duration": 40,
  "powerRate": 0.25,
  "inputs": [
    {
      "itemId": "tungstenOre",
      "amount": 0.03
    },
    {
      "itemId": "carbon",
      "amount": 0.002
    }
  ],
  "outputs": [
    {
      "itemId": "tungsten",
      "amount": 0.008
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.024
    }
  ],
  "startConditions": {
    "discoveries": [
      "industrialTitanium",
      "tungstenMetallurgy"
    ]
  }
},
{
  "id": "hydrogenSeparation",
  "name": "Separate magnetic material with hydrogen",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "chemicalSynthesis",
  "duration": 30,
  "powerRate": 0.14,
  "inputs": [
    {
      "itemId": "rareEarthConcentrate",
      "amount": 0.008
    },
    {
      "itemId": "hydrogen",
      "amount": 0.002
    }
  ],
  "outputs": [
    {
      "itemId": "magneticRareEarthMaterial",
      "amount": 0.003
    },
    {
      "itemId": "mineralResidue",
      "amount": 0.005
    }
  ],
  "startConditions": {
    "discoveries": [
      "industrialSeparation",
      "waterChemistry"
    ]
  }
},
{
  "id": "integratedRareEarthSeparation",
  "name": "Integrated concentrate refining",
  "revision": 1,
  "kind": "refining",
  "operation": "refining",
  "capability": "integratedSeparation",
  "startConditions": {
    "discoveries": [
      "waterChemistry",
      "industrialSeparation",
      "integratedRefineryDesign"
    ]
  },
  "composition": {
    "sources": [
      {
        "id": "electrolyzeWater",
        "revision": 1,
        "batches": 1,
        "contract": "[1,\"refining\",\"refining\",\"electrolysis\",[{\"itemId\":\"water\",\"amount\":0.018}],[{\"itemId\":\"hydrogen\",\"amount\":0.002},{\"itemId\":\"oxygen\",\"amount\":0.016}],30,0.2,{\"discoveries\":[\"waterChemistry\"]},[\"site\",\"ship\"]]"
      },
      {
        "id": "hydrogenSeparation",
        "revision": 1,
        "batches": 1,
        "contract": "[1,\"refining\",\"refining\",\"chemicalSynthesis\",[{\"itemId\":\"rareEarthConcentrate\",\"amount\":0.008},{\"itemId\":\"hydrogen\",\"amount\":0.002}],[{\"itemId\":\"magneticRareEarthMaterial\",\"amount\":0.003},{\"itemId\":\"mineralResidue\",\"amount\":0.005}],30,0.14,{\"discoveries\":[\"industrialSeparation\",\"waterChemistry\"]},[\"site\",\"ship\"]]"
      }
    ],
    "internalItems": [
      "hydrogen"
    ],
    "durationMultiplier": 1.25
  }
}
];
