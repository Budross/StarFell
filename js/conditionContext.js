import { conditionReason as evaluate } from "./conditions.js";
import { isOperational, hasCapability } from "./equipment.js";
import { installedEquipmentOperational, hasEquipmentCapability } from './equipmentQuery.js';

// Runtime adapter; each call binds queries to its current local read projection.
export function conditionReason(state, conditions = {}, content, context = {}) {
  return evaluate(state, conditions, content, { ...context, queries: {
    isOperational: id => state.locations && state.locationId ? installedEquipmentOperational(context.root ?? state, { hostId: state.locationId, equipmentId: id }) : isOperational(state.infrastructure, id),
    hasCapability: id => state.locations && state.locationId ? hasEquipmentCapability(context.root ?? state, state.locationId, id, content) : hasCapability(state.infrastructure, id, content),
    ...context.queries
  } });
}
