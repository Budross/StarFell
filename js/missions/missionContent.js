// Known action combinations are ordinary authored data. Homes may be overridden at assignment.
export const missionDefinitions = {
  titaniumProspectingRun:{name:'Titanium prospecting run',homeLocationId:'habitat',objectives:[{id:'collect',destinationId:'metallicFragment',action:'extractResource',parameters:{nodeId:'titaniumDeposit',resourceId:'titaniumOre',quantity:0.10}}],returnPolicy:{onComplete:'home',onBlocked:'home'}},
  iceProspectingRun:{name:'Water ice prospecting run',homeLocationId:'habitat',objectives:[{id:'collect',destinationId:'icyBody',action:'extractResource',parameters:{nodeId:'iceDeposit',resourceId:'waterIce',quantity:0.25}}],returnPolicy:{onComplete:'home',onBlocked:'home'}},
  frameDelivery:{name:'Deliver structural frames',homeLocationId:'habitat',objectives:[
    {id:'collect',destinationId:'habitat',action:'pickupCargo',parameters:{itemId:'structuralFrame',quantity:3}},
    {id:'deliver',destinationId:'metallicFragment',action:'deliverCargo',parameters:{itemId:'structuralFrame',quantity:3}}
  ],returnPolicy:{onComplete:'home',onBlocked:'home'}}
};
