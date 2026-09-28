import { recentLedgerEntries } from './worldLedger.js';
import { freezeDetached } from './narrative/narrativeFacts.js';

// An application read adapter over a successful runtime result. The ledger is
// recent history, not a queue: this explicit allow-list only supplies trigger hints.
export function committedNarrativeSummary(result) {
  if (!result?.previous || !result.state) throw new Error('Narrative publication requires a committed runtime result.');
  const afterId=result.previous.worldLedger.nextId-1;
  const records=result.state.worldLedger.nextId>result.previous.worldLedger.nextId?recentLedgerEntries(result.state,{afterId,limit:200}):[];
  const transitions=[];
  for (const e of records) {
    if (e.type.startsWith('PROCESS_') && ['PROCESS_STARTED','PROCESS_BLOCKED','PROCESS_RESUMED','PROCESS_COMPLETED','PROCESS_ABORTED'].includes(e.type))
      transitions.push({type:e.type,ledgerId:e.id,hostId:e.locationId,equipmentId:e.data.equipmentId,runId:e.data.runId});
    else if (e.type==='RESOURCE_NODE_DEPLETED') transitions.push({type:e.type,ledgerId:e.id,hostId:e.data.sourceLocationId,nodeId:e.data.nodeId});
    else if (e.type==='EQUIPMENT_REPAIRED') transitions.push({type:e.type,ledgerId:e.id,hostId:e.locationId,equipmentId:e.data.equipmentId});
    else if (e.type==='VESSEL_ASSEMBLED') transitions.push({type:e.type,ledgerId:e.id,hostId:e.locationId,entityId:e.targetId});
    else if (['SHIP_ARRIVED','SHIP_DEPARTED'].includes(e.type)) transitions.push({type:e.type,ledgerId:e.id,
      hostId:e.type==='SHIP_DEPARTED'?(result.previous.locations[e.actorId]?.dockedAtId ?? e.data.originAreaId):e.data.destinationId,entityId:e.actorId});
  }
  for (const edge of result.processingTransitions ?? []) if (edge.type==='PROCESS_PHASE_CHANGED' && edge.fromPhase==='working' && edge.toPhase==='delivery')
    transitions.push({type:edge.type,hostId:edge.hostId,equipmentId:edge.equipmentId,runId:edge.runId});
  return freezeDetached({transitions,partialHistory:records.length>0 && records.at(-1).id>afterId+1});
}
export function localNarrativeTriggers(summary,state,{action}={}) {
  const local=state.locationId;
  // Ship notifications are exact occupied ship/local berth, never all area traffic.
  return summary.transitions.filter(t=> {
    if (['SHIP_ARRIVED','SHIP_DEPARTED'].includes(t.type)) return t.entityId===local || t.hostId===local;
    if (t.type==='PROCESS_STARTED') return action?.id==='startProcess' && t.hostId===local;
    return t.hostId===local;
  });
}
export function createNarrativePresentation(narrative) {
  // Weak state identities cannot grow into saved history. Repeated observers of
  // the same commit share one publication budget; explicit requests bypass it.
  const handled=new WeakSet();
  return Object.freeze({
    observe(state,request) { return narrative.describe(state,request); },
    committed(result,{action={},payload={}}={}) {
      if (!result?.previous || !result.state) throw new Error('Narrative publication requires a committed runtime result.');
      if (handled.has(result.state)) return null;
      const summary=committedNarrativeSummary(result);
      handled.add(result.state);
      if (action.id==='dialogue:start') {
        const npcId=result.state.dialogue.active?.npcId ?? payload?.npcId;
        return npcId?narrative.describe(result.state,{surface:'npc_greeting',subjectId:npcId}):null;
      }
      const triggers=localNarrativeTriggers(summary,result.state,{action});
      if (result.previous.locationId!==result.state.locationId) triggers.push({type:'LOCATION_ENTERED',hostId:result.state.locationId});
      // Nothing is inferred from an arbitrary state diff. Inspection effects,
      // activation and other domains join only when actual producers justify it.
      if (!triggers.length) return null;
      return narrative.describe(result.state,{surface:'operations_update',subjectId:result.state.locationId,triggers:triggers.slice(0,200)});
    }
  });
}
