import { deriveVessel } from './vessels.js';
import { validId, record } from './conditions.js';
import { compileQuantity } from './quantities.js';

export function compileVesselDesigns(source,content,research){
  const result={};
  for(const [id,raw]of Object.entries(source)){
    const fail=message=>{throw new Error(`Invalid vessel design ${id}: ${message}.`);};
    if(!validId(id)||!record(raw)||Object.keys(raw).some(k=>!['name','revision','family','discoveryId','principles','assembly','bill','derivedFrom','tradeoff'].includes(k))||
      !Number.isSafeInteger(raw.revision)||raw.revision<1||typeof raw.name!=='string'||!raw.name.trim()||raw.family!=='prospectorVessel'||typeof raw.tradeoff!=='string'||!raw.tradeoff.trim())fail('identity/family/tradeoff');
    if(!research.discoveries[raw.discoveryId]?.studyOnly||!Array.isArray(raw.principles)||raw.principles.length>16||raw.principles.some(p=>!research.discoveries[p]))fail('understanding');
    const vessel=deriveVessel(raw.assembly,content);
    if(vessel.core.boardable||vessel.warnings.length)fail('prospector must provide autonomous control, cargo, fuel, propulsion, radio, extraction and generation');
    for(const moduleId of Object.keys(vessel.counts))if(!raw.principles.includes(content.vesselModules[moduleId].designDiscoveryId))fail('missing module principle');
    if(!Array.isArray(raw.derivedFrom)||!raw.derivedFrom.length||raw.derivedFrom.length>16||raw.derivedFrom.some(r=>!record(r)||Object.keys(r).some(k=>!['kind','id'].includes(k))||r.kind!=='item'||!vessel.counts[r.id]))fail('typed source lineage');
    if(!Array.isArray(raw.bill)||raw.bill.length<1||raw.bill.length>8||new Set(raw.bill.map(l=>l.itemId)).size!==raw.bill.length)fail('bounded bill');
    const cost={power:2};for(const line of raw.bill){if(!record(line)||Object.keys(line).some(k=>!['itemId','amount'].includes(k))||!['resource','component'].includes(content.items[line.itemId]?.category))fail('only Resources and Components may be consumed');cost[line.itemId]=compileQuantity(line.amount,line.itemId,content);if(cost[line.itemId]<=0)fail('positive bill');}
    // The first family compresses authoring, not materials or runtime statistics.
    const expected={structuralFrame:vessel.moduleCount},expanded={};
    for(const [moduleId,count]of Object.entries(vessel.counts)){
      const recipe=Object.values(content.recipes).find(r=>r.output===moduleId);
      if(!recipe||recipe.inputs.some(l=>!l.item)||Object.keys(recipe.cost??{}).length)fail('explicit source module bill required');
      for(const principle of recipe.conditions.discoveries??[])if(!raw.principles.includes(principle))fail('missing source manufacturing principle');
      for(const line of recipe.inputs)expected[line.item]=(expected[line.item]??0)+line.quantity*count/recipe.amount;
    }
    function expand(id,n,active=new Set()){
      if(Object.hasOwn(expected,id)){expanded[id]=(expanded[id]??0)+n;return;}
      if(active.has(id))fail('subsystem bill cycle');
      const recipe=Object.values(content.recipes).find(r=>r.output===id);
      if(!recipe||recipe.inputs.some(l=>!l.item)||Object.keys(recipe.cost??{}).length||!Number.isInteger(n/recipe.amount))fail('subsystem must expand to whole source bills');
      active=new Set([...active,id]);for(const line of recipe.inputs)expand(line.item,line.quantity*n/recipe.amount,active);
    }
    for(const [id,n]of Object.entries(cost))if(id!=='power')expand(id,n);
    if(Object.keys(expected).some(id=>expanded[id]!==expected[id])||Object.keys(expanded).some(id=>!Object.hasOwn(expected,id)))fail('bill differs from source modules plus joining frames');
    result[id]={...structuredClone(raw),id,cost,vessel};
  }
  return result;
}

// Historical identity is bounded independently of the current blueprint catalog.
// A blueprint edit never replaces the already resolved assembly of a saved ship.
export {validateVesselDesignOrigin} from './vesselDesignProvenance.js';
