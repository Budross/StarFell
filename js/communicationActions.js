import { createEquipmentQueries } from './equipmentQuery.js';
import { transfer, transferReason } from './resources.js';
import { permissionReason } from './authority.js';
import { setScopedFlag } from './flags.js';

export const communicationConditionSources=Object.freeze([{path:'communications.scanSignal.conditions',label:'Local signal scan',conditions:{capabilities:['signalScanning']}},{path:'communications.remoteNpcContact',label:'Remote NPC conversations',conditions:{capabilities:['radioCommunication']}}]);
export const communicationProducerMetadata=Object.freeze([{kind:'flag',scope:'global',flag:'localSignalObserved',value:true}]);

// One named Communications action. Capability declarations never generate actions.
export function createCommunicationActions(content, equipment = createEquipmentQueries(content)) {
  const cost={power:1};
  const reason=(state,context)=>!equipment.hasCapability(state,context?.id??state.locationId,'signalScanning')?'Requires operational signal-scanning equipment.':
    permissionReason(state,'player',context?.id??state.locationId,'useFacilities')||permissionReason(state,'player',context?.id??state.locationId,'withdrawCargo')||
    transferReason(context?.store??state.locations[state.locationId],cost,{},content);
  return [{id:'scanSignal',name:'Scan local frequencies',order:80,collection:'equipment',permissions:['useFacilities','withdrawCargo'],description:'1 power',
    visible:(state,context)=>!state.flags.localSignalObserved&&equipment.hasCapability(state,context?.id??state.locationId,'signalScanning'),
    requirement:reason,
    execute(state,context,payload){
      if(payload!==undefined&&(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length))throw new Error('Signal scanning does not accept a target or contact.');
      if(state.flags.localSignalObserved)throw new Error('This signal has already been observed.');
      const blocked=reason(state,context);if(blocked)throw new Error(blocked);
      transfer(context?.store??state.locations[state.locationId],cost,{},content);
      setScopedFlag(state,'global',null,'localSignalObserved');
      return 'A repeating signal emerges from the static. The observation is saved for future investigation.';
    }}];
}
