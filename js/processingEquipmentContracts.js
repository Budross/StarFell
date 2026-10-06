// Processing owns the meaning of these machine services; work remains in Processing.
export const processingEquipmentContracts = [
  ['surfaceExtraction', 'Surface Extraction', 'Supports compatible finite surface-resource extraction.'],
  ['thermalRefining', 'Thermal Refining', 'Supports compatible thermal-processing batches.'],
  ['electrolysis', 'Electrolysis', 'Supports compatible electrolysis batches.'],
  ['chemicalSynthesis', 'Chemical Synthesis', 'Supports compatible chemical-synthesis batches.'],
  ['materialConcentration', 'Material Concentration', 'Supports compatible material-concentration batches.'],
  ['materialSeparation', 'Material Separation', 'Supports compatible material-separation batches.'],
  ['vacuumRefining', 'Vacuum Refining', 'Supports compatible vacuum-refining batches.'],
  ['electromagneticSeparation', 'Electromagnetic Separation', 'Supports compatible electromagnetic-separation batches.'],
  ['integratedSeparation', 'Integrated Separation', 'Supports compatible integrated separation batches.']
].map(([type, label, summary]) => ({ type, label, summary, owner: 'processing', consumers: ['processing'] }));
