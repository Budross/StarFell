import { isEntityActive } from "./entities.js";
import { safeKey } from "./conditions.js";

// Scope and target binding are explicit; callers resolve current/speaker first.
export function setScopedFlag(state, scope, targetId, flag, value = true) {
  if (scope !== "global" && state.entities && !isEntityActive(state, targetId)) throw new Error("Flag target is unavailable.");
  if (!safeKey(flag) || typeof value !== "boolean") throw new Error("Invalid flag.");
  const flags = scope === "global" ? state.flags
    : scope === "npc" ? state.npcs[targetId].flags
    : scope === "location" ? state.locations[targetId].flags : null;
  if (!flags) throw new Error("Invalid flag scope or target.");
  flags[flag] = value;
}
