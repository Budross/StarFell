import { checkedAdd, checkedMultiply } from './quantities.js';

// Pin the mechanical truth, not labels or Narrative prose. Authored m³ values are
// included before compilation so the same signature is available in Content Studio.
export function processContract(source) {
  return JSON.stringify([source.revision ?? 1, source.kind, source.operation ?? 'refining', source.capability,
    source.inputs, source.outputs, source.duration, source.powerRate, source.startConditions ?? {}, source.hostKinds ?? ['site','ship']]);
}
export function composeProcess(authored, compiled, sources, content) {
  const c=authored.composition, fail=message=>{throw new Error(`Invalid integrated process ${authored.id}: ${message}.`);};
  if(!c || Object.keys(c).some(k=>!['sources','internalItems','durationMultiplier'].includes(k)) ||
    !Array.isArray(c.sources)||!c.sources.length||c.sources.length>8||!Array.isArray(c.internalItems)||c.internalItems.length>8||new Set(c.internalItems).size!==c.internalItems.length||
    !Number.isFinite(c.durationMultiplier)||c.durationMultiplier<1||c.durationMultiplier>4)fail('bounded composition required');
  if(['inputs','outputs','duration','powerRate'].some(k=>authored[k]!==undefined)||authored.operation!=='refining'||authored.kind!=='refining')fail('net refining contract must be derived');
  const balance={}, inputs={}, required=new Set(),produced=new Set();let duration=0,energy=0;
  for(const ref of c.sources){
    if(Object.keys(ref).some(k=>!['id','revision','contract','batches'].includes(k))||!Number.isSafeInteger(ref.batches)||ref.batches<1||ref.batches>100)fail('source batch multiple');
    const source=sources.find(s=>s.id===ref.id),p=compiled[ref.id];
    if(!source||source.composition||!p||p.kind!=='refining'||p.operation!=='refining'||ref.revision!==(source.revision??1)||ref.contract!==processContract(source))fail('source revision/contract changed; review and repin');
    if(Object.keys(p.startConditions).some(k=>k!=='discoveries'))fail('source conditions cannot be hidden');
    for(const id of p.startConditions.discoveries??[])required.add(id);
    if((authored.hostKinds??['site','ship']).some(k=>!p.hostKinds.includes(k)))fail('source host restriction');
    for(const l of p.inputs){const n=checkedMultiply(l.amount,ref.batches),available=balance[l.itemId]??0,missing=Math.max(0,n-available);inputs[l.itemId]=checkedAdd(inputs[l.itemId]??0,missing);balance[l.itemId]=available+missing-n;}
    for(const l of p.outputs){produced.add(l.itemId);balance[l.itemId]=checkedAdd(balance[l.itemId]??0,checkedMultiply(l.amount,ref.batches));}
    duration+=p.duration*ref.batches;energy+=p.duration*p.powerRate*ref.batches;
  }
  for(const id of c.internalItems)if(content.items[id]?.category!=='resource'||!produced.has(id)||(inputs[id]??0)!==0||(balance[id]??0)!==0)fail('internal material is not balanced');
  for(const id of produced)if((inputs[id]??0)===0&&(balance[id]??0)===0&&!c.internalItems.includes(id))fail('hidden intermediate must be explicitly declared');
  if(c.internalItems.includes('rareEarthConcentrate'))fail('Rare Earth Concentrate must remain a player-visible material');
  for(const id of required)if(!authored.startConditions?.discoveries?.includes(id))fail(`missing source principle ${id}`);
  const lines=map=>Object.entries(map).filter(([,n])=>n>0).map(([itemId,amount])=>({itemId,amount}));
  const result={inputs:lines(inputs),outputs:lines(balance),duration:duration*c.durationMultiplier,powerRate:energy/(duration*c.durationMultiplier)};
  if(!result.inputs.length||!result.outputs.length||result.inputs.length>8||result.outputs.length>8||!Number.isFinite(result.duration)||!Number.isFinite(result.powerRate))fail('net batch bounds');
  return result;
}
