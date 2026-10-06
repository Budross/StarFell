import { record,validId } from './conditions.js';
// Historical identity is independent of the live design catalog.
export function validateVesselDesignOrigin(origin){
  if(!record(origin)||Object.keys(origin).length!==3||!validId(origin.designId)||!Number.isSafeInteger(origin.revision)||origin.revision<1||origin.family!=='prospectorVessel')throw new Error('Invalid saved vessel design provenance.');
}
