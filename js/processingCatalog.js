import { validId, validateConditions, record } from './conditions.js';
import { compileQuantity, volumeUnits } from './quantities.js';
import { collectDiscoveryReferences, conditionEntityReferences } from './conditionReferences.js';

const check = (ok, message) => { if (!ok) throw new Error(`Invalid processing: ${message}.`); };
export function compileResourceNodes(source = [], content, stationary = true) {
  check(Array.isArray(source) && (!source.length || stationary), 'nodes require a stationary site');
  const result = {};
  for (const node of source) {
    check(record(node) && Object.keys(node).every(k => ['id','resourceId','initialReserveM3','tags'].includes(k)), 'node fields');
    check(validId(node.id) && !Object.hasOwn(result, node.id), 'node identity');
    check(content.items[node.resourceId]?.category === 'resource', 'node resource');
    check(Array.isArray(node.tags) && node.tags.every(validId) && new Set(node.tags).size === node.tags.length, 'node tags');
    const initialReserve = volumeUnits(node.initialReserveM3);
    check(initialReserve > 0, 'node reserve');
    result[node.id] = { ...structuredClone(node), initialReserve };
  }
  return result;
}
export function compileProcessingCatalog(source = [], content, world) {
  check(Array.isArray(source), 'process list');
  const definitions = {}, byCapability = {};
  const lines = value => {
    check(Array.isArray(value) && value.length > 0 && value.length <= 8, 'batch lines');
    const seen = new Set();
    return value.map(line => {
      check(record(line) && Object.keys(line).every(k => ['itemId','amount'].includes(k)), 'line fields');
      check(['resource','component'].includes(content.items[line.itemId]?.category) && !seen.has(line.itemId), 'line item');
      seen.add(line.itemId);
      const amount = compileQuantity(line.amount, line.itemId, content);
      check(amount > 0, 'positive batch amount');
      return { itemId: line.itemId, amount };
    });
  };
  for (const authored of source) {
    check(record(authored) && Object.keys(authored).every(k => ['id','name','kind','capability','duration','powerRate','inputs','outputs','sourceRequirements','batchM3','startConditions','hostKinds'].includes(k)), 'process fields (use startConditions)');
    check(validId(authored.id) && !Object.hasOwn(definitions, authored.id) && typeof authored.name === 'string' && authored.name.trim(), 'process identity');
    check(['extraction','refining'].includes(authored.kind), 'kind');
    check(validId(authored.capability) && Object.values(content.infrastructure).some(m => m.capabilities.includes(authored.capability)), 'capability');
    check(Number.isFinite(authored.duration) && authored.duration > 0 && Number.isFinite(authored.powerRate) && authored.powerRate >= 0, 'duration/power');
    const def = { ...structuredClone(authored), startConditions: authored.startConditions ?? {}, hostKinds: authored.hostKinds ?? ['site','ship'] };
    check(Array.isArray(def.hostKinds) && def.hostKinds.length > 0 && def.hostKinds.every(k => ['site','ship'].includes(k)), 'host kinds');
    validateConditions(def.startConditions, { content, world }, `processing.${def.id}.startConditions`);
    if (def.kind === 'refining') {
      check(def.batchM3 === undefined && def.sourceRequirements === undefined, 'refining source fields');
      def.inputs = lines(def.inputs); def.outputs = lines(def.outputs);
    } else {
      check(def.inputs === undefined && def.outputs === undefined, 'extraction output comes from node');
      check(record(def.sourceRequirements) && Object.keys(def.sourceRequirements).every(k => k === 'tags') && Array.isArray(def.sourceRequirements.tags) && def.sourceRequirements.tags.every(validId), 'source requirements');
      def.batchAmount = volumeUnits(def.batchM3); check(def.batchAmount > 0, 'extraction batch');
    }
    definitions[def.id] = def;
    (byCapability[def.capability] ??= []).push(def.id);
  }
  return { definitions, byCapability,
    discoveryReferences: collectDiscoveryReferences(Object.values(definitions).map(d => d.startConditions)),
    entityReferences: Object.values(definitions).flatMap(d => conditionEntityReferences(d.startConditions, `processing.${d.id}.startConditions`)) };
}
