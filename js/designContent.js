// Authored deterministic designs; never inventory vessel Products.
export const designDefinitions = {
  "studies": {
    "fluidIntegration": {
      "name": "Study operated electrolysis plant",
      "revision": 1,
      "kind": "installedEquipment",
      "family": "concentrateRefinery",
      "itemId": "electrolysisPlant",
      "processId": "electrolyzeWater",
      "discoveryId": "fluidIntegration",
      "principles": [
        "waterChemistry"
      ]
    },
    "controlledSeparation": {
      "name": "Study hydrogen-assisted separation",
      "revision": 1,
      "kind": "installedEquipment",
      "family": "concentrateRefinery",
      "itemId": "chemicalReactor",
      "processId": "hydrogenSeparation",
      "discoveryId": "controlledSeparation",
      "principles": [
        "industrialSeparation",
        "waterChemistry"
      ]
    },
    "integratedRefinery": {
      "name": "Synthesize integrated refinery design",
      "revision": 1,
      "kind": "installedEquipment",
      "family": "concentrateRefinery",
      "itemId": "chemicalReactor",
      "processId": "hydrogenSeparation",
      "discoveryId": "integratedRefineryDesign",
      "principles": [
        "fluidIntegration",
        "controlledSeparation"
      ]
    },
    "prospector": {
      "name": "Study returned prospector",
      "revision": 1,
      "kind": "vessel",
      "family": "prospectorVessel",
      "discoveryId": "prospectorVesselDesign",
      "principles": [
        "modularStructures",
        "autonomousCoreDesign",
        "reactionPropulsion",
        "propellantHandling",
        "photovoltaicFabrication",
        "radioAssembly",
        "modularExtraction"
      ]
    }
  },
  "vessels": {
    "prospector": {
      "name": "Prospector",
      "family": "prospectorVessel",
      "revision": 1,
      "discoveryId": "prospectorVesselDesign",
      "principles": [
        "modularStructures",
        "autonomousCoreDesign",
        "reactionPropulsion",
        "propellantHandling",
        "photovoltaicFabrication",
        "radioAssembly",
        "modularExtraction"
      ],
      "assembly": {
        "core": {
          "key": "core",
          "moduleId": "basicAutonomousCore",
          "x": 0,
          "y": 0
        },
        "attachments": [
          {
            "key": "cargo",
            "moduleId": "smallCargoModule",
            "x": -2,
            "y": 0
          },
          {
            "key": "tank",
            "moduleId": "smallFuelTank",
            "x": 2,
            "y": 0
          },
          {
            "key": "drive",
            "moduleId": "basicReactionThruster",
            "x": 3,
            "y": 0
          },
          {
            "key": "power",
            "moduleId": "basicPowerModule",
            "x": 1,
            "y": 0
          },
          {
            "key": "radio",
            "moduleId": "basicRadioModule",
            "x": 0,
            "y": -1
          },
          {
            "key": "extractor",
            "moduleId": "basicExtractionModule",
            "x": 0,
            "y": 1
          }
        ]
      },
      "bill": [
        {
          "itemId": "structuralFrame",
          "amount": 7
        },
        {
          "itemId": "autonomousControlAssembly",
          "amount": 1
        },
        {
          "itemId": "cargoStructure",
          "amount": 1
        },
        {
          "itemId": "fuelHandlingAssembly",
          "amount": 1
        },
        {
          "itemId": "propulsionAssembly",
          "amount": 1
        },
        {
          "itemId": "powerAssembly",
          "amount": 1
        },
        {
          "itemId": "communicationsPackage",
          "amount": 1
        },
        {
          "itemId": "extractionAssembly",
          "amount": 1
        }
      ],
      "derivedFrom": [
        {
          "kind": "item",
          "id": "basicAutonomousCore"
        },
        {
          "kind": "item",
          "id": "smallCargoModule"
        },
        {
          "kind": "item",
          "id": "smallFuelTank"
        },
        {
          "kind": "item",
          "id": "basicReactionThruster"
        },
        {
          "kind": "item",
          "id": "basicPowerModule"
        },
        {
          "kind": "item",
          "id": "basicRadioModule"
        },
        {
          "kind": "item",
          "id": "basicExtractionModule"
        }
      ],
      "tradeoff": "Fixed seven-module layout and full upfront subsystem bill. Same capabilities and material cost as fitting the equivalent modules; no starting fuel or power."
    }
  }
};
