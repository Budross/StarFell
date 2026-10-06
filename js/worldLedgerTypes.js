import { validId, safeKey } from './conditions.js';
import { entityTypes } from './entities.js';

export const LEDGER_ID_LENGTH = 128;
export function ledgerCheck(ok, detail) {
  if (!ok) throw new Error(`Invalid world ledger: ${detail}.`);
}
export function ledgerContentId(id, key = false) {
  return (key ? safeKey(id) : validId(id)) && id.length <= LEDGER_ID_LENGTH;
}
const positiveInteger = n => Number.isSafeInteger(n) && n > 0;
const health = n => Number.isFinite(n) && n >= 0 && n <= 1;
const ref = (path, role, types) => Object.freeze({ path, role, ...(types ? { types: Object.freeze(types) } : {}) });

function descriptor(importance, required, optional, validate, references = () => [], fields = {}, checks = [], append = () => {}) {
  return Object.freeze({ defaultImportance: importance,
    fields: Object.freeze(fields), checks: Object.freeze(checks),
    validateHistorical(entry) {
      const data = entry.data;
      ledgerCheck(required.every(k => Object.hasOwn(data, k)) &&
        Object.keys(data).every(k => required.includes(k) || optional.includes(k)), `${entry.type} payload fields`);
      validate(entry);
    }, references, validateAppend: append });
}
const required = (role, types) => Object.freeze({ role, types: types && Object.freeze(types), required: true });
const initiator = e => Object.hasOwn(e.data, 'initiatorId') ? [ref('data.initiatorId', 'principal')] : [];

function journey(importance, arrived) {
  return descriptor(importance, ['kind', 'originAreaId', 'destinationId'], ['initiatorId'], e => {
    ledgerCheck(['area', 'dock'].includes(e.data.kind), 'journey kind');
    ledgerCheck(e.targetId === e.data.destinationId &&
      e.locationId === (arrived ? e.data.destinationId : e.data.originAreaId), 'journey context');
    if (!arrived) ledgerCheck(e.areaId === e.data.originAreaId, 'departure area');
    if (arrived && e.data.kind === 'area') ledgerCheck(e.areaId === e.data.destinationId, 'arrival area');
  }, e => [ref('data.originAreaId', 'historyArea'),
    ref('data.destinationId', e.data.kind === 'area' ? 'historyArea' : 'historyLocation', e.data.kind === 'area' ? ['area'] : ['site']),
    ...initiator(e)], { actorId: required('historyLocation', ['ship']), targetId: required('historyContainer'),
    locationId: required('historyContainer'), areaId: required('historyArea') });
}
function lifecycle(importance, previous) {
  return descriptor(importance, ['previousLifecycle'], [], e => {
    ledgerCheck(previous.includes(e.data.previousLifecycle), 'previous lifecycle');
  }, undefined, { targetId: required('historyEntity') });
}

