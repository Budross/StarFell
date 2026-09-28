// Saved identity only. Domain state, definitions and permissions are separate.
export const entityTypes = ["area", "site", "ship", "npc", "principal"];
export const lifecycles = ["active", "inactive", "destroyed", "retired"];
export const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
export const validEntityId = id => typeof id === "string" && /^[A-Za-z][A-Za-z0-9_-]*$/.test(id) && !["constructor", "prototype", "__proto__"].includes(id);
export const getEntity = (state, id) => Object.hasOwn(state.entities ?? {}, id) ? state.entities[id] : undefined;
export const hasEntity = (state, id) => !!getEntity(state, id);
export const isEntityActive = (state, id) => getEntity(state, id)?.lifecycle === "active";
export const isTerminal = entity => ["destroyed", "retired"].includes(entity?.lifecycle);
export const isPrincipal = entity => entity?.type === "npc" || entity?.type === "principal";
export const entitySequence = id => /^gen_(?:area|site|ship|npc|principal)_(\d+)$/.exec(id)?.[1];
export function listEntities(state, { types = entityTypes, lifecycle = lifecycles } = {}) {
  return Object.values(state.entities).filter(e => types.includes(e.type) && lifecycle.includes(e.lifecycle));
}
export function allocateEntityId(state, type) {
  if (!entityTypes.includes(type)) throw new Error("Unknown entity type.");
  const n = state.entityIds.next;
  if (!Number.isSafeInteger(n) || n < 1 || n >= Number.MAX_SAFE_INTEGER) throw new Error("Entity ID counter is full or invalid.");
  const id = `gen_${type}_${n}`;
  if (hasEntity(state, id)) throw new Error(`Entity ID collision: ${id}.`);
  state.entityIds.next++;
  return id;
}
export function makeEntity(id, type, definition, time = 0, options = {}) {
  return { id, type, definition, origin: options.origin ?? "authored", lifecycle: options.lifecycle ?? "active",
    createdAt: time, lifecycleChangedAt: time, lifecycleReason: "", displayName: options.displayName ?? null,
    ownerId: options.ownerId ?? null, controllerId: options.controllerId ?? null,
    access: structuredClone(options.access ?? { public: [], grants: {} }), retained: null,
    ...(type === "principal" ? { role: options.role ?? "organization" } : {}) };
}
export function validateEntities(state) {
  const fail = detail => { throw new Error(`Invalid entity registry: ${detail}.`); };
  if (!record(state.entities) || !record(state.entityIds) || !Number.isSafeInteger(state.entityIds.next) || state.entityIds.next < 1) fail("structure/counter");
  for (const [id, e] of Object.entries(state.entities)) {
    if (!validEntityId(id) || !record(e) || e.id !== id || !entityTypes.includes(e.type) || !lifecycles.includes(e.lifecycle)) fail(`identity ${id}`);
    if (!["authored", "generated", "legacy"].includes(e.origin)) fail(`origin ${id}`);
    if (![e.createdAt, e.lifecycleChangedAt].every(t => Number.isFinite(t) && t >= 0 && t <= state.simulationTime) || e.lifecycleChangedAt < e.createdAt) fail(`time ${id}`);
    if (typeof e.lifecycleReason !== "string" || !(e.displayName === null || typeof e.displayName === "string" && e.displayName.trim())) fail(`label ${id}`);
    if (e.definition === null) {
      if (e.type !== "principal" && !(e.origin === "legacy" && isTerminal(e))) fail(`missing definition ${id}`);
    } else if (!record(e.definition) || !["locations", "npcs"].includes(e.definition.catalog) || !validEntityId(e.definition.id) ||
      e.definition.catalog !== (e.type === "npc" ? "npcs" : "locations") || e.type === "principal") fail(`definition ${id}`);
    if (e.type === "principal" && !["player", "organization", "legacy"].includes(e.role)) fail(`principal role ${id}`);
    if (e.role === "player" && id !== "player") fail(`duplicate player ${id}`);
    if (e.ownerId !== null && !validEntityId(e.ownerId) || e.controllerId !== null && !validEntityId(e.controllerId)) fail(`authority ${id}`);
    if (!["site", "ship", "area"].includes(e.type) && (e.ownerId !== null || e.controllerId !== null)) fail(`non-ownable ${id}`);
    if (e.ownerId === id || e.controllerId === id) fail(`self authority ${id}`);
    if (e.retained !== null && (!record(e.retained) || typeof e.retained.name !== "string" || !e.retained.name.trim() || !record(e.retained.location))) fail(`retained identity ${id}`);
    if (isTerminal(e) && !e.retained) fail(`missing retained identity ${id}`);
    const sequence = entitySequence(id);
    if (e.origin === "generated" && !sequence || sequence !== undefined && (!Number.isSafeInteger(Number(sequence)) || Number(sequence) < 1 || Number(sequence) >= state.entityIds.next)) fail(`sequence ${id}`);
  }
  const player = getEntity(state, "player");
  if (player?.type !== "principal" || player.role !== "player" || !isEntityActive(state, "player")) fail("player identity");
}
