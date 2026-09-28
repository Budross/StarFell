import { safeKey } from "./conditions.js";

// Shared knowledge has no dependency on the system that taught it.
export function grantDiscovery(state, id) {
  if (!safeKey(id)) throw new Error("Invalid discovery ID.");
  if (state.knowledge.discoveries[id] === true) return false;
  state.knowledge.discoveries[id] = true;
  return true;
}
