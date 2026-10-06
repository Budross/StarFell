import { createShipyardDraft, placeDraftModule, moveDraftModule, removeDraftModule, draftAssembly,previewVesselDesign } from './shipyard.js';
import { describeAmounts } from './resources.js';
import { shipyardView } from './shipyardView.js';
import { deriveVessel, vesselSpeed } from './vessels.js';
import { powerOutput, capacityWithEquipment } from './equipment.js';
import { formatVolume } from './quantities.js';

export default function shipyardDisplay(services, onAction) {
  const panel = document.querySelector('#shipyard-panel');
  panel.innerHTML = `<div class="shipyard-heading"><h2>MODULAR SHIPYARD</h2><p>1 cell = 1 m × 1 m · Place a core, then connect attachments edge to edge.</p></div>
    <p id="yard-access" role="status"></p><div class="shipyard-workstation">
    <aside class="yard-palette"><h3>MODULE STOCK</h3><div id="yard-palette"></div></aside>
    <section class="yard-dock"><div class="yard-toolbar"><button id="yard-zoom-out" type="button" aria-label="Zoom out dry dock">−</button><button id="yard-zoom-in" type="button" aria-label="Zoom in dry dock">+</button><button id="yard-center" type="button">Recenter</button><button id="yard-clear" type="button">Clear draft</button></div>
    <p id="yard-preview" role="status" aria-live="polite"></p>
    <canvas id="yard-canvas" tabindex="0" aria-label="Dry dock. Drag stock here, or select stock and hold to place. Drag placed modules to move. Clear stock selection to pan." aria-describedby="yard-help yard-preview"></canvas>
    <p id="yard-selected">Select a stocked module.</p><p id="yard-help">Drag stock or select it and hold in the dock. Drag placed modules to move. Click selected stock again to pan. Keyboard: Enter on stock starts placement; arrows position, Enter places, Escape cancels.</p>
    <div class="yard-edit"><label>Placed module<select id="yard-placement" aria-label="Placed module"></select></label><button id="yard-move" type="button">Move selected</button><button id="yard-remove" type="button">Remove from draft</button></div>
    <p id="yard-draft-error" role="status"></p></section>
    <aside class="yard-metrics"><h3>VESSEL PREVIEW</h3><div id="yard-metrics"></div><h3>ASSEMBLY STOCKS</h3><p id="yard-frames"></p><p id="yard-power"></p>
    <label>Vessel name<input id="yard-name" maxlength="80" placeholder="Optional name"></label><button id="yard-assemble" type="button">Assemble vessel</button><p>New vessels have empty cargo, tanks and power. Load cartridges and let the reserve charge before launch. Controls are in Locations.</p></aside></div>`;
  const el = id => panel.querySelector(`#${id}`), canvas = el('yard-canvas'), ctx = canvas.getContext('2d');
  const designs=document.createElement('section');designs.id='yard-designs';panel.append(designs);let designSignature='';
  let state, draft, selectedModule = '', view, signature = '', placementSignature = '', error = '', scale = 38, pan = [0, 0], pointer = null, lastCell = [0, 0], suppressClick = false;
  const text = (id, value) => { if (el(id).textContent !== value) el(id).textContent = value; };
  const placements = () => [draft?.core, ...(draft?.attachments ?? [])].filter(Boolean);
  function edit(operation) { try { draft = operation(); error = ''; } catch (e) { error = e.message; } render(state); }
  el('yard-name').oninput = () => { draft.name = el('yard-name').value; refresh(); };
  el('yard-move').onclick = () => beginKeyboard(placements().find(p => p.key === el('yard-placement').value));
  el('yard-remove').onclick = () => edit(() => removeDraftModule(draft, el('yard-placement').value));
  el('yard-placement').onchange = draw;
  el('yard-clear').onclick = () => { draft = createShipyardDraft(state.locationId); el('yard-name').value = ''; error = ''; render(state); };
  el('yard-center').onclick = () => { pan = [0, 0]; draw(); };
  el('yard-zoom-in').onclick = () => { scale = Math.min(120, scale * 1.25); draw(); };
  el('yard-zoom-out').onclick = () => { scale = Math.max(8, scale / 1.25); draw(); };
  el('yard-assemble').onclick = () => {
    const result = onAction('assembleVessel', { yardId: state.locationId, name: draft.name, assembly: draftAssembly(draft) });
    if (result?.ok) { draft = createShipyardDraft(state.locationId); el('yard-name').value = ''; error = ''; }
    else error = result?.message || 'Assembly did not commit. The draft is retained.';
    render(state);
  };
  function refresh() { if (state) render(state); }
  function bounds() {
    const r = canvas.getBoundingClientRect();
    return { left: r.left + canvas.clientLeft, top: r.top + canvas.clientTop, width: canvas.clientWidth, height: canvas.clientHeight };
  }
  function cell(event) {
    const r = bounds();
    return [Math.floor((event.clientX - r.left - r.width / 2 - pan[0]) / scale), Math.floor((event.clientY - r.top - r.height / 2 - pan[1]) / scale)];
  }
  function inDock(event) {
    const r = bounds();
    return event.clientX >= r.left && event.clientX < r.left + r.width && event.clientY >= r.top && event.clientY < r.top + r.height;
  }
  function position(event) {
    pointer.client = [event.clientX, event.clientY]; pointer.inside = inDock(event);
    const c = cell(event);
    if (pointer.inside) lastCell = c;
    pointer.at = [c[0] - pointer.offset[0], c[1] - pointer.offset[1]];
  }
  function selectStock(id) { selectedModule = selectedModule === id ? '' : id; signature = ''; render(state); }
  function controls() {
    for (const id of ['yard-zoom-in', 'yard-zoom-out', 'yard-center', 'yard-clear', 'yard-name', 'yard-placement']) el(id).disabled = !!pointer;
    el('yard-move').disabled = !!pointer || !placements().length;
    el('yard-remove').disabled = !!pointer || !placements().length;
    el('yard-assemble').disabled = !!pointer || !view?.preview?.ok;
  }
  function preview(force = false) {
    if (!pointer || pointer.mode === 'pan') return;
    const p = pointer, stamp = `${p.inside}:${p.at}`;
    if (!force && p.stamp === stamp) return;
    p.stamp = stamp; p.next = null; p.reason = '';
    if (p.inside) {
      try {
        if (view.private || view.reason) throw new Error(view.reason || 'Shipyard access is required.');
        if (p.mode === 'add' && !view.palette.some(m => m.id === p.moduleId && m.available > 0)) throw new Error('No more of this module is available.');
        p.next = p.mode === 'move' ? moveDraftModule(draft, p.p.key, ...p.at, services.content) : placeDraftModule(draft, p.moduleId, ...p.at, services.content);
      } catch (e) { p.reason = e.message; }
    }
    const replacing = p.mode === 'add' && draft.core && services.content.vesselModules[p.moduleId].role === 'core';
    text('yard-preview', !p.inside ? 'Release outside the dock to cancel.' : p.reason || `${p.keyboard ? 'Enter' : 'Release'} to ${replacing ? 'replace core' : p.mode === 'move' ? 'move' : 'place'}. Escape cancels.`);
    el('yard-preview').dataset.valid = p.next ? 'true' : 'false';
  }
  function finish(commit = false, refresh = true) {
    if (!pointer) return;
    if (commit) preview(true);
    const p = pointer; pointer = null;
    if (p.id !== undefined && panel.hasPointerCapture(p.id)) panel.releasePointerCapture(p.id);
    if (commit && p.next) {
      draft = p.next; error = '';
      if (services.content.vesselModules[p.moduleId].role === 'core') {
        pan[0] += p.at[0] * scale; pan[1] += p.at[1] * scale;
        lastCell = [lastCell[0] - p.at[0], lastCell[1] - p.at[1]];
      }
      if (p.mode === 'add') selectedModule = p.moduleId;
      signature = '';
    } else if (commit && p.reason) error = p.reason;
    text('yard-preview', ''); delete el('yard-preview').dataset.valid;
    if (refresh) render(state);
  }
  function beginKeyboard(placement) {
    if (pointer || (!placement && !selectedModule)) return;
    pointer = { keyboard: true, mode: placement ? 'move' : 'add', p: placement, moduleId: placement?.moduleId || selectedModule, at: placement ? [placement.x, placement.y] : [...lastCell], inside: true };
    preview(); controls(); canvas.focus({ preventScroll: true }); draw();
  }
  panel.onpointerdown = event => {
    if (pointer || !event.isPrimary || event.button !== 0 || view?.private || view?.reason) return;
    suppressClick = false;
    const stock = event.target.closest('#yard-palette button[data-module-id]');
    // Touch stock cards retain native list scrolling; tap to select, then drag in the dock.
    if (stock && (stock.disabled || event.pointerType === 'touch')) return;
    if (!stock && event.target !== canvas) return;
    const c = cell(event), p = !stock && placements().find(p => { const m = services.content.vesselModules[p.moduleId]; return c[0] >= p.x && c[0] < p.x + m.footprint.width && c[1] >= p.y && c[1] < p.y + m.footprint.height; });
    const moduleId = stock?.dataset.moduleId || p?.moduleId || selectedModule;
    pointer = { id: event.pointerId, mode: stock || !p && selectedModule ? 'add' : p ? 'move' : 'pan', moduleId, stock: !!stock,
      start: [event.clientX, event.clientY], client: [event.clientX, event.clientY], pan: [...pan], offset: p ? [c[0] - p.x, c[1] - p.y] : [0, 0], p, at: c, inside: !stock, moved: false };
    if (p) { pointer.at = [p.x, p.y]; el('yard-placement').value = p.key; }
    panel.setPointerCapture(event.pointerId);
    if (!stock) { event.preventDefault(); canvas.focus({ preventScroll: true }); lastCell = c; }
    preview(); controls(); draw();
  };
  panel.onpointermove = event => {
    if (!pointer) { if (event.target === canvas) lastCell = cell(event); return; }
    if (pointer.id !== event.pointerId) return;
    const p = pointer;
    p.moved ||= Math.hypot(event.clientX - p.start[0], event.clientY - p.start[1]) > 4;
    if (p.mode === 'pan') pan = [p.pan[0] + event.clientX - p.start[0], p.pan[1] + event.clientY - p.start[1]];
    else { position(event); preview(); }
    draw();
  };
  panel.onpointerup = event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const p = pointer, clickStock = p.stock && !p.moved;
    if (p.mode !== 'pan') position(event);
    finish(!clickStock && p.mode !== 'pan' && p.inside && (p.mode === 'add' || p.moved));
    if (p.stock) { suppressClick = true; if (clickStock) selectStock(p.moduleId); }
  };
  panel.onpointercancel = event => { if (pointer?.id === event.pointerId) finish(); };
  panel.onlostpointercapture = event => { if (pointer?.id === event.pointerId) finish(); };
  panel.addEventListener('click', event => { if (suppressClick && event.detail) { suppressClick = false; event.preventDefault(); event.stopPropagation(); } }, true);
  window.addEventListener('blur', () => finish());
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape' && pointer) { event.preventDefault(); finish(); return; }
    const stock = event.target.closest('#yard-palette button[data-module-id]');
    if (stock && !stock.disabled && ['Enter', ' '].includes(event.key)) {
      event.preventDefault(); if (!pointer) { selectedModule = stock.dataset.moduleId; signature = ''; render(state); beginKeyboard(); } return;
    }
    if (event.target !== canvas) return;
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (delta) {
      event.preventDefault();
      if (pointer?.keyboard) { pointer.at = [pointer.at[0] + delta[0], pointer.at[1] + delta[1]]; preview(); }
      else if (!pointer) { pan[0] -= delta[0] * 24; pan[1] -= delta[1] * 24; }
      draw();
    } else if (['Enter', ' '].includes(event.key)) { event.preventDefault(); if (pointer?.keyboard) finish(true); else if (!pointer) beginKeyboard(); }
  });
  function draw() {
    const r = bounds(); if (!canvas.getClientRects().length || !r.width || !r.height) return;
    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * pixelRatio); canvas.height = Math.round(r.height * pixelRatio); ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.fillStyle = '#101b17'; ctx.fillRect(0, 0, r.width, r.height);
    const ox = r.width / 2 + pan[0], oy = r.height / 2 + pan[1];
    ctx.strokeStyle = '#294034'; ctx.lineWidth = 1;
    for (let x = ((ox % scale) + scale) % scale; x < r.width; x += scale) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, r.height); ctx.stroke(); }
    for (let y = ((oy % scale) + scale) % scale; y < r.height; y += scale) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(r.width, y); ctx.stroke(); }
    for (const p of placements()) {
      const m = services.content.vesselModules[p.moduleId], x = ox + p.x * scale, y = oy + p.y * scale, w = m.footprint.width * scale, h = m.footprint.height * scale;
      if (x + w < 0 || y + h < 0 || x > r.width || y > r.height) continue;
      ctx.globalAlpha = pointer?.inside && (pointer.p?.key === p.key || pointer.mode === 'add' && services.content.vesselModules[pointer.moduleId].role === 'core' && p.key === 'core') ? 0.35 : 1;
      ctx.fillStyle = p.key === 'core' ? '#645139' : '#314d40'; ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
      ctx.strokeStyle = p.key === el('yard-placement').value ? '#f0ca85' : '#9dbba2'; ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
      ctx.fillStyle = '#e0eadb'; ctx.font = `${Math.max(9, Math.min(12, scale / 3))}px monospace`;
      ctx.fillText(p.key === 'core' ? 'CORE' : m.category.toUpperCase().slice(0, 5), x + 5, y + 17, Math.max(0, w - 10));
    }
    ctx.globalAlpha = 1;
    if (pointer?.inside && pointer.mode !== 'pan') {
      const m = services.content.vesselModules[pointer.moduleId], x = ox + pointer.at[0] * scale, y = oy + pointer.at[1] * scale, w = m.footprint.width * scale, h = m.footprint.height * scale;
      ctx.fillStyle = pointer.next ? '#73d496' : '#f18575'; ctx.globalAlpha = 0.3; ctx.fillRect(x + 2, y + 2, w - 4, h - 4); ctx.globalAlpha = 1;
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 2; ctx.setLineDash([5, 3]); ctx.strokeRect(x + 2, y + 2, w - 4, h - 4); ctx.setLineDash([]);
      ctx.font = `${Math.max(9, Math.min(12, scale / 3))}px monospace`; ctx.fillText(m.category.toUpperCase().slice(0, 5), x + 5, y + 17, Math.max(0, w - 10));
    }
    canvas.style.cursor = pointer ? pointer.mode === 'pan' ? 'grabbing' : 'crosshair' : selectedModule ? 'crosshair' : 'grab';
  }
  new ResizeObserver(() => {
    if (pointer && !pointer.keyboard && pointer.mode !== 'pan') { position({ clientX: pointer.client[0], clientY: pointer.client[1] }); preview(); }
    draw();
  }).observe(canvas);
  function render(nextState) {
    state = nextState;
    const choices=Object.values(services.vesselDesigns??{}).filter(d=>state.knowledge.discoveries[d.discoveryId]).map(d=>({id:d.id,name:d.name,revision:d.revision,tradeoff:d.tradeoff,preview:previewVesselDesign(state,{designId:d.id,revision:d.revision,yardId:state.locationId},services)}));
    const designKey=JSON.stringify([state.locationId,choices]);if(designKey!==designSignature){designSignature=designKey;designs.replaceChildren();if(choices.length){const title=document.createElement('h3');title.textContent='REPRODUCIBLE VESSEL DESIGNS';designs.append(title);}for(const d of choices){const p=document.createElement('p'),button=document.createElement('button');p.textContent=`${d.name}: ${d.tradeoff} Required: ${describeAmounts(d.preview.cost??{},services.content)}. ${d.preview.reason}`;button.textContent=`Build ${d.name}`;button.dataset.vesselDesign=d.id;button.disabled=!d.preview.ok;button.onclick=()=>onAction('manufactureVesselDesign',{designId:d.id,revision:d.revision,yardId:state.locationId,name:el('yard-name').value});designs.append(p,button);}}
    if (!draft || draft.yardId !== state.locationId) { finish(false, false); draft = createShipyardDraft(state.locationId); selectedModule = ''; signature = ''; pan = [0, 0]; lastCell = [0, 0]; el('yard-name').value = ''; error = ''; }
    view = shipyardView(state, draft, services);
    if (pointer && (panel.hidden || view.private || view.reason)) finish(false, false);
    if (selectedModule && !view.palette.some(m => m.id === selectedModule && m.available > 0)) { selectedModule = ''; signature = ''; }
    const selectedStock = view.palette.find(m => m.id === selectedModule);
    text('yard-selected', selectedStock ? `${selectedStock.name} selected. Hold in empty dock space to place.` : 'Select a stocked module. Clear selection to pan.');
    text('yard-access', view.reason); panel.querySelector('.shipyard-workstation').hidden = view.private || !!view.reason;
    const shape = JSON.stringify(view.palette);
    if (shape !== signature) {
      signature = shape; const holder = el('yard-palette'); holder.replaceChildren();
      if (!view.palette.length) { const p = document.createElement('p'); p.textContent = 'No known designs or recovered module stock. Research modular structures and fabricate hardware in Workshop.'; holder.append(p); }
      let category;
      for (const m of view.palette) {
        if (category !== m.category) { category = m.category; const h = document.createElement('h4'); h.textContent = category.toUpperCase(); holder.append(h); }
        const button = document.createElement('button'); button.type = 'button'; button.dataset.moduleId = m.id;
        button.textContent = `${m.name}\n${m.width}×${m.height} · ${formatVolume(m.volumeUnits)} · ${m.available} available${m.known ? '' : '\nRecovered hardware · Fabrication design: UNKNOWN'}`;
        button.disabled = m.available < 1; button.setAttribute('aria-pressed', String(selectedModule === m.id));
        button.onclick = () => { if (!pointer) selectStock(m.id); };
        holder.append(button);
      }
    }
    const placed = placements(), placedShape = JSON.stringify(placed);
    if (placementSignature !== placedShape) {
      placementSignature = placedShape; const selected = el('yard-placement').value; el('yard-placement').replaceChildren();
      for (const p of placed) el('yard-placement').add(new Option(`${p.key === 'core' ? 'Core' : p.key} · ${services.content.vesselModules[p.moduleId].category} (${p.x}, ${p.y})`, p.key));
      if (placed.some(p => p.key === selected)) el('yard-placement').value = selected;
    }
    let derived;
    try { derived = deriveVessel(draftAssembly(draft), services.content, { draft: true }); } catch { /* diagnostics come from authoritative preview */ }
    text('yard-metrics', derived ? `${derived.core.vesselClass.toUpperCase()} · ${derived.core.boardable ? 'Boardable' : 'No occupants'}\n${derived.geometry.width} × ${derived.geometry.length} × ${derived.geometry.depth.toFixed(3)} m\n${derived.moduleCount} modules · DRY MASS ${derived.dryMassKg} kg\nModule envelopes: ${formatVolume(derived.volumeUnits)}\nCargo: ${formatVolume(derived.cargoVolumeUnits)} · Fuel: ${formatVolume(derived.fuelVolumeUnits)}\nPower: ${powerOutput(derived.equipment, services.content).toFixed(2)}/s · Reserve ${capacityWithEquipment(0, derived.equipment, 'power', services.content)}\nFull-health speed: ${vesselSpeed(derived, derived.equipment, services.content).toFixed(2)} navigation units/s\n${derived.warnings.map(w => `Warning: ${w}`).join('\n')}` : 'Place a core and connected attachments to preview a vessel.');
    text('yard-frames', `Structural Frames — Required: ${placed.length} / Available: ${view.framesAvailable ?? 'private'}`);
    text('yard-power', `Final assembly power: 2 / Available: ${view.powerAvailable?.toFixed(1) ?? 'private'}`);
    text('yard-draft-error', error || view.preview?.reason || 'Structurally valid. Assembly consumes these Products and one frame per module.');
    preview(true); controls(); draw();
  }
  render.cancelInteraction = () => finish();
  return render;
}
