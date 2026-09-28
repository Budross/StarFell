// Shared, read-only condition evaluation. Domain context is supplied by callers.
export const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
export const safeKey = value => typeof value === "string" && !!value.trim() && !["__proto__", "prototype", "constructor"].includes(value);
export const validId = value => safeKey(value) && /^[A-Za-z][A-Za-z0-9_-]*$/.test(value);
export function requireValid(ok, message) { if (!ok) throw new Error(message); }

export function validateConditions(value = {}, refs = {}, path = "conditions", depth = 0) {
  const check = (ok, detail) => requireValid(ok, `Invalid ${path}: ${detail}.`);
  check(record(value) && depth <= 16, "expected a condition object (maximum depth 16)");
  for (const [key, entries] of Object.entries(value)) {
    if (key === "all" || key === "any") {
      check(Array.isArray(entries) && entries.length > 0, `${key} needs children`);
      entries.forEach((child, i) => validateConditions(child, refs, `${path}.${key}[${i}]`, depth + 1));
    } else if (key === "not") validateConditions(entries, refs, `${path}.not`, depth + 1);
    else if (key === "locationFlags" || key === "npcFlags") {
      check(record(entries), `${key} needs targets`);
      for (const [target, flags] of Object.entries(entries)) {
        check(validId(target), "invalid target");
        const definitions = key === "locationFlags" ? refs.world?.definitions : refs.npcs;
        check(!definitions || (key === "npcFlags" && target === "speaker") || Object.hasOwn(definitions, target), `unknown target ${target}`);
        check(Array.isArray(flags) && flags.every(safeKey), "invalid flag keys");
      }
    } else {
      check(["locations", "discoveries", "flags", "localFlags", "equipment", "capabilities", "met", "completed"].includes(key), `unknown operator ${key}`);
      check(Array.isArray(entries) && entries.every(["flags", "localFlags", "discoveries"].includes(key) ? safeKey : validId), `invalid ${key}`);
      const definitions = { locations: refs.world?.definitions, equipment: refs.content?.infrastructure, met: refs.npcs, completed: refs.conversations }[key];
      if (definitions) check(entries.every(id => Object.hasOwn(definitions, id)), `unknown ${key} reference`);
    }
  }
}

export function needsBlockedReason(value = {}) {
  return Object.hasOwn(value, "any") || Object.hasOwn(value, "not") || (value.all ?? []).some(needsBlockedReason);
}

export function conditionReason(state, conditions = {}, content, context = {}) {
  // Check the whole tree before short-circuit evaluation can hide a missing dependency.
  function dependencies(value = {}) {
    for (const [field, query] of [["equipment", "isOperational"], ["capabilities", "hasCapability"]]) {
      if (value[field]?.length && typeof context.queries?.[query] !== "function") throw new Error(`Missing condition query: ${query}.`);
    }
    if (value.completed?.length && typeof context.isCompleted !== "function") throw new Error("Missing condition query: isCompleted.");
    if (Object.hasOwn(value.npcFlags ?? {}, "speaker") && !validId(context.npcId)) throw new Error("Missing condition context: speaker.");
    (value.all ?? []).forEach(dependencies); (value.any ?? []).forEach(dependencies);
    if (value.not) dependencies(value.not);
  }
  dependencies(conditions);
  return evaluate(state, conditions, content, context);
}

function evaluate(state, conditions, content, context) {
  const root = context.root ?? state;
  const fail = "This option is not available right now.";
  for (const child of conditions.all ?? []) {
    const reason = evaluate(state, child, content, context);
    if (reason) return reason;
  }
  if (conditions.any && !conditions.any.some(child => !evaluate(state, child, content, context))) return fail;
  if (conditions.not && !evaluate(state, conditions.not, content, context)) return fail;
  if (conditions.locations?.length && !conditions.locations.includes(state.locationId)) return "Requires a different location.";
  if (conditions.discoveries?.some(id => root.knowledge?.discoveries[id] !== true)) return "Requires a discovery.";
  if (conditions.flags?.some(id => root.flags?.[id] !== true)) return "Requires further investigation.";
  if (conditions.localFlags?.some(id => state.localFlags?.[id] !== true)) return "Requires local investigation.";
  if (Object.entries(conditions.locationFlags ?? {}).some(([id, flags]) => flags.some(flag => root.locations?.[id]?.flags?.[flag] !== true))) return "Requires further investigation.";
  if (Object.entries(conditions.npcFlags ?? {}).some(([id, flags]) => flags.some(flag => root.npcs?.[id === "speaker" ? context.npcId : id]?.flags?.[flag] !== true))) return "Requires further conversation.";
  if (conditions.met?.some(id => root.dialogue?.met?.[id] !== true)) return "You have not met this person yet.";
  if (conditions.completed?.some(id => !context.isCompleted?.(id))) return "Requires an earlier conversation.";
  const active = id => context.queries.isOperational(id);
  if (conditions.equipment?.some(id => !active(id))) return "Requires operational equipment.";
  if (conditions.capabilities?.some(capability => !context.queries.hasCapability(capability))) return "Requires additional equipment capability.";
  return "";
}
