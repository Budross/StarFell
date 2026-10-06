import { itemElement,renderItemEntry } from './itemEntryView.js';
import { canUse } from './authority.js';

export default function itemContextDisplay(system,onAction,onReference,openKnowledge) {
  const workshop=document.querySelector('#workshop-panel'),host=workshop.querySelector('.workshop-actions');
  const modules=host.querySelector('.workshop-action-modules');
  const sidebar = document.createElement('aside'); sidebar.id='item-context'; sidebar.className='item-context'; sidebar.hidden=true; sidebar.setAttribute('aria-labelledby','item-context-heading');
  sidebar.innerHTML = `<div class="item-context-content"><div class="item-context-header"><div><p id="item-context-category" class="research-eyebrow"></p><h2 id="item-context-heading"></h2></div><button id="item-context-close" type="button">Close</button></div>
    <div id="item-context-body"></div><section id="item-context-installation" hidden><h3>Install equipment</h3><label>Target<select id="item-context-target"></select></label><p id="item-context-reason" role="status"></p><button id="item-context-install" type="button"></button></section>
    <p id="item-context-result" role="status"></p><button id="item-context-knowledge" type="button">Open Knowledge entry</button></div>`;
  const scan=document.createElement('div'); scan.className='item-context-scan'; scan.setAttribute('aria-hidden','true');
  host.append(sidebar,scan);
  const motion=matchMedia('(prefers-reduced-motion: reduce)');
  const endScan=() => host.classList.remove('item-context-opening');
  sidebar.addEventListener('animationend',event => {
    if (event.animationName === 'item-context-reveal') endScan();
  });
  motion.addEventListener('change',event => { if (event.matches) endScan(); });
  function startScan() {
    endScan();
    if (motion.matches) return;
    // Restart the sweep even when another item is opened during the previous one.
    void host.offsetWidth;
    host.classList.add('item-context-opening');
  }
  const find = id => sidebar.querySelector(`#item-context-${id}`);
  let state,itemId,hostId,opener,signature='',targetSignature='';
  const body=find('body'), select=find('target'), install=find('install');
  const restore = () => {
    const target = opener?.isConnected && !opener.closest('[hidden]') ? opener : document.querySelector('#workshop-panel .storage-module h3');
    if (target) { if (!target.matches('button')) target.tabIndex=-1; target.focus({preventScroll:true}); }
  };
  function close(restoreFocus=true) {
    if (sidebar.hidden) return;
    endScan(); sidebar.hidden=true; modules.inert=false;
    if (restoreFocus) restore();
  }
  function sizeSidebar() {
    const style=getComputedStyle(workshop);
    const available=workshop.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
    if (available>0) { sidebar.style.maxHeight=`${available}px`; scan.style.maxHeight=`${available}px`; }
  }
  new ResizeObserver(sizeSidebar).observe(workshop);
  document.addEventListener('keydown',event => {
    if (event.key !== 'Escape' || sidebar.hidden || workshop.hidden) return;
    event.preventDefault(); event.stopPropagation(); close();
  });
  find('close').addEventListener('click',() => close());
  find('knowledge').addEventListener('click',() => { const id=itemId; close(false); openKnowledge(id,opener); });
  body.addEventListener('click',event => {
    const button=event.target.closest('button[data-reference]'); if (!button || button.disabled) return;
    const kind=button.dataset.reference,id=button.dataset.id; close(false); onReference(kind,id);
  });
  function updateTarget(model) {
    const targets=model?.targets ?? [],next=JSON.stringify(targets.map(t => [t.id,t.name]));
    find('installation').hidden=!targets.length;
    if (targetSignature !== next) {
      const previous=select.value; targetSignature=next;
      select.replaceChildren(...targets.map(t => new Option(t.name,t.id)));
      if (targets.some(t => t.id === previous)) select.value=previous;
    }
    const target=targets.find(t => t.id === select.value);
    const hadInstallFocus=document.activeElement===install;
    install.disabled=!target?.ok; install.textContent=target ? `Install 1 on ${target.name}` : 'Install';
    if (hadInstallFocus && install.disabled) find('close').focus({preventScroll:true});
    find('reason').textContent=target?.reason || (target ? 'Uses one product from your current storage.' : '');
  }
  select.addEventListener('change',() => updateTarget(system.getKnownItemEntry(state,itemId)));
  install.addEventListener('click',() => {
    const target=system.getKnownItemEntry(state,itemId)?.targets.find(t => t.id === select.value);
    if (!target?.ok) { updateTarget(system.getKnownItemEntry(state,itemId)); return; }
    const result=onAction('installItemAtTarget',target.request);
    find('result').textContent=result?.message ?? ''; render(state);
  });
  function render(next) {
    state=next;
    if (sidebar.hidden) return;
    if (state.locationId !== hostId || !canUse(state,'player',hostId,'viewCargo')) { close(!workshop.hidden); return; }
    const model=system.getKnownItemEntry(state,itemId),key=JSON.stringify(model);
    find('knowledge').disabled=!model;
    if (key !== signature) {
      signature=key;
      if (model) renderItemEntry(body,model,system.content);
      else body.replaceChildren(itemElement('p','No item information recorded.','research-muted'));
    }
    updateTarget(model);
  }
  render.open=(id,element) => {
    if (!state || !canUse(state,'player',state.locationId,'viewCargo') || !system.content.items[id]) return;
    itemId=id; hostId=state.locationId; opener=element; signature=''; targetSignature='';
    find('heading').textContent=system.content.items[id].name; find('category').textContent=system.content.items[id].category;
    find('result').textContent=''; sidebar.hidden=false; modules.inert=true; sizeSidebar(); render(state);
    sidebar.scrollTop=0; sidebar.scrollIntoView({block:'nearest'}); find('close').focus({preventScroll:true});
    startScan();
  };
  render.close=close; return render;
}
