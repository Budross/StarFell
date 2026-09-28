import { npcDefinition, locationDefinition } from "./entityQueries.js";
import { entityReference } from "./entityReferences.js";
import { compileEffects, describeEffects, applyEffects } from "./effects.js";
import { record, safeKey, validId, requireValid, validateConditions, needsBlockedReason } from "./conditions.js";
import { conditionReason } from "./conditionContext.js";
import { collectDiscoveryReferences, conditionEntityReferences } from "./conditionReferences.js";
import { contactReason, createNpcState, validateNpcState } from "./npcs.js";

const check = (ok, message) => requireValid(ok, `Invalid dialogue: ${message}.`);
const text = value => typeof value === "string" && !!value.trim();
const scopes = ["npc", "global", "npcLocation"];
export function suppliedConversations(npc, catalog) {
  return [...new Set(npc.dialogueGroups.flatMap(id => catalog.groups[id].conversations))].filter(id => !npc.excludeConversations.includes(id));
}

export function buildDialogueCatalog(source, npcs, world, content) {
  check(record(source) && record(source.groups) && record(source.conversations), "groups and conversations required");
  const catalog = structuredClone(source);
  catalog.warnings = [];
  const refs = { world, content, npcs, conversations: catalog.conversations };
  function conditions(owner, path) {
    for (const key of ["entryConditions", "visibilityConditions", "requirements"]) validateConditions(owner[key], refs, `${path}.${key}`);
    check(!needsBlockedReason(owner.requirements) || text(owner.blockedReason), `${path} requires blockedReason`);
  }
  function passage(value, path) {
    check(text(value), `${path} needs text`);
    check(![...value.matchAll(/\{([^{}]+)\}/g)].some(match => match[1] !== "speaker"), `${path} unknown text substitution`);
  }
  for (const [id, group] of Object.entries(catalog.groups)) {
    check(validId(id) && record(group) && Array.isArray(group.conversations) && group.conversations.every(c => Object.hasOwn(catalog.conversations, c)), `group ${id}`);
  }
  for (const [id, conversation] of Object.entries(catalog.conversations)) {
    check(validId(id) && record(conversation), `conversation ${id}`);
    conversation.id = id; conversation.priority ??= 0; conversation.order ??= 0;
    conversation.repeat ??= "repeatable"; conversation.scope ??= "npc";
    check(["greeting", "topic"].includes(conversation.role), `${id} role`);
    check(conversation.role === "greeting" ? conversation.topicId === undefined : validId(conversation.topicId) && text(conversation.label), `${id} topicId/label`);
    check(Number.isFinite(conversation.priority) && Number.isFinite(conversation.order), `${id} ordering`);
    check(["repeatable", "once"].includes(conversation.repeat) && scopes.includes(conversation.scope), `${id} repeat/scope`);
    conditions(conversation, id);
    check(record(conversation.nodes) && Object.hasOwn(conversation.nodes, conversation.entryNode), `${id} entry node`);
    for (const [nodeId, node] of Object.entries(conversation.nodes)) {
      const path = `${id}/${nodeId}`;
      check(validId(nodeId) && record(node), `${path} node`);
      passage(node.text, path);
      check(node.ending === undefined || typeof node.ending === "boolean", `${path} ending`);
      node.choices ??= [];
      check(Array.isArray(node.choices) && (!node.ending || node.choices.length === 0), `${path} choices`);
      const ids = new Set();
      for (const choice of node.choices) {
        check(record(choice) && validId(choice.id) && !ids.has(choice.id), `${path} duplicate/invalid choice`); ids.add(choice.id);
        passage(choice.text, `${path}/${choice.id}`); conditions(choice, `${path}/${choice.id}`);
        check(choice.terminal === undefined || typeof choice.terminal === "boolean", `${path} terminal`);
        check(choice.complete === undefined || typeof choice.complete === "boolean", `${path} complete`);
        if (choice.closingText !== undefined) passage(choice.closingText, `${path} closingText`);
        if (choice.terminal) { check(choice.destinationNode === undefined, `${path} terminal destination`); passage(choice.closingText, `${path} closingText`); }
        else check(Object.hasOwn(conversation.nodes, choice.destinationNode), `${path} destination node`);
        check(!choice.complete || choice.terminal, `${path} complete belongs to terminal choices`);
        choice.effects = compileEffects(choice.effects, { content, world, npcs }, { kind: "dialogue" }, `${path}/${choice.id}.effects`);
      }
      if (!node.ending && !node.choices.length) catalog.warnings.push(`${path}: no authored replies; player can return to topics or leave.`);
    }
    const reachable = new Set();
    const visit = nodeId => { if (reachable.has(nodeId)) return; reachable.add(nodeId); conversation.nodes[nodeId].choices.forEach(c => { if (!c.terminal) visit(c.destinationNode); }); };
    visit(conversation.entryNode);
    for (const nodeId of Object.keys(conversation.nodes)) if (!reachable.has(nodeId)) catalog.warnings.push(`${id}/${nodeId}: unreachable node.`);
    if (![...reachable].some(nodeId => conversation.nodes[nodeId].ending || conversation.nodes[nodeId].choices.some(c => c.terminal))) catalog.warnings.push(`${id}: no authored ending; explicit leave remains available.`);
  }
  for (const npc of Object.values(npcs)) {
    check(npc.dialogueGroups.every(id => Object.hasOwn(catalog.groups, id)), `${npc.id} unknown group`);
    check(npc.excludeConversations.every(id => Object.hasOwn(catalog.conversations, id)), `${npc.id} unknown exclusion`);
    for (const key of ["presenceConditions", "visibilityConditions", "interactionConditions"]) validateConditions(npc[key], refs, `${npc.id}.${key}`);
    const competitors = new Set();
    for (const id of suppliedConversations(npc, catalog)) {
      const conversation = catalog.conversations[id];
      const key = `${conversation.role}/${conversation.topicId ?? "greeting"}/${conversation.priority}`;
      if (competitors.has(key)) catalog.warnings.push(`${npc.id}/${id}: equal-priority topic alternatives; stable ID breaks ties.`);
      competitors.add(key);
      for (const node of Object.values(conversation.nodes)) for (const choice of node.choices) {
        if (describeEffects(choice.effects).some(m => m.kind === "contact" && ["speaker", npc.id].includes(m.targetId))) check(choice.terminal && !choice.destinationNode && text(choice.closingText), `${npc.id}/${id}/${choice.id} speaker contact change must be terminal with closing text`);
      }
    }
  }
  const entries = Object.values(catalog.conversations).flatMap(conversation => [conversation,
    ...Object.values(conversation.nodes).flatMap(node => node.choices)]);
  catalog.discoveryReferences = collectDiscoveryReferences(entries.flatMap(entry =>
    [entry.entryConditions, entry.visibilityConditions, entry.requirements]),
    entries.flatMap(entry => describeEffects(entry.effects).filter(m => m.kind === "discovery" && m.access === "produce").map(m => m.id)));
  catalog.entityReferences = entries.flatMap(entry => [
    ...[entry.entryConditions, entry.visibilityConditions, entry.requirements].flatMap(c => conditionEntityReferences(c, `dialogue:${entry.id}`)),
    ...describeEffects(entry.effects, `dialogue:${entry.id}`).filter(m => m.kind === "entity" && !["speaker", "current"].includes(m.targetId))
  ]);
  catalog.effectSources = Object.values(catalog.conversations).flatMap(conversation => Object.values(conversation.nodes).flatMap(node => node.choices.map(choice => ({
    path: `dialogue.${conversation.id}.${choice.id}.effects`, effects: choice.effects, trigger: { kind: "dialogue" }
  }))));
  return catalog;
}

