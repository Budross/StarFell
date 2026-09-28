import { record, safeKey, validId } from "./conditions.js";
import { compileQuantity } from "./quantities.js";
import { entityReference } from "./entityReferences.js";
import { normalizeCreationSpec } from "./entityCreationSpec.js";

const check = (ok, path, message) => { if (!ok) throw new Error(`Invalid ${path}: ${message}.`); };
const locationTypes = ["site", "ship"];
const allTypes = ["area", "site", "ship", "npc", "principal"];
function fields(effect, allowed, path) {
  check(record(effect) && Object.keys(effect).every(k => ["type", ...allowed].includes(k)), path, "unknown effect field");
}
function reference(source, targetId, types, role = "content") {
  const ref = entityReference(source, targetId, role);
  return { kind: "entity", ...ref, types: [...types], lifecycle: [...ref.lifecycle] };
}
const contact = targetId => ({ kind: "contact", targetId });
const creationTargets = { areaId: ["area"], locationId: locationTypes, dockedAtId: ["site"], ownerId: ["npc", "principal"], controllerId: ["npc", "principal"] };
function describeCreation(effect, path) {
  const spec = effect.spec;
  return [
    ...(spec.type === "principal" ? [] : [{ kind: "definition", source: path, catalog: spec.type === "npc" ? "npcs" : "locations", id: spec.definitionId, type: spec.type }]),
    ...Object.entries(creationTargets).filter(([key]) => spec[key] != null).map(([key, types]) => reference(`${path}.spec.${key}`, spec[key], types)),
    ...Object.keys(spec.access?.grants ?? {}).map(id => reference(`${path}.spec.access.grants`, id, ["npc", "principal"]))
  ];
}
function freezeTree(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freezeTree); Object.freeze(value); }
  return value;
}
function resolveTarget(id, trigger) {
  if (id === "current") {
    if (!validId(trigger.locationId)) throw new Error("Missing effect context: current location.");
    return trigger.locationId;
  }
  if (id === "speaker") {
    if (trigger.kind !== "dialogue" || !validId(trigger.npcId)) throw new Error("Missing effect context: speaker.");
    return trigger.npcId;
  }
  if (!validId(id)) throw new Error("Invalid effect target.");
  return id;
}

// Descriptors are immutable data. Domain execution is supplied per game, never registered globally.
const descriptors = {
  setFlag: {
    service: "setFlag",
    compile(effect, refs, path) {
      fields(effect, ["scope", "target", "flag", "value"], path);
      check(["global", "location", "npc"].includes(effect.scope) && safeKey(effect.flag) && typeof effect.value === "boolean", path, "invalid flag effect");
      check(effect.scope !== "global" || effect.target === undefined, path, "global flag cannot have a target");
      return { ...effect };
    },
    describe: (effect, path) => [{ kind: "flagWrite", scope: effect.scope, targetId: effect.target, flag: effect.flag, value: effect.value },
      ...(effect.scope === "global" ? [] : [reference(path, effect.target,
        effect.scope === "npc" ? ["npc"] : locationTypes, effect.scope === "npc" ? "historyNpc" : "historyLocation")])],
    execute: (state, effect, services, trigger) => services.setFlag(state, effect.scope,
      effect.scope === "global" ? null : resolveTarget(effect.target, trigger), effect.flag, effect.value)
  },
  discover: {
    service: "discover",
    compile(effect, refs, path) {
      fields(effect, ["id"], path); check(safeKey(effect.id), path, "invalid discovery ID"); return { ...effect };
    },
    describe: effect => [{ kind: "discovery", id: effect.id, access: "produce" }],
    execute: (state, effect, services) => services.discover(state, effect.id)
  },
  relocate: {
    service: "relocate",
    compile(effect, refs, path) { fields(effect, ["npcId", "destinationId"], path); return { ...effect }; },
    describe: (effect, path) => [reference(path, effect.npcId, ["npc"], "historyNpc"),
      reference(path, effect.destinationId, locationTypes, "historyLocation"), contact(effect.npcId)],
    execute: (state, effect, services, trigger) => services.relocate(state,
      resolveTarget(effect.npcId, trigger), resolveTarget(effect.destinationId, trigger), trigger)
  },
  grantItem: {
    service: "grantItem",
    compile(effect, refs, path) {
      fields(effect, ["itemId", "amount", "destinationId"], path);
      check(validId(effect.itemId) && !!refs.content && Object.hasOwn(refs.content.items, effect.itemId), path, "unknown granted item");
      const amount = compileQuantity(effect.amount, effect.itemId, refs.content);
      check(Number.isSafeInteger(amount) && amount > 0, path, "grant needs a positive quantity");
      return { ...effect, amount, destinationId: effect.destinationId === undefined ? "current" : effect.destinationId };
    },
    describe: (effect, path) => [reference(path, effect.destinationId, locationTypes, "historyLocation")],
    execute: (state, effect, services, trigger) => services.grantItem(state,
      resolveTarget(effect.destinationId, trigger), effect.itemId, effect.amount)
  },
  deactivateEntity: {
    service: "deactivateEntity",
    compile(effect, refs, path) {
      fields(effect, ["targetId", "reason"], path);
      check(effect.reason === undefined || typeof effect.reason === "string", path, "invalid lifecycle reason");
      return { ...effect };
    },
    describe: (effect, path) => [reference(path, effect.targetId, allTypes), contact(effect.targetId)],
    execute: (state, effect, services, trigger) => services.deactivateEntity(state,
      resolveTarget(effect.targetId, trigger), { reason: effect.reason ?? "" }, trigger)
  },
  spawnEntity: {
    service: "spawnEntity",
    validateReferences: (effect, refs) => normalizeCreationSpec(effect.spec, refs),
    compile(effect, refs, path) {
      fields(effect, ["spec"], path);
      return { type: effect.type, spec: freezeTree(normalizeCreationSpec(effect.spec, refs, { authored: true })) };
    },
    describe: describeCreation,
    execute(state, effect, services, trigger) {
      // Creation primitives receive their own mutable copy, never catalog data.
      const spec = structuredClone(effect.spec);
      for (const key of Object.keys(creationTargets)) if (spec[key] != null) spec[key] = resolveTarget(spec[key], trigger);
      if (spec.access) spec.access.grants = Object.fromEntries(Object.entries(spec.access.grants).map(([id, permissions]) => [resolveTarget(id, trigger), permissions]));
      return services.spawnEntity(state, spec, trigger);
    }
  },
  activateEntity: {
    service: "activateEntity",
    compile(effect, refs, path) {
      fields(effect, ["targetId", "reason"], path);
      check(effect.reason === undefined || typeof effect.reason === "string", path, "invalid lifecycle reason");
      return { ...effect };
    },
    describe: (effect, path) => [reference(path, effect.targetId, allTypes)],
    execute: (state, effect, services, trigger) => services.activateEntity(state, resolveTarget(effect.targetId, trigger), { reason: effect.reason ?? "" }, trigger)
  },
  activateLocation: {
    service: "activateEntity",
    compile(effect, refs, path) {
      fields(effect, ["targetId", "reason"], path);
      check(effect.reason === undefined || typeof effect.reason === "string", path, "invalid lifecycle reason");
      return { ...effect };
    },
    describe: (effect, path) => [reference(path, effect.targetId, locationTypes)],
    execute(state, effect, services, trigger) {
      const id = resolveTarget(effect.targetId, trigger);
      if (!locationTypes.includes(state.entities?.[id]?.type)) throw new Error("Location activation requires a site or ship.");
      return services.activateEntity(state, id, { reason: effect.reason ?? "" }, trigger);
    }
  }
};
export const effectRegistry = Object.freeze(Object.fromEntries(Object.entries(descriptors).map(([id, descriptor]) => [id, Object.freeze(descriptor)])));

