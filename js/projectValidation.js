import { describeEffects } from './effects.js';
import { safeKey,validId } from './conditions.js';

// Composition links compiler-provided requirements and producer facts. This is
// reference coverage, not economic reachability or execution of authored effects.
export function effectProducerMetadata(sources,resolveTargets) {
  return sources.flatMap(source=>describeEffects(source.effects,source.path).flatMap(fact=>{
    if(fact.kind==='discovery'&&fact.access==='produce')return [{kind:'discovery',id:fact.id}];
    if(fact.kind!=='flagWrite')return [];
    if(fact.scope==='global')return [{kind:'flag',scope:'global',flag:fact.flag,value:fact.value}];
    return resolveTargets(source,fact).map(targetId=>({kind:'flag',scope:fact.scope,targetId,flag:fact.flag,value:fact.value}));
  }));
}
export function validateProjectRequirements({conditionSources,capabilities,producerMetadata,externalProducers=[]}) {
  const known=new Set(capabilities), producers=[...producerMetadata], warnings=[];
  for(const declaration of externalProducers) {
    if(!declaration || typeof declaration!=='object' || Array.isArray(declaration))throw new Error('Invalid external producer declaration: identify its provider and reason.');
    const keys=declaration.kind==='discovery'?['kind','id','provider','reason']:['kind','scope','targetId','flag','provider','reason'];
    if(!declaration||!['discovery','flag'].includes(declaration.kind)||Object.keys(declaration).some(k=>!keys.includes(k))||!['provider','reason'].every(k=>typeof declaration[k]==='string'&&declaration[k].trim()))throw new Error('Invalid external producer declaration: identify its provider and reason.');
    if(declaration.kind==='discovery'?!safeKey(declaration.id):!['global','location','npc'].includes(declaration.scope)||!safeKey(declaration.flag)||(declaration.scope==='global'?declaration.targetId!==undefined:!validId(declaration.targetId)))throw new Error('Invalid external producer reference.');
    producers.push({...declaration,value:true});
  }
  for(const source of conditionSources) {
    function visit(value={},path=source.path,positive=true) {
      for(const [index,id]of (value.capabilities??[]).entries())if(!known.has(id))throw Object.assign(new Error(`${path}.capabilities.${index}: unknown capability ${id}.`),{path:`${path}.capabilities.${index}`});
      if(positive) {
        for(const id of value.discoveries??[])if(!producers.some(p=>p.kind==='discovery'&&p.id===id))warnings.push({level:'warning',path:`${path}.discoveries`,text:`${path}: discovery ${id} has no known producer.`});
        const flag=(scope,targetId,key)=>{if(!producers.some(p=>p.kind==='flag'&&p.scope===scope&&p.flag===key&&p.value===true&&(scope==='global'||targetId===null||p.targetId===targetId||p.targetId==='*')))warnings.push({level:'warning',path,text:`${path}: ${scope} flag ${targetId??''}/${key} has no known producer.`});};
        for(const key of value.flags??[])flag('global',null,key);
        const localTarget=source.locationId??null;
        for(const key of value.localFlags??[])flag('location',localTarget,key);
        for(const [id,keys]of Object.entries(value.locationFlags??{}))for(const key of keys)flag('location',id,key);
        for(const [id,keys]of Object.entries(value.npcFlags??{}))for(const key of keys)flag('npc',id==='speaker'?source.npcId??null:id,key);
      }
      (value.all??[]).forEach((child,i)=>visit(child,`${path}.all.${i}`,positive));(value.any??[]).forEach((child,i)=>visit(child,`${path}.any.${i}`,positive));if(value.not)visit(value.not,`${path}.not`,!positive);
    }
    visit(source.conditions);
  }
  return warnings;
}
