import { planRoute } from '../../navigationRoutes.js';
import { locationDefinition, locationInstances } from '../../entityQueries.js';
import { previewNavigation, journeyQuote, navigate } from '../../ships.js';
import { getLocationContext, isKnown, physicalLinks } from '../../locations.js';
import { powerRate } from '../../game.js';
import { capacity } from '../../resources.js';

// Common destination/return edge. Concrete movement stays in Ships.
export function createMissionTransport({world,content,ledgerServices}) {
  const read=(state,id)=>state.locations[id] ?? {};
  const projected=(state,id,area)=>({...state,locations:{...state.locations,[id]:{...read(state,id),areaId:area,dockedAtId:null,journey:null}}});
  function route(state,id,issuer,destination) {
    const local=read(state,id), target=locationDefinition(state,world,destination);
    if(!target || target.kind!=='site' || target.mobile || state.entities[destination]?.lifecycle!=='active' || !isKnown(state,world,content,destination)) return {status:'BLOCKED',reason:'Destination is unavailable.'};
    if(state.entities[id]?.lifecycle!=='active') return {status:'BLOCKED',reason:'Vessel is unavailable.'};
    if(local.journey) return {status:'WAITING'};
    if(local.dockedAtId===destination) return {status:'COMPLETE',legs:[]};
    const targetArea=state.locations[destination].areaId;
    const path=planRoute(local.areaId,targetArea,
      area=>physicalLinks(state,world).flatMap(([a,b])=>a===area?[b]:b===area?[a]:[]),
      (origin,area)=>{
        const scratch=projected(state,id,origin), p=previewNavigation(scratch,'travel',area,world,content,id,issuer), q=journeyQuote(scratch,area,world,content,id);
        return q && {...q,ok:p.ok || ['POWER','FUEL'].includes(p.code)};
      });
    if(!path) return {status:'BLOCKED',reason:'No legal route to destination.'};
    const legs=[...(local.dockedAtId ? [{operation:'undock'}]:[]),...path.path.map(targetId=>({operation:'travel',targetId})),{operation:'dock',targetId:destination}];
    return {status:'ACTION',leg:legs[0],legs};
  }
  function next(state,id,issuer,destination) {
    const result=route(state,id,issuer,destination); if(result.status!=='ACTION') return result;
    const {operation,targetId}=result.leg, p=previewNavigation(state,operation,targetId,world,content,id,issuer);
    if(p.ok) return result;
    if(p.code==='POWER') {
      const ctx=getLocationContext(state,content,world,id,issuer), q=journeyQuote(state,targetId,world,content,id);
      if(q.powerCost<=capacity(ctx.store,'power',content) && powerRate(ctx.store,content)>0) return {status:'WAITING',reason:p.reason};
    }
    return {status:'BLOCKED',reason:p.reason};
  }
  function planningState(state,id) {
    const plan={...state,locations:Object.fromEntries(Object.entries(state.locations).map(([key,l])=>[key,{...l,resources:{...l.resources},fuel:l.fuel?structuredClone(l.fuel):undefined,resourceNodes:structuredClone(l.resourceNodes)}])),processing:{...state.processing,runs:{...state.processing.runs}}};
    const local=plan.locations[id];
    if(local?.journey) { if(local.journey.kind==='area')local.areaId=local.journey.targetId;else local.dockedAtId=local.journey.targetId;local.journey=null; }
    return plan;
  }
  function previewRoute(plan,id,issuer,destination) {
    const result=route(plan,id,issuer,destination); if(['BLOCKED','WAITING'].includes(result.status))return {ok:false,reason:result.reason};
    let fuel=0;
    for(const leg of result.legs) {
      const local=plan.locations[id], ctx=getLocationContext(plan,content,world,id,issuer);
      const q=leg.operation==='undock'?null:journeyQuote(plan,leg.targetId,world,content,id);
      if(q) {
        const cap=capacity(ctx.store,'power',content), generation=powerRate(ctx.store,content);
        if(q.powerCost>cap) return {ok:false,reason:'Journey exceeds vessel power reserve capacity.'};
        if(local.resources.power<q.powerCost && generation>0)local.resources.power=cap;
      }
      const p=previewNavigation(plan,leg.operation,leg.targetId,world,content,id,issuer);
      if(!p.ok)return {ok:false,reason:p.reason};
      if(q) {
        local.resources.power-=q.powerCost;
        local.resources.power=Math.min(capacity(ctx.store,'power',content),Math.max(0,local.resources.power+powerRate(ctx.store,content)*q.duration));
        if(local.fuel) { local.fuel.items[q.fuelItemId]-=q.fuelUnits; fuel+=q.fuelUnits; }
      }
      if(leg.operation==='travel')local.areaId=leg.targetId;
      local.dockedAtId=leg.operation==='dock'?leg.targetId:null;
    }
    return {ok:true,fuel,legs:result.legs};
  }
  return {read,next,planningState,previewRoute,
    destinations:state=>locationInstances(state,world).filter(d=>d.kind==='site' && !d.mobile && isKnown(state,world,content,d.id)).map(d=>({id:d.id,name:d.name})),
    execute:(state,id,issuer,leg)=>navigate(state,leg.operation,leg.targetId,world,content,id,issuer,ledgerServices)};
}
