import { check, fields } from '../../missions/missionCatalog.js';

export function createCargoMissionActions({compileQuantity,validateQuantity,previewBerthTransfer,executeBerthTransfer,items,formatQuantity}) {
  function descriptor(id,label,pickup) {
    const request=(o,m)=>({vesselId:m.vesselId,sourceId:pickup ? o.destinationId:m.vesselId,destinationId:pickup ? m.vesselId:o.destinationId,assetId:o.parameters.itemId,amount:o.parameters.quantity});
    return {id,semanticVersion:1,authoring:{label,parameters:{itemId:{type:'reference',required:true,catalog:'items'},quantity:{type:'quantity',required:true,itemField:'itemId'}},catalogs:{items}},
      compileParameters(raw) { fields(raw,['itemId','quantity']); check(items.some(i=>i.id===raw.itemId),'invalid physical cargo item'); return {itemId:raw.itemId,quantity:compileQuantity(raw.quantity,raw.itemId)}; },
      validate(o,progress) { fields(o.parameters,['itemId','quantity']); check(items.some(i=>i.id===o.parameters.itemId),'invalid physical cargo item'); validateQuantity(o.parameters.quantity,o.parameters.itemId); check(o.parameters.quantity>0,'quantity must be positive'); if(progress!==null) { fields(progress,['done']); check(typeof progress.done==='boolean','invalid cargo progress'); } },
      preview(plan,o,m) { const r=request(o,m), p=previewBerthTransfer(plan,r,m.issuerId); if(p.ok) { plan.locations[r.sourceId].resources=p.sourceResources; plan.locations[r.destinationId].resources=p.destinationResources; } return p; },
      activate:()=>({done:false}),
      safeToReplace:(_state,_objective,progress)=>({ready:true,useful:progress.done,complete:progress.done}),
      advance(state,o,p,m) { if(p.done) return {status:'COMPLETE'}; const r=request(o,m), preview=previewBerthTransfer(state,r,m.issuerId); if(!preview.ok) return {status:'BLOCKED',reason:preview.reason}; executeBerthTransfer(state,r,m.issuerId); p.done=true; return {status:'ACTION'}; },
      report:(o,p,_state,_mission,result)=>`${p?.done || result?.status==='COMPLETE' ? pickup?'Admitted to cargo':'Delivered':'Requested'} ${formatQuantity(o.parameters.quantity,o.parameters.itemId)} ${items.find(i=>i.id===o.parameters.itemId)?.name ?? o.parameters.itemId}`
    };
  }
  return {pickup:descriptor('pickupCargo','Pick up cargo',true),delivery:descriptor('deliverCargo','Deliver cargo',false)};
}
