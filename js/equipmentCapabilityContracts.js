import { processingEquipmentContracts } from './processingEquipmentContracts.js';
import { communicationsEquipmentContracts } from './communicationsContracts.js';

const id = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value) && !['constructor', 'prototype', '__proto__'].includes(value);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (path, message) => { throw Object.assign(new Error(`Invalid equipment ${path}: ${message}.`), { path }); };
export const canonicalCapabilityType = type => type === 'radio' ? 'radioCommunication' : type;

// Construction only: content cannot register services or extend the vocabulary.
export function createEquipmentCapabilityContracts(entries) {
  const result = {};
  for (const entry of entries) {
    if (!record(entry) || !id(entry.type) || canonicalCapabilityType(entry.type)!==entry.type || Object.hasOwn(result, entry.type) || !id(entry.owner) ||
        typeof entry.label !== 'string' || !entry.label.trim() || typeof entry.summary !== 'string' || !entry.summary.trim() ||
        !Array.isArray(entry.consumers) || !entry.consumers.length || new Set(entry.consumers).size!==entry.consumers.length || entry.consumers.some(c => !id(c)) ||
        Object.keys(entry).some(k => !['type', 'owner', 'label', 'summary', 'consumers'].includes(k))) fail('contracts', 'unknown, duplicate, or invalid domain contract');
    result[entry.type] = Object.freeze({ ...entry, consumers: Object.freeze([...entry.consumers]) });
  }
  return Object.freeze(result);
}
export const EQUIPMENT_CAPABILITY_CONTRACTS = createEquipmentCapabilityContracts([
  ...processingEquipmentContracts, ...communicationsEquipmentContracts,
  { type: 'fabrication', owner: 'crafting', label: 'Fabrication', summary: 'Supports compatible fabrication and assembly recipes.', consumers: ['crafting', 'processing', 'shipyard'] },
  { type: 'benchAnalysis', owner: 'research', label: 'Bench Analysis', summary: 'Supports compatible instrumented bench research.', consumers: ['research'] }
]);

export function requireCapability(type, contracts = EQUIPMENT_CAPABILITY_CONTRACTS, path = 'capability', consumer) {
  const canonical = canonicalCapabilityType(type), contract = contracts[canonical];
  if (!id(canonical) || !Object.hasOwn(contracts, canonical) || consumer && !contract.consumers.includes(consumer)) fail(path, `unknown or unsupported capability ${type}`);
  return canonical;
}
export function compileEquipmentCapabilities(declarations = [], contracts = EQUIPMENT_CAPABILITY_CONTRACTS, path = 'capabilities') {
  if (!Array.isArray(declarations) || declarations.length > Object.keys(contracts).length) fail(path, 'expected bounded capability declarations');
  const seen = new Set();
  return declarations.map((declaration, index) => {
    const at = `${path}.${index}`, value = typeof declaration === 'string' ? { type: declaration } : declaration;
    if (!record(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'type')) fail(at, 'unsupported capability fields; capabilities are declarative data');
    const type = requireCapability(value.type, contracts, at);
    if (seen.has(type)) fail(at, `duplicate capability ${type}`);
    seen.add(type);
    return Object.freeze({ type });
  });
}

export function equipmentCapabilityAuthoring(contracts = EQUIPMENT_CAPABILITY_CONTRACTS, consumer) {
  return Object.values(contracts).filter(c => !consumer || c.consumers.includes(consumer)).map(c => structuredClone(c));
}
