const knows = (...discoveries) => ({ discoveries });
const inspected = object => ({ locationFlags: { habitat: [`examined:${object}`] } });
const technicalClue = { npcFlags: { mira: ["benchAdvice"] } };

export const researchDefinitions = {
  repetition: [100, 40, 10], bonusChance: 0.5, bonusPercent: 25,
  families: {
    materials: { name: "Materials" }, mechanics: { name: "Mechanics" }, energy: { name: "Energy" },
    computation: { name: "Computation" }, navigation: { name: "Navigation" }
  },
  affinities: [
    { tags: ["metal"], weights: { materials: 3, mechanics: 2 } },
    { tags: ["electrical"], weights: { energy: 3, computation: 1 } },
    { tags: ["electronic"], weights: { computation: 3, energy: 1 } },
    { tags: ["conductive"], weights: { energy: 3, materials: 1 } },
    { tags: ["silicon"], weights: { materials: 3, computation: 2 } },
    { tags: ["photovoltaic"], weights: { energy: 4, materials: 2 } },
    { tags: ["communications"], weights: { navigation: 3, computation: 2 } }
  ],
  methods: {
    bench: { name: "Bench experiment", minSamples: 1, maxSamples: 3, cost: {},
      conditions: { capabilities: ["benchAnalysis"] },
      blockedReason: "Requires an operational bench at this location. The Habitat 05 fabricator includes one." }
  },
  discoveries: {
    ...vesselDiscoveries,
    structuralFabrication: {
      name: "Structural fabrication", description: "Form salvaged metal into load-bearing parts for repairs and assemblies.",
      families: ["materials", "mechanics"], threshold: 8, legacyGrant: true,
      evidence: [
        { id: "metalTest", samples: { allTags: ["metal"] }, insight: 6,
          observation: "The metal holds its shape after forming. Repeated loading reveals where a support needs reinforcement." },
        { id: "fittingClue", samples: { allTags: ["metal"] }, conditions: inspected("fitting"), insight: 2, once: true,
          observation: "The damaged fitting provides a useful reference for a replacement support." }
      ]
    },
    electricalConduction: {
      name: "Electrical conduction", description: "Prepare dependable conductors from salvaged electrical material and metal.",
      families: ["energy", "materials"], threshold: 10, legacyGrant: true,
      evidence: [
        { id: "salvageTest", samples: { allTags: ["electrical"] }, insight: 6,
          observation: "Some paths through the salvage carry current more consistently than others." },
        { id: "metalContact", samples: { allTags: ["metal", "electrical"] }, insight: 4,
          observation: "A clean metal contact reduces the resistance in the recovered wiring." },
        { id: "advice", samples: { allTags: ["electrical"] }, conditions: technicalClue, insight: 4, once: true,
          observation: "Mira's advice helps distinguish a poor contact from a damaged conductor." }
      ]
    },
    circuitAssembly: {
      name: "Circuit assembly", description: "Fabricate reusable electronic circuitry for power and communications equipment.",
      families: ["computation", "energy"], eligibility: knows("electricalConduction"), threshold: 10, legacyGrant: true,
      evidence: [
        { id: "circuitTest", samples: { allTags: ["electrical"] }, insight: 6,
          observation: "You trace a repeatable switching pattern through the salvaged circuit.",
          variants: [
            { id: "basic", priority: 0 },
            { id: "preparedContacts", priority: 10, samples: { allTags: ["electrical", "conductive"] }, insight: 10,
              observation: "Prepared conductors isolate the connections needed to reproduce a working circuit." }
          ] },
        { id: "grounding", samples: { allTags: ["metal", "electrical"] }, insight: 4,
          observation: "A stable metal reference separates the circuit's signal from electrical noise." },
        { id: "advice", samples: { allTags: ["electrical"] }, conditions: technicalClue, insight: 4, once: true,
          observation: "Mira's contact-checking procedure makes the circuit's layout easier to follow." }
      ]
    },
    semiconductorBehavior: {
      name: "Semiconductor behavior", description: "Recognize and investigate the electrical behavior of silicon-bearing material.",
      families: ["materials", "computation"], threshold: 8, legacyGrant: true,
      evidence: [
        { id: "mineralTest", samples: { allTags: ["silicon"] }, insight: 6,
          observation: "The mineral's response varies with the contact and illumination; it is neither a simple conductor nor an insulator." },
        { id: "electricalProbe", samples: { allTags: ["silicon", "electrical"] }, insight: 2,
          observation: "Recovered electrical contacts make the mineral's directional response clearer." }
      ]
    },
    photovoltaicFabrication: {
      name: "Photovoltaic fabrication", description: "Process silicon into photovoltaic cells and assemble additional solar panels.",
      families: ["energy", "materials"], threshold: 10, legacyGrant: true,
      eligibility: { any: [inspected("solarHardware"), knows("semiconductorBehavior"), technicalClue] },
      evidence: [
        { id: "rawContact", samples: { allTags: ["silicon", "electrical"] }, insight: 4,
          observation: "An illuminated mineral sample produces a small but repeatable electrical response." },
        { id: "controlledContact", samples: { allTags: ["silicon", "electronic"] }, insight: 6,
          observation: "Prepared circuitry measures the sample's response well enough to guide cell fabrication." },
        { id: "hardwareClue", samples: { allTags: ["silicon"] }, conditions: inspected("solarHardware"), insight: 2, once: true,
          observation: "The damaged cell's layered structure explains how to collect the sample's output." },
        { id: "advice", samples: { allTags: ["silicon"] }, conditions: technicalClue, insight: 4, once: true,
          observation: "Mira's description of the collector contacts suggests a practical way to connect the silicon layers." }
      ]
    },
    radioAssembly: {
      name: "Radio assembly", description: "Build a radio antenna that can scan local frequencies when installed.",
      families: ["navigation", "computation"], eligibility: knows("circuitAssembly"), threshold: 10, legacyGrant: true,
      evidence: [
        { id: "signalTest", samples: { allTags: ["electronic"] }, insight: 6,
          observation: "The prepared circuit can separate a repeating signal from background interference." },
        { id: "aerialTest", samples: { allTags: ["metal", "electrical"] }, insight: 4,
          observation: "A metal element coupled to recovered wiring responds to nearby electrical signals." },
        { id: "couplingTest", samples: { allTags: ["electronic", "conductive"] }, insight: 4,
          observation: "Prepared conductors couple the receiving element to the signal circuit with less interference." }
      ]
    }
  },
  hints: [
    ...vesselResearchHints,
    { conditions: { not: knows("structuralFabrication") }, text: "Inspect the damaged structural fitting in Operations, then experiment with metal scrap. Basic bench experiments need no power." },
    { conditions: { not: knows("electricalConduction") }, text: "Try metal scrap with electronic salvage. Combining a conductor and a contact can reveal more than either alone." },
    { conditions: { not: knows("circuitAssembly") }, text: "Revisit metal scrap with electronic salvage using your electrical knowledge, or try salvage with prepared conductive parts. Mira may have useful advice." },
    { conditions: { not: knows("semiconductorBehavior") }, text: "Try silicon-bearing minerals with electronic salvage, or examine a mineral sample more than once." },
    { conditions: { not: knows("photovoltaicFabrication") }, text: "Inspect damaged solar hardware. Compare silicon with electronic salvage and with fabricated electronic parts." },
    { conditions: { not: knows("radioAssembly") }, text: "Try electronic parts with conductive parts, or compare circuits with a scrap-and-salvage receiving element." }
  ]
};
import { vesselDiscoveries, vesselResearchHints } from '../vesselContent.js';
