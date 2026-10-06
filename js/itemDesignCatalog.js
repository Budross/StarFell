// Bounded descriptive vocabulary. None of these fields executes gameplay behavior.
import { validId, record } from './conditions.js';
export const PHYSICAL_PROFILE = Object.freeze({
  scale: Object.freeze(['tiny','small','humanScale','large','massive']),
  form: Object.freeze(['boxy','cylindrical','frameLike','panelLike','elongated','irregular']),
  surface: Object.freeze(['rough','machined','cast','polished','insulated']),
  exposedFeatures: Object.freeze(['pipework','radiatorFins','conductorRuns','panelArrays'])
});
export const ENGINEERING_FUNCTIONS = Object.freeze(['loadSupport','containment','fluidHandling','controlledMotion','electricalConnection','powerConditioning','thermalProcessing','chemicalSeparation','electrochemicalConversion','control','powerStorage','fabrication']);
export const MATERIAL_CHARACTERS = Object.freeze(['metal','mineral','polymer','ceramic','composite','water','gas','residue']);
function fields(value, allowed, path) {
  if (!record(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(path, 'unsupported fields');
}
function fail(path, text) { throw Object.assign(new Error(`Invalid design ${path}: ${text}.`), { path }); }
function list(value, max, predicate, path) {
  if (!Array.isArray(value) || value.length > max || new Set(value).size !== value.length || value.some(v => !predicate(v))) fail(path, 'invalid or unbounded vocabulary');
}
export function compileItemDesigns(items) {
  const projections = {};
  for (const [id,item] of Object.entries(items)) {
    const path = `items.${id}`;
    if (item.physicalProfile !== undefined) {
      fields(item.physicalProfile, Object.keys(PHYSICAL_PROFILE), `${path}.physicalProfile`);
      for (const [key,value] of Object.entries(item.physicalProfile)) {
        if (key === 'exposedFeatures') list(value, 4, v => PHYSICAL_PROFILE[key].includes(v), `${path}.physicalProfile.${key}`);
        else if (!PHYSICAL_PROFILE[key].includes(value)) fail(`${path}.physicalProfile.${key}`, 'unknown value');
      }
    }
    if (item.engineeringFunctions !== undefined) list(item.engineeringFunctions, 8, v => ENGINEERING_FUNCTIONS.includes(v), `${path}.engineeringFunctions`);
    if (item.materialProfile !== undefined) {
      fields(item.materialProfile, ['character'], `${path}.materialProfile`);
      if (item.category !== 'resource' || !MATERIAL_CHARACTERS.includes(item.materialProfile.character)) fail(`${path}.materialProfile`, 'requires Resource material character');
    }
    if (item.design !== undefined) {
      fields(item.design, ['family','principles','derivedFrom'], `${path}.design`);
      if (!validId(item.design.family)) fail(`${path}.design.family`, 'invalid family');
      list(item.design.principles ?? [], 8, validId, `${path}.design.principles`);
      list(item.design.derivedFrom ?? [], 8, v => typeof v==='string' ? validId(v)&&!!items[v] : record(v)&&Object.keys(v).length===2&&v.kind==='item'&&validId(v.id)&&!!items[v.id], `${path}.design.derivedFrom`);
    }
    projections[id] = { id, category:item.category, name:item.name,
      physical:structuredClone(item.physicalProfile ?? {}), functions:[...(item.engineeringFunctions ?? [])],
      material:structuredClone(item.materialProfile ?? null), design:structuredClone(item.design ?? null) };
  }
  const visited = new Set(), active = new Set();
  function visit(id) {
    if (active.has(id)) fail(`items.${id}.design.derivedFrom`, 'cyclic lineage');
    if (visited.has(id)) return;
    active.add(id); for (const parent of items[id].design?.derivedFrom ?? []) visit(typeof parent==='string'?parent:parent.id);
    active.delete(id); visited.add(id);
  }
  Object.keys(items).forEach(visit);
  return projections;
}
export function validateDesignPrinciples(content, research) {
  for (const item of Object.values(content.items)) for (const id of item.design?.principles ?? [])
    if (!research.discoveries[id] && !content.discoveryReferences.required.includes(id)) fail(`items.${item.id}.design.principles`, `unknown Research principle ${id}`);
}
export function describeItemDesign(content, id) {
  const value = content.designs?.[id];
  return value ? structuredClone(value) : null;
}