export function createDialogueState() { return { nextSession: 1, active: null, met: {}, history: {} }; }
function historyKey(conversation, npcId, locationId) {
  return JSON.stringify([conversation.id, conversation.scope, conversation.scope === "global" ? null : npcId, conversation.scope === "npcLocation" ? locationId : null]);
}
export function isCompleted(state, system, conversationId, npcId, locationId = state.locationId) {
  const conversation = system.dialogue.conversations[conversationId];
  return !!conversation && state.dialogue.history[historyKey(conversation, npcId, locationId)]?.completed === true;
}
function progress(state, system) {
  const a = state.dialogue.active, conversation = system.dialogue.conversations[a.conversationId];
  return state.dialogue.history[historyKey(conversation, a.npcId, a.locationId)] ??= { completed: false, choices: {} };
}
function reason(state, system, npcId, conditions) {
  const context = system.context(state, npcId);
  return conditionReason(context.local, conditions, system.content, context);
}
function requirement(state, system, npcId, entry) {
  const result = reason(state, system, npcId, entry.requirements);
  return result ? entry.blockedReason || result : "";
}
export function resolveTopics(state, npcId, system) {
  const selected = new Map();
  for (const id of suppliedConversations(npcDefinition(state, system, npcId), system.dialogue)) {
    const c = system.dialogue.conversations[id];
    if (reason(state, system, npcId, c.visibilityConditions) || reason(state, system, npcId, c.entryConditions) || c.repeat === "once" && isCompleted(state, system, id, npcId)) continue;
    const key = c.role === "greeting" ? "greeting" : `topic:${c.topicId}`;
    const previous = selected.get(key);
    if (!previous || c.priority > previous.priority || c.priority === previous.priority && c.id < previous.id) selected.set(key, c);
  }
  return [...selected.values()].sort((a, b) => a.order - b.order || (a.topicId ?? "").localeCompare(b.topicId ?? "")).map(c => ({ ...c, reason: requirement(state, system, npcId, c) }));
}
export function explainTopics(state, npcId, system) {
  const winners = new Set(resolveTopics(state, npcId, system).map(c => c.id));
  return suppliedConversations(npcDefinition(state, system, npcId), system.dialogue).map(id => {
    const c = system.dialogue.conversations[id];
    return { id, reason: reason(state, system, npcId, c.visibilityConditions) || reason(state, system, npcId, c.entryConditions) || (c.repeat === "once" && isCompleted(state, system, id, npcId) ? "Already completed." : "") || (!winners.has(id) ? "Another variant has priority." : requirement(state, system, npcId, c)) };
  });
}
export function dialogueText(value, npcId, system, state = {}) { return value.replaceAll("{speaker}", npcDefinition(state, system, npcId).name); }
export function dialogueView(state, system) {
  const a = state.dialogue.active;
  if (!a) return null;
  const token = { sessionId: a.sessionId, revision: a.revision };
  const base = { ...a, token, name: npcDefinition(state, system, a.npcId).name };
  if (a.phase === "topics") return { ...base, text: "What would you like to discuss?", choices: resolveTopics(state, a.npcId, system).filter(c => c.role === "topic").map(c => ({ id: c.id, text: c.label, reason: c.reason })) };
  const node = system.dialogue.conversations[a.conversationId].nodes[a.nodeId];
  return { ...base, text: dialogueText(node.text, a.npcId, system, state), choices: node.choices.filter(c => !reason(state, system, a.npcId, c.visibilityConditions)).map(c => ({ id: c.id, text: dialogueText(c.text, a.npcId, system, state), reason: requirement(state, system, a.npcId, c) })) };
}
function enterNode(state, system, nodeId) {
  const a = state.dialogue.active, c = system.dialogue.conversations[a.conversationId];
  a.nodeId = nodeId; a.phase = c.nodes[nodeId].ending ? "ending" : "node";
  if (a.phase === "ending") progress(state, system).completed = true;
}
function enterConversation(state, system, id) {
  state.dialogue.active.conversationId = id;
  enterNode(state, system, system.dialogue.conversations[id].entryNode);
}
export function reconcileContact(state, system) {
  const a = state.dialogue.active;
  if (a && (a.locationId !== state.locationId || contactReason(state, a.npcId, system))) {
    const message = `Conversation with ${npcDefinition(state, system, a.npcId)?.name ?? "this person"} ended; local contact was lost.`;
    state.dialogue.active = null;
    return message;
  }
  return "";
}
// Caller provides the candidate state. This module never saves or publishes.
export function performDialogue(state, operation, payload = {}, system, effectServices) {
  if (operation === "start") {
    check(!state.dialogue.active, "end the current conversation before starting another");
    const blocked = contactReason(state, payload.npcId, system);
    if (blocked) throw new Error(blocked);
    const id = state.dialogue.nextSession++;
    state.dialogue.active = { npcId: payload.npcId, locationId: state.locationId, sessionId: id, revision: 0, phase: "topics", conversationId: null, nodeId: null };
    state.dialogue.met[payload.npcId] = true;
    const greeting = resolveTopics(state, payload.npcId, system).find(c => c.role === "greeting" && !c.reason);
    if (greeting) enterConversation(state, system, greeting.id);
    return "";
  }
  const a = state.dialogue.active;
  if (!a || payload.sessionId !== a.sessionId || payload.revision !== a.revision) throw new Error("The conversation has changed. Choose a current reply.");
  if (operation !== "leave") {
    const blocked = contactReason(state, a.npcId, system);
    if (blocked || a.locationId !== state.locationId) throw new Error(blocked || "Local contact was lost.");
  }
  a.revision++;
  if (operation === "leave") { state.dialogue.active = null; return `Conversation with ${npcDefinition(state, system, a.npcId).name} ended.`; }
  if (operation === "topics") { a.phase = "topics"; a.conversationId = null; a.nodeId = null; return ""; }
  if (operation === "topic") {
    check(a.phase === "topics", "return to topics first");
    const c = resolveTopics(state, a.npcId, system).find(c => c.role === "topic" && c.id === payload.id);
    check(c, "topic is no longer available"); if (c.reason) throw new Error(c.reason);
    enterConversation(state, system, c.id); return "";
  }
  check(operation === "choice" && a.phase === "node", "choice is not available");
  const c = system.dialogue.conversations[a.conversationId], node = c.nodes[a.nodeId];
  const choice = node.choices.find(c => c.id === payload.id);
  check(choice && !reason(state, system, a.npcId, choice.visibilityConditions), "reply is no longer available");
  const blocked = requirement(state, system, a.npcId, choice); if (blocked) throw new Error(blocked);
  const closing = choice.closingText ? dialogueText(choice.closingText, a.npcId, system, state) : "";
  const speakerName = npcDefinition(state, system, a.npcId).name;
  const trigger = { kind: "dialogue", npcId: a.npcId, locationId: a.locationId, actorId: 'player' };
  const p = progress(state, system), key = `${a.nodeId}/${choice.id}`;
  p.choices[key] = (p.choices[key] ?? 0) + 1;
  applyEffects(state, choice.effects, effectServices, trigger);
  if (choice.terminal) {
    if (choice.complete) p.completed = true;
    state.dialogue.active = null;
    return `${speakerName}: ${closing}`;
  }
  const ended = state.dialogue.active ? reconcileContact(state, system) : `Conversation with ${speakerName} ended; local contact was lost.`;
  if (ended) return closing ? `${speakerName}: ${closing}` : ended;
  enterNode(state, system, choice.destinationNode);
  return "";
}

