// Meaning of manufacture, independent of UI, duration or execution owner.
export const MANUFACTURING_OPERATIONS = Object.freeze(['refining', 'fabrication', 'assembly']);
const outputs = Object.freeze({ refining: 'resource', fabrication: 'component', assembly: 'product' });
export const operationForCategory = category => MANUFACTURING_OPERATIONS.find(operation => outputs[operation] === category);
export function manufacturingInputAllowed(category, operation) {
  return MANUFACTURING_OPERATIONS.includes(operation) && ['resource', 'component'].includes(category) &&
    (operation !== 'refining' || category === 'resource');
}
export function validateManufacturing(operation, inputs, results, items, { legacyInputs = false } = {}) {
  if (!MANUFACTURING_OPERATIONS.includes(operation)) throw new Error('Unknown manufacturing operation.');
  if (!results.length || results.some(id => items[id]?.category !== outputs[operation]))
    throw new Error(`${operation} must produce ${outputs[operation]} items only.`);
  if (!inputs.length || inputs.some(id => !manufacturingInputAllowed(items[id]?.category, operation) &&
      !(legacyInputs && items[id]?.category === 'component')))
    throw new Error(`Invalid ${operation} ingredient; finished Products cannot be manufacturing inputs.`);
  return operation;
}
