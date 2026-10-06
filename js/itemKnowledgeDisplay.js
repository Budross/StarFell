import { itemElement, renderItemEntry } from './itemEntryView.js';

export default function itemKnowledgeDisplay(system,research,onReference,backToWorkshop) {
  const panel = document.querySelector('#knowledge-panel');
  panel.innerHTML = `<div class="research-heading"><div><p class="research-eyebrow">FIELD NOTES / WHAT YOU KNOW</p><h2>Knowledge</h2></div></div>
    <section aria-label="Discovered knowledge"><h3>Discovered knowledge</h3><div id="research-knowledge"></div>
    <p id="research-legacy" class="research-muted" hidden>Earlier fabrication knowledge was preserved when this save was updated.</p><div id="research-families"></div></section>
    <section class="item-journal" aria-labelledby="item-journal-heading"><div class="item-journal-heading"><h3 id="item-journal-heading">Item entries</h3><button id="item-journal-back" type="button" hidden>Back to Workshop</button></div>
    <div class="item-journal-filters"><label>Search known items<input id="item-journal-search" type="search"></label><label>Category<select id="item-journal-category"><option value="">All items</option><option value="resource">Resources</option><option value="component">Components</option><option value="product">Products</option></select></label></div>
    <div class="item-journal-layout"><nav id="item-journal-list" aria-label="Known item entries"></nav><article aria-label="Selected item entry"><h3 id="item-entry-heading" tabindex="-1">Choose an item</h3><div id="item-entry-body"></div></article></div></section>`;
  const find = id => panel.querySelector(`#${id}`);
  let state,selectedId = null,signature = '',discoverySignature = '',listSignature = '';
  const search = find('item-journal-search'), category = find('item-journal-category');
  const list = find('item-journal-list'), body = find('item-entry-body');
  function update() {
    if (!state) return;
    const items = system.knownItems(state).filter(item => (!category.value || item.category === category.value) && item.name.toLowerCase().includes(search.value.trim().toLowerCase()));
    const nextList = JSON.stringify([items,selectedId]);
    if (nextList !== listSignature) {
      listSignature = nextList;
      const focusId = list.contains(document.activeElement) ? document.activeElement.dataset.item : null;
      list.replaceChildren(...items.map(item => {
        const button = itemElement('button',item.name); button.type='button'; button.dataset.item=item.id; button.setAttribute('aria-pressed',String(selectedId === item.id)); return button;
      }));
      if (!items.length) list.append(itemElement('p','No known items match.','research-muted'));
      if (focusId) [...list.querySelectorAll('button')].find(b => b.dataset.item === focusId)?.focus({preventScroll:true});
    }
    const model = selectedId ? system.getKnownItemEntry(state,selectedId) : null, next = JSON.stringify(model);
    if (signature === next) return;
    signature = next;
    find('item-entry-heading').textContent = model ? `${model.name} · ${model.category}` : 'Choose an item';
    if (model) renderItemEntry(body,model,system.content,{full:true});
    else body.replaceChildren(itemElement('p','Recorded item information will appear here.','research-muted'));
  }
  search.addEventListener('input',update); category.addEventListener('change',update);
  list.addEventListener('click',event => { const button = event.target.closest('button[data-item]'); if (button) select(button.dataset.item); });
  body.addEventListener('click',event => { const button = event.target.closest('button[data-reference]'); if (button && !button.disabled) onReference(button.dataset.reference,button.dataset.id); });
  find('item-journal-back').addEventListener('click',backToWorkshop);
  function select(id,fromWorkshop = false) {
    if (!state || !system.getKnownItemEntry(state,id)) return false;
    selectedId=id;
    if (fromWorkshop) { search.value=''; category.value=''; find('item-journal-back').hidden=false; }
    update(); find('item-entry-heading').focus({preventScroll:true}); find('item-entry-heading').scrollIntoView({block:'start'}); return true;
  }
  function render(next) {
    state=next;
    const discoveryKey=JSON.stringify([state.knowledge.discoveries,state.research.legacyKnowledge,state.research.exposure]);
    if (discoverySignature !== discoveryKey) {
      discoverySignature=discoveryKey;
      const cards = research.catalog.orderedDiscoveries.filter(d => state.knowledge.discoveries[d.id]).map(d => {
        const card=itemElement('article','','research-discovery'); card.append(itemElement('h4',d.name),itemElement('p',d.description)); return card;
      });
      find('research-knowledge').replaceChildren(...cards);
      if (!cards.length) find('research-knowledge').append(itemElement('p','Discoveries will appear here as your observations come together.','research-muted'));
      find('research-legacy').hidden=!state.research.legacyKnowledge;
      find('research-families').replaceChildren(...Object.entries(state.research.exposure).filter(([,n]) => n > 0).map(([id,n]) =>
        itemElement('span',`${research.catalog.families[id].name}: ${n >= 40 ? 'familiar' : n >= 15 ? 'developing' : 'emerging'}`,'research-family')));
    }
    update();
  }
  render.select=select; return render;
}