function processEvent(importance, fields, started = false) {
  const common = ['runId','processId','kind','equipmentId'];
  return descriptor(importance,[...common,...fields],['sourceLocationId','nodeId','sourceAmount'], e => {
    const d = e.data;
    ledgerCheck(positiveInteger(d.runId) && ledgerContentId(d.processId) && ledgerContentId(d.equipmentId) && ['extraction','refining'].includes(d.kind), 'process identity');
    ledgerCheck(e.type === 'RESOURCE_NODE_DEPLETED' ? e.targetId === d.sourceLocationId : e.targetId === e.locationId, 'process host/source');
    if (d.kind === 'extraction') ledgerCheck(ledgerContentId(d.nodeId) && positiveInteger(d.sourceAmount) && ledgerContentId(d.sourceLocationId), 'source identity/amount');
    else ledgerCheck(d.sourceLocationId === undefined && d.nodeId === undefined && d.sourceAmount === undefined, 'refining source');
    for (const k of ['inputs','outputs','lostInputs','lostOutputs']) if (d[k] !== undefined) {
      ledgerCheck(Array.isArray(d[k]) && d[k].length <= 8 && new Set(d[k].map(l => l.itemId)).size === d[k].length, 'process lines');
      for (const l of d[k]) ledgerCheck(Object.keys(l).length === 3 && ledgerContentId(l.itemId) && ['bulk','count'].includes(l.quantityKind) && positiveInteger(l.amount), 'process amount');
    }
    if (d.phase !== undefined) ledgerCheck(['working','delivery'].includes(d.phase), 'process phase');
    if (d.reasonCode !== undefined) ledgerCheck((d.phase === 'delivery' ? ['HOST_INACTIVE','OUTPUT_FULL'] : ['HOST_INACTIVE','EQUIPMENT_UNAVAILABLE','SOURCE_UNAVAILABLE','NO_POWER']).includes(d.reasonCode), 'process blocker');
    if (d.previousReasonCode !== undefined) ledgerCheck(['HOST_INACTIVE','EQUIPMENT_UNAVAILABLE','SOURCE_UNAVAILABLE','NO_POWER'].includes(d.previousReasonCode), 'previous process blocker');
    if (d.reason !== undefined) ledgerCheck(['manual','host_terminal'].includes(d.reason), 'abort reason');
    if (d.resourceId !== undefined) ledgerCheck(ledgerContentId(d.resourceId) && d.quantityKind === 'bulk' && positiveInteger(d.amount), 'depleted material');
  }, e => e.data.kind === 'extraction' ? [ref('data.sourceLocationId','historyLocation',['site'])] : [],
  { targetId: required('historyLocation'), locationId: required('historyLocation') },
  ['resourceKind','isCurrentEquipmentId', ...(started ? ['isCurrentProcessId'] : [])], (e,c) => {
    ledgerCheck(c.isCurrentEquipmentId(e.data.equipmentId), 'current processing equipment');
    if (started) ledgerCheck(c.isCurrentProcessId(e.data.processId), 'current process');
    for (const k of ['inputs','outputs','lostInputs','lostOutputs']) for (const l of e.data[k] ?? []) ledgerCheck(c.resourceKind(l.itemId) === l.quantityKind,'current process item/kind');
    if (e.data.resourceId) ledgerCheck(c.resourceKind(e.data.resourceId) === 'bulk','current node material');
  });
}

