import { formatQuantity } from './quantities.js';

export const itemElement = (tag,text = '',className = '') => {
  const el = document.createElement(tag); el.textContent = text; el.className = className; return el;
};
function link(text,kind,id) {
  const el = itemElement('button',text,'item-reference'); el.type = 'button'; el.dataset.reference = kind; el.dataset.id = id; return el;
}
// Both presentation surfaces consume the same admitted model, never raw visibility scans.
export function renderItemEntry(container,model,content,{ full = false } = {}) {
  const focused = container.contains(document.activeElement) ? { ...document.activeElement.dataset } : null;
  const fragment = document.createDocumentFragment();
  fragment.append(itemElement('p',model.summary,'item-summary'));
  if(model.design){fragment.append(itemElement('p',`Understood design: ${model.design.family.replace(/([a-z])([A-Z])/g,'$1 $2')}.`));if(model.design.sources.length)fragment.append(itemElement('p','Source designs: '+model.design.sources.map(s=>s.name).join(', ')+'.'));}
  if (model.quantity !== null) fragment.append(itemElement('p',`Current storage: ${formatQuantity(model.quantity,model.id,content)}`,'research-muted'));
  if (full) for (const note of model.notes) {
    const section = itemElement('section','','item-entry-section'); section.append(itemElement('h4',note.title),itemElement('p',note.text)); fragment.append(section);
  }
  const section = (title,empty,values,draw) => {
    const block = itemElement('section','','item-entry-section'); block.append(itemElement('h4',title));
    if (!values.length) block.append(itemElement('p',empty,'research-muted'));
    else { const list = itemElement('ul'); values.forEach(value => { const row = itemElement('li'); draw(row,value); list.append(row); }); block.append(list); }
    fragment.append(block);
  };
  const recipe = (row,value) => {
    const button = link(value.name,value.kind,value.id); button.disabled = value.kind === 'recipe' && !value.selectable;
    row.append(button, value.kind === 'process' ? ' · timed process' : value.selectable ? '' : ' · currently unavailable');
    const bill = itemElement('p','','item-recipe-bill');
    if (value.kind === 'recipe') {
      value.inputs.forEach((slot,i) => {
        if (i) bill.append(' + ');
        slot.options.forEach((option,j) => {
          if (j) bill.append(' or ');
          bill.append(`${formatQuantity(option.quantity,option.itemId,content)} `,link(option.name,'item',option.itemId),option.default ? ' (standard)' : slot.role ? ' (approved alternative)' : '',option.reason ? ' (currently unavailable)' : '');
        });
        if (!slot.options.length) bill.append('Ingredient details not recorded');
      });
      const cost = Object.entries(value.operatingCost ?? {});
      if (cost.length) bill.append(` · ${cost.map(([id,n]) => `${formatQuantity(n,id,content)} ${content.resources[id].name}`).join(' + ')}`);
      bill.append(` → ${formatQuantity(value.amount,value.output,content)} `,link(content.items[value.output].name,'item',value.output));
    } else {
      value.inputs.forEach((line,i) => { if (i) bill.append(' + '); bill.append(`${formatQuantity(line.amount,line.itemId,content)} `,link(line.name,'item',line.itemId)); });
      bill.append(' → ');
      value.outputs.forEach((line,i) => { if (i) bill.append(' + '); bill.append(`${formatQuantity(line.amount,line.itemId,content)} `,link(line.name,'item',line.itemId)); });
      bill.append(` · ${value.duration}s · ${value.powerRate} power/s`);
    }
    row.append(bill);
  };
  if (model.category === 'resource') {
    section('Known extraction locations','No known extraction locations.',model.sources.filter(s => s.kind === 'Extraction'),(row,source) => {
      row.append(source.linkable ? link(source.name,'location',source.hostId) : itemElement('span',source.name));
      row.append(source.remaining === null ? ' · Recorded source; current reserve unavailable' : source.remaining === 0 ? ' · Depleted' : ` · ${formatQuantity(source.remaining,model.id,content)} remaining`);
      if (source.processes.length) row.append(itemElement('p',`Known methods: ${source.processes.map(p => p.name).join(', ')}`,'research-muted'));
    });
    section('Other known acquisition sources','No other acquisition sources recorded.',model.sources.filter(s => s.kind === 'Acquisition'),(row,source) => {
      row.append(source.linkable ? link(source.name,'location',source.hostId) : itemElement('span',source.name),` · ${source.method}`);
    });
  } else section('Known ways to create this item','No known manufacturing recipes.',model.createdBy,recipe);
  if (model.category !== 'product') {
    section('Used in known recipes and processes','No known recipe uses.',model.usedIn,recipe);
    section('Known machine and equipment uses','No machine uses recorded.',model.machines,(row,use) => {
      row.append(link(use.machineName,'item',use.machineId),` · ${use.kind}: ${use.label}${use.amount ? ` · ${formatQuantity(use.amount,model.id,content)} per use/batch` : ''}`);
    });
  } else {
    if (model.equipment?.installable) {
      section('Equipment capabilities','No service capability declared.',model.equipment.capabilities,(row,capability) => {
        row.append(itemElement('strong',capability.label),` · ${capability.summary}`);
        if(capability.usedBy?.length)row.append(itemElement('p','Used by: '+[...new Set(capability.usedBy.map(use=>use.domain[0].toUpperCase()+use.domain.slice(1)))].join(', '),'research-muted'));
      });
      if(model.equipment.contributions.length)section('Installed contributions','',model.equipment.contributions,(row,contribution)=>row.append(itemElement('strong',contribution.label),` · ${contribution.summary}`));
    }
    section('Installed on your locations and ships','No installations recorded on owned hosts.',model.installations,(row,installed) => {
      row.append(itemElement('span',installed.name),installed.unavailable ? ' · Equipment unavailable' : ` · ${installed.quantity} installed · ${installed.enabled ? 'Enabled' : 'Disabled'} · ${Math.round(installed.health * 100)}% condition${installed.lastReported ? ' · Last reported':''}`);
      if (installed.placements?.length) row.append(itemElement('p',`Module placements: ${installed.placements.join(', ')}`,'research-muted'));
      if(installed.operational!==undefined)row.append(itemElement('p',installed.operational?'Operational':'Inoperative','research-muted'));
    });
    if (model.module) fragment.append(itemElement('p','This module is fitted through the Shipyard.','research-muted'),link('Open Shipyard','shipyard',model.id));
  }
  container.replaceChildren(fragment);
  if (focused?.reference) {
    const target=[...container.querySelectorAll('button[data-reference]')].find(b => b.dataset.reference === focused.reference && b.dataset.id === focused.id && !b.disabled)
      ?? container.closest('dialog')?.querySelector('h2') ?? container.parentElement.querySelector('h3');
    if (target) { if (!target.matches('button')) target.tabIndex=-1; target.focus({preventScroll:true}); }
  }
}
