import { permissionReason } from "./authority.js";
// Each game has its own registry and live state connection.
export function createActionRegistry() {
  const actions = new Map();
  const commands = new Map();
  let connection = null;

  function normalize(command) {
    return String(command).trim().toLowerCase().replace(/^\[(\d+)\]$/, "$1");
  }
  function samePayload(a, b) {
    return a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b) &&
      Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && a[k] === b[k]);
  }

  function registerAction(definition) {
    const { id, name, execute, aliases = [], shortcut = "", order = 0 } = definition;
    if (typeof id !== "string" || !id.trim() || typeof name !== "string" || !name.trim() ||
        typeof execute !== "function" || !Array.isArray(aliases) ||
        aliases.some(alias => typeof alias !== "string" || !alias.trim()) ||
        typeof shortcut !== "string" || (shortcut && !/^[1-9]$/.test(shortcut)) ||
        !Number.isFinite(order)) {
      throw new Error("An action needs an ID, name, execute function, and valid command metadata.");
    }
    for (const key of ["visible", "requirement"]) {
      if (definition[key] !== undefined && typeof definition[key] !== "function") {
        throw new Error(`Action ${id}: ${key} must be a function.`);
      }
    }
    if (actions.has(id)) throw new Error(`Action already registered: ${id}`);

    const names = new Set([id, name, ...aliases, shortcut].filter(Boolean).map(normalize));
    for (const command of names) {
      if (connection && !connection.getContext && commands.has(command)) throw new Error(`Action command already registered: ${command}`);
    }

    connection?.validateActions?.([...actions.values(), definition]);
    actions.set(id, Object.freeze({ ...definition, aliases: Object.freeze([...aliases]), shortcut, order }));
    for (const command of names) commands.set(command, [...(commands.get(command) ?? []), id]);
  }

  // Only app.js connects the registry to the current state and save lifecycle.
  function initializePlayerActions({ getState, applyAction, getContext, validateActions }) {
    if (connection) throw new Error("Player actions have already been initialized.");
    if (typeof getState !== "function" || typeof applyAction !== "function") {
      throw new Error("Player actions need getState and applyAction functions.");
    }
    validateActions?.([...actions.values()]);
    connection = { getState, applyAction, getContext, validateActions };
  }

  function currentState() {
    if (!connection) throw new Error("Player actions have not been initialized.");
    return connection.getState();
  }

  function inspect(action, state, payload) {
    payload = action.boundPayload ?? payload;
    const context = connection?.getContext?.(state);
    const assigned = !context || action.scope === "global" || (action.locations ? action.locations.includes(context.id) : context.actionIds.includes(action.id));
    const visible = assigned && (action.visible ? action.visible(state, context, payload) : true);
    if (typeof visible !== "boolean") throw new Error(`Action ${action.id}: visible must return a boolean.`);
    const required = action.permissions ?? (action.access === "managed" ? ["useFacilities", "withdrawCargo", "depositCargo"] : []);
    const denied = context ? required.map(p => permissionReason(state, "player", context.id, p)).find(Boolean) : "";
    const reason = visible ? denied || (action.requirement ? action.requirement(state, context, payload) : "") : "This action is not available here.";
    if (typeof reason !== "string") throw new Error(`Action ${action.id}: requirement must return a string.`);
    return {
      id: action.id,
      name: action.name,
      description: action.description ?? "",
      group: action.group ?? "directives",
      shortcut: action.shortcut,
      visible,
      available: visible && !reason,
      reason
    };
  }

  function expanded(state) {
    const context = connection?.getContext?.(state);
    return [...actions.values()].flatMap(action => action.targets ? action.targets(state, context).map(target =>
      ({ ...action, id: target.id, name: target.name, aliases: [], shortcut: "", boundPayload: target.payload })) : [action]);
  }
  function lookup(id, state, payload) {
    const base = actions.get(id);
    if (base && !base.targets) return base;
    if (base?.targets) {
      const target = base.targets(state, connection?.getContext?.(state)).find(t => samePayload(t.payload, payload));
      return target ? { ...base, name: target.name, boundPayload: target.payload } : { ...base, visible: () => false };
    }
    return expanded(state).find(action => action.id === id);
  }

  function getActionStatus(id, payload) {
    const state = currentState();
    const action = lookup(id, state, payload);
    if (!action) throw new Error(`Unknown action: ${id}`);
    return inspect(action, state, payload);
  }

  function getActions(group = null) {
    const state = currentState();
    return expanded(state)
      .filter(action => group === null || (action.group ?? "directives") === group)
      .sort((a, b) => a.order - b.order)
      .map(action => inspect(action, state));
  }

  // Resolution does not grant permission: executeAction always checks current state.
  function resolveAction(command) {
    const matches = connection ? expanded(currentState()).filter(action => [action.id, action.name, ...(action.aliases ?? []), action.shortcut].filter(Boolean).some(name => normalize(name) === normalize(command))) : [];
    const eligible = connection ? matches.filter(action => inspect(action, currentState()).visible).map(a => a.id) : commands.get(normalize(command)) ?? [];
    if (eligible.length > 1) throw new Error("Ambiguous command. Use the full action ID.");
    return eligible[0] ?? null;
  }

  function executeAction(id, payload) {
    const initial = currentState();
    const action = lookup(id, initial, payload);
    if (!action) throw new Error(`Unknown action: ${id}`);

    return connection.applyAction(state => {
      if (payload && Object.hasOwn(payload, "actorId")) throw new Error("Player actions cannot choose an actor.");
      const liveAction = lookup(id, state, payload);
      if (!liveAction) throw new Error(`Unknown or unavailable action: ${id}`);
      const request = liveAction.boundPayload ?? payload;
      if (liveAction.boundPayload && payload !== undefined && !samePayload(payload, liveAction.boundPayload)) throw new Error("Action target payload does not match.");
      const status = inspect(liveAction, state, request);
      if (!status.available) throw new Error(status.reason);
      const message = liveAction.execute(state, connection.getContext?.(state), request);
      // This game's state/save transaction is synchronous.
      if (message !== undefined && typeof message !== "string") {
        throw new Error(`Action ${id}: execute must return a message string or undefined, synchronously.`);
      }
      return message;
    }, action, payload);
  }

  return { registerAction, initialize: initializePlayerActions, getActionStatus, getActions, resolveAction, executeAction };
}

// Existing standalone consumers retain their explicit initialize-once API.
const legacyRegistry = createActionRegistry();
export const { registerAction, getActionStatus, getActions, resolveAction, executeAction } = legacyRegistry;
export default legacyRegistry.initialize;