// These descriptors interpret saved facts, never current cargo/placement/health.
// Only append checks receive current-content capabilities; history needs none.
export const worldLedgerTypes = Object.freeze({
  DESIGN_STUDIED: descriptor(0.5,['studyId','revision','discoveryId'],[],e=>{
    ledgerCheck(ledgerContentId(e.data.studyId)&&positiveInteger(e.data.revision)&&ledgerContentId(e.data.discoveryId),'study identity');
  },undefined,{actorId:required('principal'),targetId:required('historyLocation'),locationId:required('historyLocation')},['isCurrentDiscoveryId'],(e,c)=>ledgerCheck(c.isCurrentDiscoveryId(e.data.discoveryId),'study discovery')),
  MISSION_TRANSITION: descriptor(0.4,['missionId','event','phase','outcome','reason'],[], e=>{
    ledgerCheck(/^mission[1-9]\d*$/.test(e.data.missionId) && ['ASSIGNED','UPDATED','RECALLED','BLOCKED','STRANDED','RETURNED'].includes(e.data.event), 'mission identity/event');
    ledgerCheck(['ACTIVE','RETURNING','COMPLETED','STRANDED'].includes(e.data.phase) && ['PENDING','SUCCEEDED','PARTIAL','FAILED','RECALLED'].includes(e.data.outcome), 'mission phase/outcome');
    ledgerCheck(e.data.reason===null || typeof e.data.reason==='string' && e.data.reason.length<=256, 'mission reason');
  },undefined,{actorId:required('principal'),targetId:required('historyLocation',['ship']),locationId:required('historyLocation',['site'])}),
  VESSEL_ASSEMBLED: descriptor(0.6, [], [], () => {}, undefined,
    { actorId: required('principal'), targetId: required('historyLocation', ['ship']), locationId: required('historyLocation', ['site']), areaId: required('historyArea') }),
  PROCESS_STARTED: processEvent(0.2,['inputs'],true),
  PROCESS_BLOCKED: processEvent(0.3,['phase','reasonCode']),
  PROCESS_RESUMED: processEvent(0.2,['previousReasonCode']),
  PROCESS_COMPLETED: processEvent(0.2,['inputs','outputs']),
  PROCESS_ABORTED: processEvent(0.3,['phase','reason','lostInputs','lostOutputs']),
  RESOURCE_NODE_DEPLETED: processEvent(0.5,['resourceId','quantityKind','amount']),
  SHIP_DEPARTED: journey(0.4, false),
  SHIP_ARRIVED: journey(0.4, true),
  RESOURCE_TRANSFERRED: descriptor(0.2, ['sourceId', 'destinationId', 'resourceId', 'quantityKind', 'amount'], [], e => {
    const d = e.data;
    ledgerCheck(ledgerContentId(d.resourceId), 'resource ID');
    ledgerCheck(['bulk', 'count', 'utility'].includes(d.quantityKind), 'quantity kind');
    ledgerCheck(Number.isFinite(d.amount) && d.amount > 0 && d.amount <= Number.MAX_SAFE_INTEGER &&
      (d.quantityKind === 'utility' || Number.isSafeInteger(d.amount)), 'transfer amount');
    ledgerCheck(d.sourceId !== d.destinationId && e.targetId === d.destinationId && e.locationId === d.sourceId, 'transfer context');
  }, () => [ref('data.sourceId', 'historyLocation'), ref('data.destinationId', 'historyLocation')],
  { actorId: required('principal'), targetId: required('historyLocation'), locationId: required('historyLocation') },
  ['resourceKind'], (e, c) => ledgerCheck(c.resourceKind(e.data.resourceId) === e.data.quantityKind, 'current resource/kind')),
  ENTITY_CREATED: descriptor(0.5, ['entityType', 'initialLifecycle'], [], e => {
    ledgerCheck(entityTypes.includes(e.data.entityType) && ['active', 'inactive'].includes(e.data.initialLifecycle), 'created entity facts');
  }, e => [ref('targetId', 'historyEntity', [e.data.entityType])], { targetId: required('historyEntity') }),
  ENTITY_ACTIVATED: lifecycle(0.4, ['inactive']),
  ENTITY_DEACTIVATED: lifecycle(0.4, ['active']),
  ENTITY_DESTROYED: lifecycle(1, ['active', 'inactive']),
  ENTITY_RETIRED: lifecycle(0.5, ['active', 'inactive']),
  NPC_RELOCATED: descriptor(0.4, ['fromLocationId', 'toLocationId'], ['initiatorId'], e => {
    ledgerCheck(e.data.fromLocationId !== e.data.toLocationId && e.targetId === e.data.toLocationId &&
      e.locationId === e.data.toLocationId, 'relocation context');
  }, e => [ref('data.fromLocationId', 'historyLocation'), ref('data.toLocationId', 'historyLocation'), ...initiator(e)],
  { actorId: required('historyNpc'), targetId: required('historyLocation'), locationId: required('historyLocation') }),
  RESEARCH_COMPLETED: descriptor(0.6, ['discoveryId', 'methodId', 'attemptId'], [], e => {
    ledgerCheck(ledgerContentId(e.data.discoveryId, true) && ledgerContentId(e.data.methodId) &&
      positiveInteger(e.data.attemptId) && e.targetId === null, 'research facts');
  }, undefined, { actorId: required('principal'), locationId: required('historyLocation') },
  ['isCurrentMethodId', 'isCurrentDiscoveryId'], (e, c) => ledgerCheck(
    c.isCurrentMethodId(e.data.methodId) === true && c.isCurrentDiscoveryId(e.data.discoveryId) === true, 'current research IDs')),
  EQUIPMENT_REPAIRED: descriptor(0.3, ['equipmentId', 'previousHealth', 'health'], [], e => {
    ledgerCheck(ledgerContentId(e.data.equipmentId) && health(e.data.previousHealth) &&
      e.data.previousHealth < 1 && e.data.health === 1 && e.targetId === e.locationId, 'repair facts');
  }, undefined, { actorId: required('principal'), targetId: required('historyLocation'), locationId: required('historyLocation') },
  ['isCurrentEquipmentId'], (e, c) => ledgerCheck(c.isCurrentEquipmentId(e.data.equipmentId) === true, 'current equipment ID'))
});

export function ledgerType(type) {
  ledgerCheck(typeof type === 'string' && Object.hasOwn(worldLedgerTypes, type), `unknown type ${String(type)}`);
  return worldLedgerTypes[type];
}

const common = Object.freeze({ actorId: 'historyEntity', targetId: 'historyEntity',
  locationId: 'historyContainer', areaId: 'historyArea' });
export function ledgerReferenceSpecs(entry) {
  const type = ledgerType(entry.type);
  return [...Object.entries(common).filter(([key]) => entry[key] !== null).map(([key, role]) =>
    ref(key, type.fields[key]?.role ?? role, type.fields[key]?.types)), ...type.references(entry)];
}
