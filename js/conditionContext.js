import { conditionReason as evaluate } from "./conditions.js";
import { isOperational, hasCapability } from "./equipment.js";

// Runtime adapter; each call binds queries to its current local read projection.
export function conditionReason(state, conditions = {}, content, context = {}) {
  return evaluate(state, conditions, content, { ...context, queries: {
    isOperational: id => isOperational(state.infrastructure, id),
    hasCapability: id => hasCapability(state.infrastructure, id, content),
    ...context.queries
  } });
}