// Shape checks are deliberately separate from content-reference recovery.
export function validateDialogueState(state, system, allowRetired = false) {
  const d = state.dialogue;
  check(record(d) && Number.isSafeInteger(d.nextSession) && d.nextSession > 0 && record(d.met) && record(d.history), "saved dialogue structure");
  check(Object.entries(d.met).every(([id, value]) => validId(id) && typeof value === "boolean"), "met history");
  for (const [key, entry] of Object.entries(d.history)) {
    let parts; try { parts = JSON.parse(key); } catch { check(false, "history key"); }
    check(Array.isArray(parts) && parts.length === 4 && validId(parts[0]) && scopes.includes(parts[1]) && (parts[1] === "global" ? parts[2] === null : validId(parts[2])) && (parts[1] === "npcLocation" ? validId(parts[3]) : parts[3] === null), "history scope");
    check(record(entry) && typeof entry.completed === "boolean" && record(entry.choices) && Object.entries(entry.choices).every(([id, count]) => safeKey(id) && Number.isSafeInteger(count) && count > 0), "choice history");
  }
  const a = d.active;
  if (a === null) return;
  check(record(a) && validId(a.npcId) && validId(a.locationId) && Number.isSafeInteger(a.sessionId) && a.sessionId > 0 && a.sessionId < d.nextSession && Number.isSafeInteger(a.revision) && a.revision >= 0 && ["topics", "node", "ending"].includes(a.phase), "active session");
  check(a.phase === "topics" ? a.conversationId === null && a.nodeId === null : validId(a.conversationId) && validId(a.nodeId), "active phase");
  if (!allowRetired) {
    check(activeContentValid(state, system), "active content references");
    check(a.locationId === state.locationId && !contactReason(state, a.npcId, system), "active local contact");
  }
}
function activeContentValid(state, system) {
  const a = state.dialogue.active, npc = npcDefinition(state, system, a.npcId);
  if (!npc || locationDefinition(state, system.world, a.locationId)?.kind !== "site") return false;
  if (a.phase === "topics") return true;
  const c = system.dialogue.conversations[a.conversationId], node = c?.nodes[a.nodeId];
  return !!node && suppliedConversations(npc, system.dialogue).includes(a.conversationId) && (a.phase === "ending") === !!node.ending;
}
export function reconcilePeopleContent(state, system) {
  check(record(state.npcs), "saved NPC records");
  if (!state.entities) check(Object.keys(state.npcs).every(id => Object.hasOwn(system.npcs, id)), "removed NPC requires migration");
  validateDialogueState(state, system, true);
  for (const [id, def] of Object.entries(system.npcs).filter(([, def]) => def.spawn !== false)) {
    if (state.entities) continue;
    if (!Object.hasOwn(state.npcs, id)) state.npcs[id] = createNpcState(def);
    validateNpcState(state.npcs[id], def, system.world, system.content);
  }
  if (state.dialogue.active && !activeContentValid(state, system)) {
    state.dialogue.active = null;
    return "Dialogue content changed. The previous conversation has closed; your choices and progress were preserved.";
  }
  return reconcileContact(state, system);
}

export function collectDialogueReferences(state) {
  const refs = Object.keys(state.dialogue.met).map(id => entityReference(`dialogue.met.${id}`, id, "historyNpc"));
  for (const key of Object.keys(state.dialogue.history)) {
    const [, , npcId, locationId] = JSON.parse(key);
    if (npcId) refs.push(entityReference(`dialogue.history.${key}`, npcId, "historyNpc"));
    if (locationId) refs.push(entityReference(`dialogue.history.${key}`, locationId, "historyLocation"));
  }
  if (state.dialogue.active) {
    refs.push(entityReference("dialogue.active.npcId", state.dialogue.active.npcId, "contactNpc"));
    refs.push(entityReference("dialogue.active.locationId", state.dialogue.active.locationId, "contactLocation"));
  }
  return refs;
}
