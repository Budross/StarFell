import {compareKeys,distanceSquared,keyedRandom} from './worldSpace.js';
export const naturalResourceIds=['waterIce','ironOre','copperOre','aluminumOre','titaniumOre','nickelOre','tungstenOre','lithiumOre','rareEarthMinerals','uraniumOre','silica','carbon','nitrogen','sulfur','methane','ammonia'];
const fields=['metal','silicate','volatile','carbon','refractory','rare'];
const clamp=n=>Math.max(0,Math.min(1,n));
export function createMaterialFields(seed,profile) {
  const {space,geology:cfg}=profile;
  const motifs=Object.keys(cfg.motifs).sort(compareKeys);
  const patches=Array.from({length:cfg.patchCount},(_,i)=>{
    const motif=cfg.motifs[motifs[i%motifs.length]],values=fields.map(f=>motif[f]);
    return {position:space.min.map((n,j)=>n+keyedRandom(seed,'materialPatch',i,j)*(space.max[j]-n)),values};
  });
  return position=>{
    const weights=patches.map(p=>Math.exp(-distanceSquared(position,p.position)/(2*(cfg.patchRadius/2)**2)));
    const total=weights.reduce((a,b)=>a+b,0);
    return Object.fromEntries(fields.map((f,j)=>[f,Math.round(patches.reduce((sum,p,i)=>sum+p.values[j]*weights[i],0)/total*10000)/10000]));
  };
}
export function generateAsteroid(seed,candidate,profile,sample,startPosition) {
  const cfg=profile.geology, regional=sample(candidate.position), key=candidate.placementKey;
  const materials=Object.fromEntries(fields.map(f=>[f,clamp(regional[f]+(keyedRandom(seed,key,'body',f)*2-1)*cfg.localVariance)]));
  const nearStart=distanceSquared(candidate.position,startPosition)<profile.placement.startRadius**2;
  if(nearStart)materials.metal=Math.max(.55,materials.metal);
  const usefulness=clamp(Math.max(regional.metal,regional.silicate,regional.volatile)*1.3-.2);
  const outlier=keyedRandom(seed,key,'outlier')>1-cfg.outlierProbability;
  const roll=keyedRandom(seed,key,'scale');let bucket=cfg.budgetWeights.length-1,sum=0;
  for(let i=0;i<cfg.budgetWeights.length;i++){sum+=cfg.budgetWeights[i];if(roll<sum){bucket=i;break;}}
  const budget=cfg.budgetsM3[bucket]*(outlier?1.5:Math.max(.03,usefulness)**2)*(nearStart?Math.max(1,1/Math.max(.03,usefulness)):1)*(.75+.5*keyedRandom(seed,key,'budget'));
  const scores=[];
  for(const resourceId of Object.keys(cfg.resources).sort(compareKeys)) {
    const rule=cfg.resources[resourceId], gate=rule.gate;
    // Gates use regional fields: local noise never sprinkles scarce ore everywhere.
    if(gate && regional[gate==='uranium'?'rare':gate]<cfg[`${gate}Gate`])continue;
    let abundance=materials[rule.field]*(rule.associate?(.3+.7*materials[rule.associate]):1);
    if(abundance<cfg.minAbundance || keyedRandom(seed,key,'occurrence',resourceId)>abundance)continue;
    scores.push({resourceId,rule,score:abundance*rule.weight*(.75+.5*keyedRandom(seed,key,'reserve',resourceId))});
  }
  if(nearStart&&!scores.some(s=>s.resourceId==='ironOre'))scores.push({resourceId:'ironOre',rule:cfg.resources.ironOre,score:.55});
  scores.sort((a,b)=>b.score-a.score||compareKeys(a.resourceId,b.resourceId));scores.splice(cfg.maxNodes);
  const total=scores.reduce((n,s)=>n+s.score,0),resourceNodes={};
  for(const s of scores.sort((a,b)=>compareKeys(a.resourceId,b.resourceId))) {
    const reserve=Math.floor(budget*1e6*s.score/total/cfg.batchUnits)*cfg.batchUnits;
    if(reserve<=0)continue;
    const id=`deposit_${s.resourceId}`;
    resourceNodes[id]={id,resourceId:s.resourceId,initialReserve:reserve,initialReserveM3:reserve/1e6,tags:s.rule.boundVolatile?['boundVolatile','volatileBearing']:['solid','prospectable']};
  }
  const dominant=Object.entries(materials).sort((a,b)=>b[1]-a[1]||compareKeys(a[0],b[0]))[0][0];
  return {bodyCharacter:{scale:['small','ordinary','large','massive'][bucket],dominant,materials:Object.fromEntries(fields.map(f=>[f,Math.round(materials[f]*10000)]))},resourceNodes};
}