function descriptorFor(effect, path) {
  check(record(effect) && Object.hasOwn(effectRegistry, effect.type), path, `unknown effect ${effect?.type}`);
  return effectRegistry[effect.type];
}

export function describeEffects(effects = [], path = "effects") {
  return effects.flatMap((effect, i) => descriptorFor(effect, `${path}[${i}]`).describe(effect, `${path}[${i}]`));
}

// Partial catalogs validate what they know; final composition supplies complete references.
export function validateEffectReferences(effects, refs = {}, trigger = {}, path = "effects") {
  for (const effect of effects) {
    try { descriptorFor(effect, path).validateReferences?.(effect, refs); }
    catch (error) { throw new Error(`Invalid ${path}: ${error.message}`); }
  }
  for (const ref of describeEffects(effects, path).filter(r => r.kind === "entity")) {
    const id = ref.targetId;
    check(validId(id), ref.source, "invalid target ID");
    if (id === "speaker") {
      check(trigger.kind === "dialogue" && ref.types.includes("npc"), ref.source, "speaker requires dialogue and an NPC target");
      continue;
    }
    if (id === "current") {
      check(ref.types.some(t => locationTypes.includes(t)), ref.source, "current requires a location target");
      continue;
    }
    const npc = refs.npcs?.[id], location = refs.world?.definitions?.[id];
    const principal = id === "player" || Object.hasOwn(refs.principals ?? refs.world?.principals ?? {}, id);
    const type = npc?.spawn !== false && npc ? "npc" : location?.spawn !== false && location ?
      (location.mobile ? "ship" : location.kind) : principal ? "principal" : null;
    const catalogsReady = ref.types.every(t => t === "npc" ? !!refs.npcs : t === "principal" ?
      !!(refs.principals ?? refs.world?.principals) : !!refs.world);
    check(type ? ref.types.includes(type) : !refs.complete && !catalogsReady, ref.source, `unknown or incompatible target ${id}`);
  }
}

export function compileEffects(value = [], refs = {}, trigger = {}, path = "effects") {
  check(Array.isArray(value), path, "expected an effect array");
  const compiled = Array.from(value, (effect, i) => {
    const source = `${path}[${i}]`;
    try { return Object.freeze(descriptorFor(effect, source).compile(effect, refs, source)); }
    catch (error) { throw new Error(error.message.startsWith(`Invalid ${source}:`) ? error.message : `Invalid ${source}: ${error.message}`); }
  });
  validateEffectReferences(compiled, refs, trigger, path);
  return Object.freeze(compiled);
}

export function applyEffects(state, effects, services, trigger = {}) {
  const captured = Object.freeze({ kind: trigger.kind, locationId: trigger.locationId, npcId: trigger.npcId, actorId: trigger.actorId });
  if (!Array.isArray(effects)) throw new Error("Expected compiled effect array.");
  // Preflight context and services before any mutation, including unreachable later effects.
  for (const effect of effects) {
    const descriptor = descriptorFor(effect, "effects");
    if (typeof services?.[descriptor.service] !== "function") throw new Error(`Missing effect service: ${descriptor.service}.`);
    for (const ref of descriptor.describe(effect, "effects").filter(r => r.kind === "entity")) {
      resolveTarget(ref.targetId, captured);
      if (ref.targetId === "speaker" && !ref.types.includes("npc") || ref.targetId === "current" && !ref.types.some(t => locationTypes.includes(t))) throw new Error("Invalid contextual effect target.");
    }
  }
  for (const effect of effects) {
    const result = descriptorFor(effect, "effects").execute(state, effect, services, captured);
    if (result && typeof result.then === "function") throw new Error("Effect services must execute synchronously.");
  }
}
