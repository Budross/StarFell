import { validEntityId, getEntity } from './entities.js';
import { entityReference, referenceReason } from './entityReferences.js';
import { ledgerCheck, ledgerType, ledgerReferenceSpecs, LEDGER_ID_LENGTH } from './worldLedgerTypes.js';

// Provisional until Processing's event rates can be measured. One tuning point.
export const WORLD_LEDGER_LIMIT = 200;
export const LEDGER_ENTRY_SIZE_LIMIT = 2048;
const envelope = ['id', 'type', 'time', 'actorId', 'targetId', 'locationId', 'areaId', 'importance', 'data'];
const supplied = ['type', 'actorId', 'targetId', 'locationId', 'areaId', 'importance', 'data'];
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const integer = n => Number.isSafeInteger(n) && n >= 0;
const identity = id => validEntityId(id) && id.length <= LEDGER_ID_LENGTH;
const normalized = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
const time = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;

// Reject lossy/non-JSON values before stringify/clone, including accessors and
// sparse arrays. Payload shapes/nesting remain the responsibility of each type.
function jsonFacts(value, depth = 0) {
  ledgerCheck(depth <= 4, 'fact nesting');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') { ledgerCheck(Number.isFinite(value), 'nonfinite fact'); return; }
  ledgerCheck(isRecord(value) || Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, 'non-JSON fact');
  const keys = Reflect.ownKeys(value);
  if (Array.isArray(value)) {
    ledgerCheck(value.length <= 16 && keys.length === value.length + 1 &&
      Array.from({ length: value.length }, (_, i) => Object.hasOwn(value, i)).every(Boolean), 'fact array');
  }
  for (const key of keys) {
    if (Array.isArray(value) && key === 'length') continue;
    const field = Object.getOwnPropertyDescriptor(value, key);
    ledgerCheck(typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key) &&
      field.enumerable && Object.hasOwn(field, 'value'), 'fact key/accessor');
    jsonFacts(field.value, depth + 1);
  }
}
function fields(value, keys, exact = true) {
  ledgerCheck(isRecord(value) && Reflect.ownKeys(value).every(k => keys.includes(k)) &&
    (!exact || keys.every(k => Object.hasOwn(value, k))), 'record fields');
  ledgerCheck(Object.values(Object.getOwnPropertyDescriptors(value)).every(field =>
    field.enumerable && Object.hasOwn(field, 'value')), 'record accessor/nonenumerable field');
}
const atPath = (entry, path) => path.split('.').reduce((value, key) => value?.[key], entry);

function validateEntry(state, entry) {
  fields(entry, envelope); jsonFacts(entry);
  const type = ledgerType(entry.type);
  ledgerCheck(integer(entry.id) && entry.id > 0, 'entry ID');
  ledgerCheck(time(entry.time) && entry.time <= state.simulationTime, 'entry time');
  ledgerCheck(normalized(entry.importance), 'importance');
  for (const key of ['actorId', 'targetId', 'locationId', 'areaId']) {
    ledgerCheck(entry[key] === null ? !type.fields[key]?.required : identity(entry[key]), `${key}`);
  }
  ledgerCheck(isRecord(entry.data), 'payload');
  type.validateHistorical(entry);
  for (const spec of ledgerReferenceSpecs(entry)) {
    const id = atPath(entry, spec.path);
    ledgerCheck(identity(id), spec.path);
    const reason = referenceReason(state, id, spec.role), entity = getEntity(state, id);
    ledgerCheck(!reason, `${spec.path}: ${reason}`);
    ledgerCheck(!spec.types || spec.types.includes(entity.type), `${spec.path} entity type`);
    ledgerCheck(time(entity.createdAt) && entity.createdAt <= entry.time, `${spec.path} identity did not yet exist`);
  }
  ledgerCheck(JSON.stringify(entry).length <= LEDGER_ENTRY_SIZE_LIMIT, 'entry size');
}

export const createWorldLedger = () => ({ nextId: 1, entries: [] });
export function validateWorldLedger(state) {
  const ledger = state.worldLedger;
  fields(ledger, ['nextId', 'entries']);
  ledgerCheck(integer(ledger.nextId) && ledger.nextId > 0 && Array.isArray(ledger.entries) &&
    Object.getPrototypeOf(ledger.entries) === Array.prototype && ledger.entries.length <= WORLD_LEDGER_LIMIT &&
    Reflect.ownKeys(ledger.entries).length === ledger.entries.length + 1 &&
    Array.from({ length: ledger.entries.length }, (_, i) => Object.getOwnPropertyDescriptor(ledger.entries, i))
      .every(field => field?.enumerable && Object.hasOwn(field, 'value')) && time(state.simulationTime), 'structure/counter/time');
  let previousId = 0, previousTime = 0;
  for (const entry of ledger.entries) {
    try {
      validateEntry(state, entry);
      ledgerCheck(entry.id > previousId && entry.id < ledger.nextId && entry.time >= previousTime, 'entry order/counter');
    } catch (cause) {
      throw new Error(`World ledger entry ${entry?.id} (${entry?.type}): ${cause.message}`, { cause });
    }
    previousId = entry.id; previousTime = entry.time;
  }
}

