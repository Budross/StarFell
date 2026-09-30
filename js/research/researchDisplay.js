import { researchInputView } from "./researchView.js";
import { formatQuantity } from "../quantities.js";
import { describeAmounts } from "../resources.js";

export default function researchDisplay(system, onAction, openTab) {
  const panel = document.querySelector("#research-panel");
  const knowledgePanel = document.querySelector("#knowledge-panel");
  panel.innerHTML = `<div class="research-heading"><div><p class="research-eyebrow">FIELD NOTES / EXPERIMENTAL SCIENCE</p><h2>Research workbench</h2></div><span id="research-location"></span></div>
    <div class="research-layout"><aside class="research-hint"><h3>Try next</h3><p id="research-hint"></p></aside>
    <section class="research-workbench" aria-labelledby="research-experiment-heading">
      <h3 id="research-experiment-heading">01 / Experiment</h3><p id="research-facility" class="research-muted"></p>
      <form id="research-form"><label class="research-method-label" for="research-method">Method</label><select id="research-method"></select>
      <fieldset><legend>Samples <span>One sample of each selected material or item</span></legend><div id="research-samples"></div><p id="research-empty" class="research-muted"></p></fieldset>
      <p id="research-cost"></p><p id="research-profile" class="research-muted"></p><p id="research-reason"></p>
      <button id="research-submit" type="submit" disabled>Run experiment</button></form>
    </section><section class="research-notes" aria-labelledby="research-journal-heading"><h3 id="research-journal-heading">02 / Observations</h3><p id="research-count" class="research-muted"></p><ol id="research-journal"></ol></section></div>`;
  knowledgePanel.innerHTML = `<div class="research-heading"><div><p class="research-eyebrow">FIELD NOTES / WHAT YOU KNOW</p><h2>Discovered knowledge</h2></div></div>
    <div id="research-knowledge"></div><p id="research-legacy" class="research-muted" hidden>Earlier fabrication knowledge was preserved when this save was updated.</p><div id="research-families"></div>`;
  const $ = id => panel.querySelector(`#research-${id}`);
  const knowledge = id => knowledgePanel.querySelector(`#research-${id}`);
  const form = $("form"), method = $("method"), sampleList = $("samples");
  const setText = (element, value) => { if (element.textContent !== value) element.textContent = value; };
  const element = (tag, text, className) => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };
  const methods = Object.values(system.catalog.methods).filter(m => !m.retired);
  method.replaceChildren(...methods.map(m => new Option(m.name, m.id)));
  let state, locationId = null, signature = "", journalSignature = "";
  const selected = new Set(), samples = new Map();
  for (const item of Object.values(system.content.items)) {
    const label = document.createElement("label"); label.className = "research-sample";
    const input = document.createElement("input"); input.type = "checkbox"; input.value = item.id; input.dataset.sample = item.id;
    const name = element("span", item.name), quantity = element("small", "");
    label.append(input, name, quantity); sampleList.append(label); samples.set(item.id, { label, input, quantity });
  }
  sampleList.addEventListener("change", event => {
    const id = event.target.dataset.sample; if (!id) return;
    if (event.target.checked) selected.add(id); else selected.delete(id);
    signature = ""; render(state);
  });
  method.addEventListener("change", () => { selected.clear(); signature = ""; render(state); });
  form.addEventListener("submit", event => {
    event.preventDefault();
    onAction("research:experiment", { methodId: method.value, items: [...selected] });
  });
  document.querySelector("#research-shortcut").addEventListener("click", openTab);
  function render(next) {
    state = next;
    if (locationId !== state.locationId) { locationId = state.locationId; selected.clear(); signature = ""; }
    const model = researchInputView(state, system, { methodId: method.value, items: [...selected] });
    // Cache rendered values, rather than duplicating the mechanics' dependencies.
    const nextSignature = JSON.stringify(model);
    if (signature !== nextSignature) {
      signature = nextSignature;
      setText($("location"), model.locationName);
      setText($("facility"), model.facility);
      method.disabled = !model.canExperiment;
      let shown = 0;
      for (const sample of model.samples) {
        const row = samples.get(sample.id);
        row.label.hidden = sample.hidden;
        if (!sample.hidden) shown++;
        row.input.checked = sample.selected;
        row.input.disabled = sample.disabled;
        setText(row.quantity, model.canExperiment ? `${formatQuantity(sample.amount, sample.id, system.content)} available · sample ${formatQuantity(sample.required, sample.id, system.content)}` : "Private");
      }
      setText($("empty"), shown ? "" : model.canExperiment ? "Gather samples using the salvage directives in Operations." : "Samples are private at this location.");
      const costs = describeAmounts(model.cost, system.content);
      setText($("cost"), costs ? `Consumes: ${costs}.` : "Select samples to review the cost.");
      const profile = Object.entries(model.families).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
      setText($("profile"), profile.length ? `Sample tendencies: ${profile.map(([id, n]) => `${system.catalog.families[id].name} (${n >= 4 ? "strong" : "moderate"})`).join(" · ")}` : "");
      setText($("reason"), model.reason || "This setup can yield new evidence. Outcomes are recorded after the experiment is saved.");
      $("submit").disabled = !!model.reason;
      setText($("hint"), model.hint);
      setText(document.querySelector("#research-opening-hint"), model.hint);
    }
    const nextJournal = JSON.stringify([state.research.attemptCount, state.knowledge.discoveries, state.research.legacyKnowledge, state.research.exposure]);
    if (journalSignature === nextJournal) return;
    journalSignature = nextJournal;
    const known = system.catalog.orderedDiscoveries.filter(d => state.knowledge.discoveries[d.id]);
    knowledge("knowledge").replaceChildren();
    if (!known.length) knowledge("knowledge").append(element("p", "Discoveries will appear here as your observations come together.", "research-muted"));
    for (const discovery of known) {
      const card = element("article", "", "research-discovery");
      card.append(element("h4", discovery.name), element("p", discovery.description)); knowledge("knowledge").append(card);
    }
    knowledge("legacy").hidden = !state.research.legacyKnowledge;
    knowledge("families").replaceChildren();
    for (const [id, exposure] of Object.entries(state.research.exposure).filter(([, n]) => n > 0)) {
      knowledge("families").append(element("span", `${system.catalog.families[id].name}: ${exposure >= 40 ? "familiar" : exposure >= 15 ? "developing" : "emerging"}`, "research-family"));
    }
    const recent = [];
    let previousItems = null;
    for (const attempt of state.research.attempts) {
      const items = [...attempt.inputs].sort().join("\u0000");
      if (items === previousItems) recent[recent.length - 1] = attempt;
      else recent.push(attempt);
      previousItems = items;
    }
    setText($("count"), state.research.attemptCount
      ? `${state.research.attemptCount} experiment${state.research.attemptCount === 1 ? "" : "s"} recorded · ${recent.length} recent result${recent.length === 1 ? "" : "s"}`
      : "No experiments recorded yet.");
    $("journal").replaceChildren();
    for (const attempt of recent.reverse()) {
      const entry = element("li", "");
      entry.append(element("h4", attempt.inputs.map(id => system.content.items[id].name).join(" + ")));
      entry.append(element("p", attempt.discoveries.length
        ? `Discovered: ${attempt.discoveries.map(id => system.catalog.discoveries[id].name).join(", ")}`
        : "Progress made toward a discovery.", attempt.discoveries.length ? "research-learned" : "research-muted"));
      $("journal").append(entry);
    }
  }
  return render;
}
