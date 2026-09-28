export const observationTopics = Object.freeze(['equipment_condition','industrial_activity','power','storage','resource_nodes','local_ship_presence','local_people','research','vessel_geometry','vessel_composition','module_geometry']);
export const narrativeTones = Object.freeze(['neutral','practical','measured']);
const dimensions = Object.freeze({ origin:['industrial','civilian','corporate','makeshift','military'],environment:['dusty','cold','vacuum','pressurized'],scale:['compact','spacious'] });
export function validateNarrativeMetadata(meta,owner) {
  if (meta === undefined) return;
  const allowed = owner === 'npc' ? ['tone','greeting','observationInterests'] : ['base','observableTopics','dimensions'];
  if (!meta || typeof meta !== 'object' || Array.isArray(meta) || Object.keys(meta).some(k => !allowed.includes(k))) throw new Error('Invalid '+owner+' narrative metadata.');
  const list = owner === 'npc' ? meta.observationInterests : meta.observableTopics;
  if (list !== undefined && (!Array.isArray(list) || new Set(list).size !== list.length || list.some(t => !observationTopics.includes(t)))) throw new Error('Unknown narrative observation topic.');
  if (meta.tone !== undefined && !narrativeTones.includes(meta.tone)) throw new Error('Unknown narrative tone.');
  for (const key of ['base','greeting']) if (meta[key] !== undefined && (typeof meta[key] !== 'string' || !meta[key].trim())) throw new Error('Invalid narrative '+key+'.');
  if (meta.dimensions !== undefined) {
    if (!meta.dimensions || typeof meta.dimensions !== 'object' || Array.isArray(meta.dimensions)) throw new Error('Invalid narrative dimensions.');
    for (const [key,values] of Object.entries(meta.dimensions)) if (!dimensions[key] || !Array.isArray(values) || !values.length || values.some(v => !dimensions[key].includes(v)) || new Set(values).size !== values.length || key !== 'environment' && values.length !== 1 || values.includes('vacuum') && values.includes('pressurized')) throw new Error('Incompatible narrative dimension: '+key);
  }
}
export function mergeNarrativeMetadata(parent,child) {
  if (!parent && !child) return undefined;
  const merged={...parent,...child,dimensions:{...parent?.dimensions,...child?.dimensions}};
  for (const key of Object.keys(merged.dimensions)) merged.dimensions[key]=[...merged.dimensions[key]].sort();
  return merged;
}
