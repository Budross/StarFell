// Add an NPC here; location rosters and the People panel are derived automatically.
export const npcDefinitions = {
  mira: {
    name: "Mira", subtitle: "Relay engineer", order: 10,
    description: "An engineer in a patched maintenance suit. Her attention keeps returning to the habitat's power readouts.",
    narrative:{tone:'practical',greeting:'Hello.',observationInterests:['equipment_condition','industrial_activity','power']},
    initialLocationId: "habitat", initialInventory: { scrap: 0.04 }, inventoryCapacities: { scrap: 0.2 },
    initialFlags: {}, interactions: ["inspect", "talk"], dialogueGroups: ["habitatCrew", "miraPersonal"]
  },
  oren: {
    name: "Oren", subtitle: "Maintenance coordinator", order: 20,
    description: "Oren studies an old shift ledger, carefully marking which of the habitat's routines still work.",
    narrative:{tone:'measured',greeting:'Hello.',observationInterests:['industrial_activity','resource_nodes','local_ship_presence']},
    initialLocationId: "habitat", initialInventory: {}, inventoryCapacities: {}, initialFlags: {},
    interactions: ["inspect", "talk"], dialogueGroups: ["habitatCrew", "orenPersonal"]
  }
};
