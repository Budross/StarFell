import { npcDefinition, npcInstances, locationDefinition } from "./entityQueries.js";
import { npcVisible, contactReason } from "./npcs.js";
import { dialogueView } from "./dialogue.js";

// Only the active passage/history is saved. Roster selection and transcript are UI state.
export default function dialogueDisplay(system, onAction, openTab) {
  const panel = document.querySelector("#people-panel");
  panel.innerHTML = `<div class="people-heading"><span id="people-location"></span><button id="people-resume" hidden type="button"></button></div>
    <div class="people-layout"><section class="people-roster" aria-label="People here"><h2>People here</h2><div id="people-list"></div></section>
    <section id="people-detail" class="people-detail" aria-label="Person and conversation"></section></div>
    <p id="people-error" class="people-error" role="alert"></p>`;
  const roster = panel.querySelector("#people-list"), detail = panel.querySelector("#people-detail");
  const resume = panel.querySelector("#people-resume"), error = panel.querySelector("#people-error");
  const shortcut = document.querySelector("#people-shortcut"), shellResume = document.querySelector("#conversation-resume");
  let state, selected = null, receipt = "", transcript = [], seen = new Set(), detailSignature = "", rosterSignature = "", focusNext = false;
  let sessionId = null, lastLocation = null;
  const commands = new Map();
  function element(tag, text, className) {
    const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el;
  }
  function button(label, key, callback, reason = "") {
    const el = element("button", label); el.type = "button"; el.dataset.key = key;
    if (reason) { el.setAttribute("aria-disabled", "true"); el.title = reason; }
    commands.set(key, () => { if (!reason) callback(); });
    return el;
  }
  function browse(id) { selected = id; receipt = ""; error.textContent = ""; focusNext = true; render(state); }
  function show() { openTab(); if (state.dialogue.active) selected = state.dialogue.active.npcId; focusNext = true; render(state); }
  shortcut.addEventListener("click", show); shellResume.addEventListener("click", show);
  resume.addEventListener("click", () => browse(state.dialogue.active.npcId));
  panel.addEventListener("click", event => { const key = event.target.closest("button[data-key]")?.dataset.key; if (key) commands.get(key)?.(); });
  function act(operation, payload) {
    error.textContent = "";
    const result = onAction(`dialogue:${operation}`, payload);
    if (!result?.ok) { error.textContent = result?.message || "The action could not be completed."; render(state); }
  }
  function render(next) {
    state = next;
    const a = state.dialogue.active, view = dialogueView(state, system);
    if (lastLocation !== state.locationId) { selected = a?.npcId ?? null; lastLocation = state.locationId; receipt = ""; detailSignature = ""; }
    const local = npcInstances(state, system).filter(npc => npcVisible(state, npc.id, system)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    panel.querySelector("#people-location").textContent = `LOCAL PEOPLE / ${locationDefinition(state, system.world, state.locationId).name}`;
    const shortcutText = `People here · ${local.length}`;
    if (shortcut.textContent !== shortcutText) shortcut.textContent = shortcutText;
    const resumeText = a ? `Resume conversation with ${npcDefinition(state, system, a.npcId).name}` : "";
    for (const el of [resume, shellResume]) { el.hidden = !a; if (el.textContent !== resumeText) el.textContent = resumeText; }
    document.querySelector("#terminal-tab-people").classList.toggle("has-conversation", !!a);
    document.querySelector("#terminal-tab-people").setAttribute("aria-label", a ? "People, conversation in progress" : "People");
    if (selected && !local.some(n => n.id === selected) && !receipt) selected = null;
    resume.hidden = !a || selected === a.npcId;
    if (view && sessionId !== view.sessionId) { transcript = []; seen = new Set(); sessionId = view.sessionId; }
    if (view && view.phase !== "topics") {
      const key = `${view.sessionId}/${view.revision}`;
      if (!seen.has(key)) { transcript.push({ author: view.name, text: view.text }); seen.add(key); }
    }
    const rows = local.map(n => ({ id: n.id, name: n.name, subtitle: n.subtitle ?? "", reason: contactReason(state, n.id, system) }));
    const rs = JSON.stringify([rows, selected]);
    if (rs !== rosterSignature) {
      const focusedKey = roster.contains(document.activeElement) ? document.activeElement.dataset.key : null;
      rosterSignature = rs; roster.replaceChildren();
      if (!rows.length) roster.append(element("p", "There is nobody available here.", "people-muted"));
      for (const row of rows) {
        const b = button(row.name, `person:${row.id}`, () => browse(row.id));
        b.className = "person-row"; b.setAttribute("aria-pressed", String(selected === row.id));
        if (row.subtitle) b.append(element("small", row.subtitle));
        if (row.reason) b.append(element("small", "Unavailable to talk"));
        roster.append(b);
      }
      if (focusedKey) roster.querySelector(`[data-key="${focusedKey}"]`)?.focus({ preventScroll: true });
    }
    panel.classList.toggle("has-person", !!selected || !!receipt);
    const npc = selected ? npcDefinition(state, system, selected) : null;
    const activeView = view?.npcId === selected ? view : null;
    const ds = JSON.stringify([selected, receipt, activeView, npc ? contactReason(state, npc.id, system) : "", a?.npcId, transcript]);
    if (ds === detailSignature && !focusNext) return;
    const scrollHost = getComputedStyle(detail).overflowY === "auto" ? detail : panel.querySelector(".people-layout");
    const previousScroll = scrollHost.scrollTop, atBottom = scrollHost.scrollHeight - scrollHost.clientHeight - scrollHost.scrollTop < 60;
    const focusedKey = detail.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    detailSignature = ds; detail.replaceChildren();
    const header = element("div", undefined, "conversation-header");
    const heading = element("h2", npc?.name ?? (receipt ? "Conversation ended" : "Choose someone to talk to")); heading.tabIndex = -1;
    let passageFocus = heading;
    header.append(heading); detail.append(header);
    if (selected || receipt) header.append(button("Back to people", "back", () => { selected = null; receipt = ""; focusNext = true; render(state); }));
    if (receipt) {
      const farewell = element("p", receipt, "dialogue-receipt"); farewell.tabIndex = -1; passageFocus = farewell; detail.append(farewell);
    } else if (activeView) {
      header.append(button("End conversation", "leave", () => act("leave", activeView.token)));
      const history = element("div", undefined, "dialogue-transcript"); history.setAttribute("aria-label", "Conversation so far");
      for (const line of transcript) {
        const passage = element("div", undefined, "dialogue-passage"), words = element("p", line.text);
        words.tabIndex = -1; passageFocus = words;
        passage.append(element("span", line.author, "dialogue-speaker"), words); history.append(passage);
      }
      detail.append(history);
      const current = element("h3", activeView.phase === "topics" ? "Topics" : activeView.phase === "ending" ? "End of topic" : "Your reply", "dialogue-choice-heading"); current.tabIndex = -1;
      detail.append(current);
      if (activeView.phase === "topics") passageFocus = current;
      const choices = element("div", undefined, "dialogue-choices"); choices.setAttribute("role", "group"); choices.setAttribute("aria-label", "Dialogue choices");
      if (!activeView.choices.length && activeView.phase !== "ending") choices.append(element("p", activeView.phase === "topics" ? "There are no topics to discuss right now." : "There are no available replies. You can return to topics or leave.", "people-muted"));
      for (const choice of activeView.choices) {
        const row = element("div", undefined, "dialogue-option");
        const b = button(choice.text, `reply:${choice.id}`, () => act(activeView.phase === "topics" ? "topic" : "choice", { ...activeView.token, id: choice.id }), choice.reason);
        row.append(b);
        if (choice.reason) { const why = element("p", choice.reason, "dialogue-reason"); why.id = `dialogue-reason-${choice.id}`; b.setAttribute("aria-describedby", why.id); row.append(why); }
        choices.append(row);
      }
      detail.append(choices);
      if (activeView.phase !== "topics") detail.append(button(activeView.phase === "ending" ? "Continue to topics" : "Return to topics", "topics", () => act("topics", activeView.token)));
    } else if (npc) {
      detail.append(element("p", npc.subtitle ?? "", "people-muted"), element("p", npc.description, "person-description"));
      if (a) detail.append(button(`Resume conversation with ${npcDefinition(state, system, a.npcId).name}`, "resume", () => browse(a.npcId)), element("p", "End your current conversation before starting another.", "people-muted"));
      else if (npc.interactions.includes("talk")) {
        const why = contactReason(state, npc.id, system), b = button("Talk", "talk", () => act("start", { npcId: npc.id }), why);
        detail.append(b);
        if (why) { const p = element("p", why, "dialogue-reason"); p.id = "talk-reason"; b.setAttribute("aria-describedby", p.id); detail.append(p); }
      }
    } else detail.append(element("p", "Select a person to read their description and see available interactions.", "people-muted"));
    // Deliberate transitions focus readable content; background frames preserve position.
    if (!panel.hidden && focusNext) {
      const focus = selected || receipt ? passageFocus : roster.querySelector("button") ?? heading;
      focus.focus({ preventScroll: true });
      scrollHost.scrollTop = activeView ? Math.max(0, scrollHost.scrollTop + passageFocus.getBoundingClientRect().top - scrollHost.getBoundingClientRect().top - header.offsetHeight - 28) : 0;
    } else { scrollHost.scrollTop = atBottom ? scrollHost.scrollHeight : previousScroll; if (focusedKey) (detail.querySelector(`[data-key="${focusedKey}"]`) ?? heading).focus({ preventScroll: true }); }
    focusNext = false;
  }
  render.committed = (before, after, action, payload, message) => {
    const previous = dialogueView(before, system);
    if (action.group === "dialogue") {
      selected = after.dialogue.active?.npcId ?? previous?.npcId ?? payload?.npcId ?? selected;
      receipt = ""; error.textContent = ""; focusNext = true;
      if (action.id === "dialogue:start") { transcript = []; seen = new Set(); sessionId = after.dialogue.active.sessionId; }
      if (["dialogue:choice", "dialogue:topic"].includes(action.id)) {
        const choice = previous?.choices.find(c => c.id === payload.id);
        if (choice) transcript.push({ author: "You", text: choice.text });
      }
    }
    if (before.dialogue.active && !after.dialogue.active) { receipt = message || "Local contact was lost. The conversation has ended."; focusNext = true; }
  };
  render.show = show;
  return render;
}
