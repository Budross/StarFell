// Bulk authored amounts are m³; component amounts are whole counts.
export const processingDefinitions = [
  { id: 'surfaceMineralExtraction', name: 'Extract surface minerals', kind: 'extraction', capability: 'surfaceExtraction',
    sourceRequirements: { tags: ['solid','surface'] }, batchM3: 0.01, duration: 20, powerRate: 0.08, startConditions: {} },
  { id: 'processSolarCells', name: 'Process photovoltaic cells', kind: 'refining', capability: 'thermalRefining',
    inputs: [{ itemId: 'siliconMinerals', amount: 0.04 }, { itemId: 'electronicParts', amount: 1 }],
    outputs: [{ itemId: 'solarCells', amount: 2 }], duration: 30, powerRate: 0.15,
    startConditions: { discoveries: ['photovoltaicFabrication'] } },
  { id: 'prospectResource', name: 'Prospect raw material', kind: 'extraction', capability: 'surfaceExtraction', sourceRequirements: { tags: ['solid', 'prospectable'] },
    batchM3: 0.01, duration: 20, powerRate: 0.08, hostKinds: ['site', 'ship'], startConditions: {} }
];