// Append-only current-content capabilities. No catalogs enter historical checks.
export function createWorldLedgerServices(checks = {}) {
  const batches = new WeakMap();
  const bound = Object.freeze(Object.fromEntries(['resourceKind', 'isCurrentEquipmentId', 'isCurrentMethodId', 'isCurrentDiscoveryId', 'isCurrentProcessId']
    .map(key => [key, checks[key]])));
  return Object.freeze({ validate: validateWorldLedger,
    withBatch(state, operation) {
      if (batches.has(state)) return operation();
      const batch = { validated: false }; batches.set(state,batch);
      try {
        const result = operation();
        ledgerCheck(!result || typeof result.then !== 'function','asynchronous ledger batch');
        if (batch.validated) validateWorldLedger(state);
        return result;
      } finally { batches.delete(state); }
    },
    append(state, input) {
      fields(input, supplied, false); jsonFacts(input);
      const batch = batches.get(state);
      if (!batch?.validated) { validateWorldLedger(state); if (batch) batch.validated = true; }
      const type = ledgerType(input.type), ledger = state.worldLedger;
      ledgerCheck(ledger.nextId < Number.MAX_SAFE_INTEGER, 'ID counter exhausted');
      const entry = { id: ledger.nextId, type: input.type, time: checks.clock ? checks.clock.now(state) : state.simulationTime,
        actorId: input.actorId === undefined ? null : input.actorId,
        targetId: input.targetId === undefined ? null : input.targetId,
        locationId: input.locationId === undefined ? null : input.locationId,
        areaId: input.areaId === undefined ? null : input.areaId,
        importance: input.importance === undefined ? type.defaultImportance : input.importance,
        data: structuredClone(input.data) };
      validateEntry(state, entry);
      const capabilities = Object.freeze(Object.fromEntries(type.checks.map(key => {
        ledgerCheck(typeof bound[key] === 'function', `missing append capability ${key}`);
        return [key, bound[key]];
      })));
      type.validateAppend(entry, capabilities);
      ledger.nextId++;
      ledger.entries.push(entry);
      if (ledger.entries.length > WORLD_LEDGER_LIMIT) ledger.entries.splice(0, ledger.entries.length - WORLD_LEDGER_LIMIT);
      return entry.id;
    } });
}

export function collectWorldLedgerReferences(state) {
  return (state.worldLedger?.entries ?? []).flatMap(entry => ledgerReferenceSpecs(entry).map(spec =>
    entityReference(`worldLedger.entries.${entry.id}.${spec.path}`, atPath(entry, spec.path), spec.role)));
}

const filters = ['type', 'actorId', 'targetId', 'locationId', 'areaId', 'since', 'until', 'afterId', 'minImportance', 'limit'];
function validateQuery(query) {
  fields(query, filters, false);
  if (Object.hasOwn(query, 'type')) ledgerType(query.type);
  for (const key of ['actorId', 'targetId', 'locationId', 'areaId']) if (Object.hasOwn(query, key))
    ledgerCheck(query[key] === null || identity(query[key]), `query ${key}`);
  for (const key of ['since', 'until']) if (Object.hasOwn(query, key)) ledgerCheck(time(query[key]), `query ${key}`);
  if (Object.hasOwn(query, 'afterId')) ledgerCheck(integer(query.afterId), 'query cursor');
  if (Object.hasOwn(query, 'minImportance')) ledgerCheck(normalized(query.minImportance), 'query importance');
  if (Object.hasOwn(query, 'limit')) ledgerCheck(integer(query.limit) && query.limit <= WORLD_LEDGER_LIMIT, 'query limit');
  ledgerCheck(query.since === undefined || query.until === undefined || query.since <= query.until, 'query time range');
}
function recent(state, query, involvedId) {
  validateQuery(query);
  const result = [], entries = state.worldLedger.entries, limit = query.limit ?? WORLD_LEDGER_LIMIT;
  for (let i = entries.length - 1; i >= 0 && result.length < limit; i--) {
    const entry = entries[i];
    if (['type', 'actorId', 'targetId', 'locationId', 'areaId'].some(key => Object.hasOwn(query, key) && entry[key] !== query[key])) continue;
    if (query.since !== undefined && entry.time < query.since || query.until !== undefined && entry.time > query.until ||
        query.afterId !== undefined && entry.id <= query.afterId || query.minImportance !== undefined && entry.importance < query.minImportance) continue;
    if (involvedId !== undefined && !ledgerReferenceSpecs(entry).some(spec => atPath(entry, spec.path) === involvedId)) continue;
    result.push(structuredClone(entry));
  }
  return result;
}
export const recentLedgerEntries = (state, query = {}) => recent(state, query);
export function ledgerEntriesForEntity(state, id, query = {}) {
  ledgerCheck(identity(id), 'query entity');
  return recent(state, query, id);
}
export function ledgerEntriesAtLocation(state, id, query = {}) {
  ledgerCheck(identity(id), 'query location'); validateQuery(query);
  ledgerCheck(!Object.hasOwn(query, 'locationId') || query.locationId === id, 'conflicting query location');
  return recent(state, { ...query, locationId: id });
}
