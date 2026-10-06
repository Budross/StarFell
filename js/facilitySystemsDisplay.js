import { facilityZones } from './facilitySystemsView.js';
import { blockerLabels } from './processingView.js';
import { formatQuantity, formatVolume } from './quantities.js';

const markers = {ACTIVE:'▶',READY:'○',IDLE:'Ⅱ',DISABLED:'×',BLOCKED:'!',DAMAGED:'!'};
const ns = 'http://www.w3.org/2000/svg';
const element = (tag,text,className) => {
  const el = document.createElement(tag); if (text !== undefined) el.textContent = text;
  if (className) el.className = className; return el;
};
const setText = (el,value) => { if (el.textContent !== value) el.textContent = value; };
const number = n => Number(n).toLocaleString(undefined,{maximumFractionDigits:3});

// Page-local selection and diagram drafts only. No gameplay action callback.
export default function facilitySystemsDisplay(view,content,openOwner) {
  const panel = document.querySelector('#systems-panel');
  panel.innerHTML = `<header class="fs-heading"><div><p class="fs-eyebrow">SUPERVISORY TERMINAL / LOCAL INFRASTRUCTURE</p>
    <h2 id="facility-systems-heading" tabindex="-1">Facility Systems</h2><p class="fs-location"></p></div><strong class="fs-system-status"></strong></header>
    <div class="fs-layout"><section class="fs-overview" aria-label="Facility overview" tabindex="0">
    <div class="fs-telemetry" aria-label="Facility telemetry"><p id="fs-power" tabindex="-1"></p><p id="fs-cargo" tabindex="-1"></p></div>
    <p class="fs-message"></p><section class="fs-schematic" aria-labelledby="fs-schematic-heading">
    <div class="fs-screen-heading"><h3 id="fs-schematic-heading">Facility schematic</h3><span>INSTALLED GROUPS / CURRENT</span></div>
    <div class="fs-zones" role="group" aria-label="Installed equipment"></div>
    <p class="fs-legend">▶ Active · ○ Ready · Ⅱ Idle · × Disabled · ! Attention<br>Zone brackets group functions; process arrows explain batch requirements.</p>
    <button type="button" class="fs-inspect">Inspect selected equipment</button>
    </section>
    <footer class="fs-status"><p class="fs-counts"></p><h3>Current attention</h3><div class="fs-issues"></div></footer>
    </section><section id="fs-detail" class="fs-detail" aria-labelledby="fs-detail-heading" tabindex="0"></section></div>
    <p class="sr-only fs-announcement" role="status" aria-live="polite" aria-atomic="true"></p>`;
  const $ = selector => panel.querySelector(selector), zones = $('.fs-zones'), detail = $('#fs-detail');
  const selections = new Map(), drafts = new Map(), nodes = new Map();
  let state, model, selectedId = null, shape = '', detailShape = '', issueShape = '', diagramShape = '';
  let runRows = new Map(), diagramSelect, diagramBody, readiness, heading;
  const announce = text => setText($('.fs-announcement'),text);
  function reveal(target) {
    if (!target) return;
    target.focus({preventScroll:true});
    const pane=target.closest('.fs-overview,.fs-detail');
    if (!pane) return;
    const bounds=pane.getBoundingClientRect(), rect=target.getBoundingClientRect();
    if (rect.top < bounds.top) pane.scrollTop += rect.top-bounds.top-8;
    else if (rect.bottom > bounds.bottom) pane.scrollTop += rect.bottom-bounds.bottom+8;
  }
  $('.fs-inspect').onclick=()=>reveal(heading);
  const quantity = line => `${formatQuantity(line.amount,line.itemId,content)} ${line.name ?? content.items[line.itemId].name}`;
  const button = (text,action) => { const b = element('button',text); b.type='button'; b.onclick=action; return b; };
  const observer = new ResizeObserver(() => { if (!panel.hidden) drawBrackets(); });
  observer.observe(zones);

  function drawBrackets() {
    for (const zone of zones.children) {
      const svg = zone.querySelector('svg'), blocks = [...zone.querySelectorAll('.fs-machine')];
      if (!svg || !blocks.length) continue;
      const bounds = zone.getBoundingClientRect(), points = blocks.map(b => {
        const r = b.getBoundingClientRect(); return {x:r.left-bounds.left,y:r.top-bounds.top+r.height/2};
      });
      svg.setAttribute('viewBox',`0 0 ${bounds.width} ${bounds.height}`);
      const path = svg.firstElementChild;
      path.setAttribute('d',`M 8 ${Math.min(...points.map(p=>p.y))} V ${Math.max(...points.map(p=>p.y))} `+
        points.map(p=>`M 8 ${p.y} H ${p.x-4}`).join(' '));
    }
  }
  function select(id,focus = false) {
    selectedId=id; selections.set(model.hostId,id); detailShape=''; diagramShape='';
    render(state); detail.scrollTop=0; announce(`${model.groups.find(g=>g.equipmentId===id)?.name ?? 'Equipment'} selected.`);
    if (focus) reveal(nodes.get(id)?.button);
  }
  function makeMachines() {
    const hadFocus = zones.contains(document.activeElement);
    const focusedId = document.activeElement.dataset?.equipmentId;
    nodes.clear(); zones.replaceChildren();
    for (const zone of facilityZones) {
      const groups=model.groups.filter(g=>g.zone===zone.id); if (!groups.length) continue;
      const section=element('section',undefined,'fs-zone');
      section.append(element('h4',`${zone.symbol} ${zone.label}`));
      const svg=document.createElementNS(ns,'svg'); svg.setAttribute('aria-hidden','true'); svg.classList.add('fs-brackets');
      svg.append(document.createElementNS(ns,'path')); section.append(svg);
      const grid=element('div',undefined,'fs-machine-grid');
      for (const group of groups) {
        const b=button('',()=>select(group.equipmentId)); b.className='fs-machine'; b.dataset.equipmentId=group.equipmentId;
        b.setAttribute('aria-controls','fs-detail');
        const name=element('strong'), status=element('span',undefined,'fs-machine-state'), caps=element('span',undefined,'fs-machine-provision');
        const activity=element('span',undefined,'fs-machine-activity'), condition=element('span',undefined,'fs-machine-condition');
        b.append(name,status,caps,activity,condition); grid.append(b);
        nodes.set(group.equipmentId,{button:b,name,status,caps,activity,condition});
      }
      section.append(grid); zones.append(section);
    }
    if (hadFocus) (nodes.get(focusedId)?.button ?? $('#facility-systems-heading')).focus({preventScroll:true});
    requestAnimationFrame(drawBrackets);
  }
  function field(title,text) {
    const block=element('section',undefined,'fs-detail-section'); block.append(element('h4',title));
    if (text) block.append(element('p',text)); detail.append(block); return block;
  }
  function buildDetail(group) {
    const focused=document.activeElement, hadFocus=detail.contains(focused), focusKey=focused.dataset?.fsFocus;
    detail.replaceChildren(); runRows=new Map(); diagramShape=''; diagramSelect=null;
    heading=element('h3',group ? group.name : 'Selected equipment'); heading.id='fs-detail-heading'; heading.tabIndex=-1;
    detail.append(element('p','SELECTED EQUIPMENT','fs-eyebrow'),heading);
    if (!group) {
      detail.append(element('p',model.message || 'Select installed equipment to inspect it.'));
      if (hadFocus) heading.focus({preventScroll:true});
      return;
    }
    detail.append(element('p',group.purpose,'fs-purpose'));
    field('Condition / provision',`${group.status} · ${group.quantity} installed · ${Math.round(group.health*100)}% condition · ${group.enabled ? 'Enabled' : 'Disabled'} · ${group.installationMode==='builtIn' ? 'Built-in' : group.installationMode==='vesselModule' ? 'Vessel module' : 'Installed product'}`);
    const provides=field('Provides');
    for (const c of group.capabilities) provides.append(element('p',`${c.label} · ${c.available ? 'Available' : 'Unavailable'}. ${c.summary}`));
    for (const c of group.contributions) {
      const amount=c.kind==='reserveCapacity' ? ` · +${number(c.amount*group.quantity)} reserve capacity` :
        c.kind==='cargoCapacity' ? ` · +${formatVolume(c.volumeUnits*group.quantity)} cargo capacity` :
        c.kind==='powerRate' ? ` · ${number(c.rate)} power/s rated per unit` : '';
      provides.append(element('p',`${c.label}${amount} · ${c.available ? 'Available' : 'Unavailable'}. ${c.summary}`));
    }
    if (!group.capabilities.length && !group.contributions.length) provides.append(element('p','No service capability or utility contribution declared.'));
    const uses=field('Known uses');
    if (!group.operations.length && !group.research.length) uses.append(element('p','No known compatible operations recorded.'));
    const list=element('ul');
    for (const operation of group.operations) list.append(element('li',`${operation.name} · ${operation.relation==='alternative' ? 'Can use this capability as an alternative' : 'Requires its capability'}`));
    for (const method of group.research) list.append(element('li',`${method.name} · ${method.reason || 'Equipment requirement available'}`));
    uses.append(list);
    if (group.capabilities.some(c=>c.owner==='communications')) {
      uses.append(element('p',`${group.contacts.length} reachable radio contact${group.contacts.length===1 ? '' : 's'}. Contact and scanning eligibility remain with Communications.`));
      if (group.contacts.length) uses.append(element('p',group.contacts.map(c=>c.name).join(' · ')));
    }
    const work=field('Current work',group.runs.length ? `${group.runs.length} occupied / ${group.freeSlots} free slots` :
      group.capabilities.some(c=>c.owner==='processing') ? 'No accepted batches. Machine slots are idle.' :
        group.capabilities.some(c=>['crafting','research'].includes(c.owner)) ? 'No timed work tracked. Crafting and research complete immediately.' : 'No timed work tracked for this infrastructure.');
    for (const run of group.runs) {
      const row=element('section',undefined,'fs-run'); row.dataset.runId=run.id;
      row.append(element('strong',run.label)); const progress=element('progress'); progress.max=1;
      progress.setAttribute('aria-label',`${run.label} work progress`);
      const status=element('p'), material=element('p'); row.append(progress,status,material); work.append(row);
      runRows.set(run.id,{progress,status,material});
    }
    const process=field('Process explanation');
    if (group.operations.length || group.runs.length) {
      const label=element('label','Known operation or accepted batch'); diagramSelect=element('select');
      diagramSelect.dataset.fsFocus='diagram'; diagramSelect.setAttribute('aria-label','Process explanation');
      for (const run of group.runs) diagramSelect.add(new Option(`${run.label} · accepted batch ${run.id}`,`run:${run.id}`));
      for (const p of group.operations) diagramSelect.add(new Option(`${p.name}${p.kind==='recipe' ? ' · immediate recipe' : ''}`,p.key));
      const draftKey=`${model.hostId}/${group.equipmentId}`;
      const remembered=drafts.get(draftKey);
      if ([...diagramSelect.options].some(o=>o.value===remembered)) diagramSelect.value=remembered;
      diagramSelect.onchange=()=>{drafts.set(draftKey,diagramSelect.value);diagramShape='';updateDiagram(group);};
      label.append(diagramSelect); process.append(label);
    }
    diagramBody=element('div',undefined,'fs-process'); readiness=element('p',undefined,'fs-readiness');
    process.append(diagramBody,readiness);
    const links=field('Open operating interface');
    const link=(label,owner)=>{const b=button(label,()=>openOwner(owner,group.equipmentId));b.dataset.fsFocus=owner;links.append(b);};
    if (group.capabilities.some(c=>c.owner==='processing') || group.runs.length) link('Open Processing','processing');
    if (group.capabilities.some(c=>c.type==='fabrication')) link('Open Fabrication','fabrication');
    if (group.capabilities.some(c=>c.owner==='research')) link('Open Research','research');
    if (group.capabilities.some(c=>c.owner==='communications')) link('Open Communications','communications');
    links.append(button('Return to schematic',()=>{
      reveal(nodes.get(group.equipmentId)?.button);
    }));
    if (hadFocus) {
      const replacement=[...detail.querySelectorAll('[data-fs-focus]')].find(el=>el.dataset.fsFocus===focusKey);
      (replacement ?? heading).focus({preventScroll:true});
    }
  }
  function updateDiagram(group) {
    const key=diagramSelect?.value, run=group.runs.find(r=>`run:${r.id}`===key);
    const operation=group.operations.find(p=>p.key===(run ? `process:${run.processId}` : key));
    let inputs=[],outputs=[],caption='',note='';
    if (!operation) note=run ? 'Process relationship details not recorded. Current batch status remains visible above.' : 'No known material process recorded for this equipment.';
    else if (!model.cargo) note='Cargo is private. Material previews are unavailable.';
    else {
      caption=run ? `ACCEPTED BATCH · ${number(run.workTotal)}s work · ${number(run.powerRate)} power/s` :
        operation.kind==='recipe' ? 'IMMEDIATE RECIPE / STANDARD INGREDIENTS AND APPROVED ALTERNATIVES' :
          `KNOWN PROCESS · ${number(operation.duration)}s · ${number(operation.powerRate)} power/s`;
      if (run) {
        const allowedInputs=new Set(operation.inputs?.map(l=>l.itemId) ?? []), allowedOutputs=new Set(operation.outputs?.map(l=>l.itemId) ?? []);
        if (operation.kind==='extraction') for (const s of operation.sources) if (s.hostId===run.sourceLocationId && s.nodeId===run.nodeId) {
          inputs=[`SOURCE DEPOSIT · ${s.name} · ${s.itemName}`]; allowedOutputs.add(s.itemId);
        }
        inputs.push(...run.inputs.filter(l=>allowedInputs.has(l.itemId)).map(quantity));
        outputs=run.outputs.filter(l=>allowedOutputs.has(l.itemId)).map(quantity);
        if (run.outputs.some(l=>!allowedOutputs.has(l.itemId)) || run.inputs.some(l=>!allowedInputs.has(l.itemId))) note='Some batch material relationships are not recorded.';
      } else if (operation.kind==='recipe') {
        inputs=operation.inputs.map(s=>s.options.length ? s.options.map(o=>quantity({itemId:o.itemId,amount:o.quantity,name:o.name})).join(' OR ') : 'Ingredient details not recorded');
        outputs=[quantity({itemId:operation.output,amount:operation.amount,name:operation.outputName})];
      } else if (operation.kind==='extraction') {
        const source=operation.sources[0]; inputs=[`SOURCE DEPOSIT · ${source.name} · ${source.itemName}`];
        outputs=[quantity({itemId:source.itemId,amount:source.amount,name:source.itemName})];
        caption+=' · FIRST RECORDED LOCAL SOURCE';
      } else { inputs=operation.inputs.map(quantity); outputs=operation.outputs.map(quantity); if (!operation.complete) note='Some material relationships are not recorded.'; }
    }
    const signature=JSON.stringify([group.name,key,inputs,outputs,caption,note]);
    if (signature!==diagramShape) {
      diagramShape=signature; diagramBody.replaceChildren();
      if (caption) diagramBody.append(element('p',caption,'fs-flow-caption'));
      if (inputs.length || outputs.length) {
        const flow=element('div',undefined,'fs-flow');
        const side=(title,lines)=>{const box=element('div');box.append(element('strong',title));const ul=element('ul');lines.forEach(line=>ul.append(element('li',line)));box.append(ul);return box;};
        const machine=element('div',undefined,'fs-flow-unit'); machine.append(element('span','REQUIRES ↓'),element('strong',group.name),element('span','PRODUCES ↓'));
        flow.append(side('INPUT',inputs),machine,side(run?.phase==='delivery' ? 'BUFFERED OUTPUT' : 'OUTPUT',outputs));
        diagramBody.append(flow,element('p','Process relationship only. Batch material handling remains with its owning domain.','fs-flow-note'));
      }
      if (note) diagramBody.append(element('p',note));
    }
    const preview=operation && !run ? view.inspect(state,group.equipmentId,key,model) : null;
    setText(readiness,preview ? `START READINESS · ${preview.reason}` : '');
  }
  function render(next) {
    state=next; if (panel.hidden) return;
    model=view.get(state);
    setText($('.fs-location'),`LOCAL FACILITY / ${model.name}`); setText($('.fs-system-status'),model.access);
    $('.fs-system-status').dataset.status=model.access;
    setText($('.fs-message'),model.message);
    const p=model.power, c=model.cargo;
    setText($('#fs-power'),p ? `POWER · ${number(p.stored)} / ${number(p.capacity)} reserve · ${p.net>0 ? 'CHARGING' : p.net<0 ? 'DRAWING DOWN' : p.stored<=0 && p.capacity>0 ? 'DEPLETED' : 'IDLE'} · ${number(p.net)} net/s · ${number(p.generation)} infrastructure flow / ${number(p.demand)} allocated work draw` : 'POWER · PRIVATE');
    setText($('#fs-cargo'),c ? `CARGO · ${formatVolume(c.usedVolumeUnits)} / ${formatVolume(c.capacityVolumeUnits)} · ${formatVolume(c.freeVolumeUnits)} free${c.overloadVolumeUnits ? ` · ${formatVolume(c.overloadVolumeUnits)} overloaded` : ''}` : 'CARGO · PRIVATE');
    selectedId=selections.get(model.hostId);
    if (!model.groups.some(g=>g.equipmentId===selectedId)) {selectedId=model.groups[0]?.equipmentId ?? null;selections.set(model.hostId,selectedId);}
    const nextShape=JSON.stringify([model.hostId,model.groups.map(g=>[g.equipmentId,g.zone])]);
    if (shape!==nextShape) {shape=nextShape;announce('');makeMachines();}
    for (const g of model.groups) {
      const row=nodes.get(g.equipmentId); row.button.setAttribute('aria-pressed',String(g.equipmentId===selectedId)); row.button.dataset.status=g.status;
      setText(row.name,`${g.name} · ×${g.quantity}`); setText(row.status,`${markers[g.status]} ${g.status}`);
      const labels=g.capabilities.map(c=>c.label);
      setText(row.caps,labels.slice(0,2).join(' / ')+(labels.length>2 ? ` +${labels.length-2}` : '') || g.contributions.map(c=>c.label).join(' / ') || 'Infrastructure');
      setText(row.activity,g.runs.length ? `${g.runs.filter(r=>r.phase==='working'&&r.speed>0).length} working · ${g.runs.filter(r=>r.phase==='delivery'||r.speed<=0).length} waiting · ${g.freeSlots} free` : 'No timed work');
      setText(row.condition,`${Math.round(g.health*100)}% condition${g.runs.some(r=>r.status==='POWER LIMITED') ? ' · ! POWER LIMITED' : ''}`);
    }
    const group=model.groups.find(g=>g.equipmentId===selectedId);
    const nextDetail=JSON.stringify([model.hostId,group && {...group,runs:group.runs.map(({progress,...r})=>r)},model.access,!!model.cargo]);
    if (nextDetail!==detailShape) {detailShape=nextDetail;buildDetail(group);}
    if (group) {
      for (const r of group.runs) {
        const row=runRows.get(r.id);row.progress.value=r.progress;
        setText(row.status,`${r.status} · ${Math.round(r.progress*100)}%${r.blockedReason ? ` · ${blockerLabels[r.blockedReason] ?? 'Work unavailable'}` : ''}${r.phase==='working'&&r.speed<1&&r.speed>0 ? ` · ${Math.round(r.speed*100)}% speed` : ''}`);
        setText(row.material,!r.outputs ? 'Cargo details private.' : `${r.phase==='delivery' ? 'Buffered output' : 'Expected output'}: ${r.outputs.map(quantity).join(' + ')}.${r.phase==='delivery' ? ' Machine slot occupied until unloading; finished output may unload even with equipment disabled.' : ''}`);
      }
      updateDiagram(group);
    }
    setText($('.fs-counts'),!model.facilityReadable ? model.access==='UNAVAILABLE' ? 'FACILITY UNAVAILABLE' : 'GROUPS PRIVATE · WORK PRIVATE · STATUS RESTRICTED' :
      `GROUPS ${model.groups.length} · AVAILABLE ${model.available ?? 0} · ACTIVE RUNS ${model.activeRuns ?? 0} · ATTENTION ${model.issues.length}`);
    const issuesKey=JSON.stringify([model.hostId,model.issues]);
    if (issuesKey!==issueShape) {
      const hadFocus=$('.fs-issues').contains(document.activeElement), focusedKey=document.activeElement.dataset?.issueKey;
      issueShape=issuesKey;$('.fs-issues').replaceChildren();
      for (const issue of model.issues) {
        const b=button(`! ${issue.text}`,()=>{
          if (issue.equipmentId) {
            if (issue.runId) drafts.set(`${model.hostId}/${issue.equipmentId}`,`run:${issue.runId}`);
            select(issue.equipmentId,true);
          } else reveal($(`#fs-${issue.target}`));
        }); b.dataset.issueKey=issue.key;$('.fs-issues').append(b);
      }
      if (!model.issues.length) $('.fs-issues').append(element('p',model.access==='RESTRICTED' ? 'Private facility status is unavailable.' : model.access==='UNAVAILABLE' ? model.message : 'No current equipment or work issues.'));
      if (hadFocus) ([...$('.fs-issues').children].find(b=>b.dataset.issueKey===focusedKey) ?? $('#facility-systems-heading')).focus({preventScroll:true});
    }
  }
  return render;
}
