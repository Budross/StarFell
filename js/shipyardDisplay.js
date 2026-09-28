import { createShipyardDraft, placeDraftModule, moveDraftModule, removeDraftModule, draftAssembly } from './shipyard.js';
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
    <canvas id="yard-canvas" tabindex="0" aria-label="Dry dock. Select module stock, enter grid coordinates and Place, or click a cell. Drag attachments to move; drag empty space to pan."></canvas>
    <form id="yard-place"><p id="yard-selected">Select a stocked module.</p><label>X cell<input id="yard-x" type="number" step="1" value="0"></label><label>Y cell<input id="yard-y" type="number" step="1" value="0"></label><button id="yard-place-button" type="submit">Place module</button></form>
    <div class="yard-edit"><label>Placed module<select id="yard-placement" aria-label="Placed module"></select></label><button id="yard-move" type="button">Move to X / Y</button><button id="yard-remove" type="button">Remove from draft</button></div>
    <p id="yard-draft-error" role="status"></p></section>
    <aside class="yard-metrics"><h3>VESSEL PREVIEW</h3><div id="yard-metrics"></div><h3>ASSEMBLY STOCKS</h3><p id="yard-frames"></p><p id="yard-power"></p>
    <label>Vessel name<input id="yard-name" maxlength="80" placeholder="Optional name"></label><button id="yard-assemble" type="button">Assemble vessel</button><p>New vessels have empty cargo, tanks and power. Load cartridges and let the reserve charge before launch. Controls are in Locations.</p></aside></div>`;
  const el = id => panel.querySelector(`#${id}`), canvas = el('yard-canvas'), ctx = canvas.getContext('2d');
  let state, draft, selectedModule = '', view, signature = '', placementSignature = '', error = '', scale = 38, pan = [0, 0], pointer = null;
  const text = (id, value) => { if (el(id).textContent !== value) el(id).textContent = value; };
  const coordinates = () => [Number(el('yard-x').value), Number(el('yard-y').value)];
  const placements = () => [draft?.core, ...(draft?.attachments ?? [])].filter(Boolean);
  function edit(operation) { try { draft = operation(); error = ''; } catch (e) { error = e.message; } render(state); }
  el('yard-name').oninput = () => { draft.name = el('yard-name').value; refresh(); };
  el('yard-place').onsubmit = event => { event.preventDefault(); if (selectedModule) edit(() => placeDraftModule(draft, selectedModule, ...coordinates(), services.content)); };
  el('yard-move').onclick = () => edit(() => moveDraftModule(draft, el('yard-placement').value, ...coordinates(), services.content));
  el('yard-remove').onclick = () => edit(() => removeDraftModule(draft, el('yard-placement').value));
  el('yard-placement').onchange = () => { const p = placements().find(p => p.key === el('yard-placement').value); if (p) { el('yard-x').value = p.x; el('yard-y').value = p.y; } };
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
  function cell(event) {
    const r = canvas.getBoundingClientRect();
    return [Math.floor((event.clientX - r.left - r.width / 2 - pan[0]) / scale), Math.floor((event.clientY - r.top - r.height / 2 - pan[1]) / scale)];
  }
  canvas.onpointerdown = event => {
    const c = cell(event), p = placements().find(p => { const m = services.content.vesselModules[p.moduleId]; return c[0] >= p.x && c[0] < p.x + m.footprint.width && c[1] >= p.y && c[1] < p.y + m.footprint.height; });
    pointer = { id: event.pointerId, start: [event.clientX, event.clientY], pan: [...pan], c, p, moved: false };
    if (p) { el('yard-placement').value = p.key; el('yard-x').value = p.x; el('yard-y').value = p.y; }
    canvas.setPointerCapture(event.pointerId);
  };
  canvas.onpointermove = event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    pointer.moved ||= Math.hypot(event.clientX - pointer.start[0], event.clientY - pointer.start[1]) > 4;
    if (!pointer.p) { pan = [pointer.pan[0] + event.clientX - pointer.start[0], pointer.pan[1] + event.clientY - pointer.start[1]]; draw(); }
  };
  canvas.onpointerup = event => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const p = pointer, c = cell(event); pointer = null; canvas.releasePointerCapture(event.pointerId);
    if (p.p && p.moved && p.p.key !== 'core') edit(() => moveDraftModule(draft, p.p.key, p.p.x + c[0] - p.c[0], p.p.y + c[1] - p.c[1], services.content));
    else if (!p.p && !p.moved && selectedModule) edit(() => placeDraftModule(draft, selectedModule, ...c, services.content));
    draw();
  };
  canvas.onpointercancel = () => { pointer = null; };
  canvas.onkeydown = event => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); pan[0] += event.key === 'ArrowLeft' ? 24 : event.key === 'ArrowRight' ? -24 : 0; pan[1] += event.key === 'ArrowUp' ? 24 : event.key === 'ArrowDown' ? -24 : 0; draw();
    } else if (event.key === 'Enter') { event.preventDefault(); el('yard-x').focus(); }
  };
  function draw() {
    const r = canvas.getBoundingClientRect(); if (!r.width || !r.height) return;
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
      ctx.fillStyle = p.key === 'core' ? '#645139' : '#314d40'; ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
      ctx.strokeStyle = p.key === el('yard-placement').value ? '#f0ca85' : '#9dbba2'; ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
      ctx.fillStyle = '#e0eadb'; ctx.font = `${Math.max(9, Math.min(12, scale / 3))}px monospace`;
      ctx.fillText(p.key === 'core' ? 'CORE' : m.category.toUpperCase().slice(0, 5), x + 5, y + 17, Math.max(0, w - 10));
    }
  }
  new ResizeObserver(draw).observe(canvas);
  function render(nextState) {
    state = nextState;
    if (!draft || draft.yardId !== state.locationId) { draft = createShipyardDraft(state.locationId); el('yard-name').value = ''; error = ''; }
    view = shipyardView(state, draft, services);
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
        button.disabled = (m.role === 'core' ? m.stock : m.available) < 1; button.setAttribute('aria-pressed', String(selectedModule === m.id));
        button.onclick = () => { selectedModule = m.id; text('yard-selected', `${m.name} selected. ${m.role === 'core' ? 'Core is anchored at (0, 0).' : 'Enter a free edge-connected position.'}`); signature = ''; render(state); };
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
    el('yard-assemble').disabled = !view.preview?.ok; el('yard-place-button').disabled = !selectedModule || !view.palette.some(m => m.id === selectedModule && (m.role === 'core' ? m.stock : m.available) > 0);
    el('yard-move').disabled = !draft.attachments.length; el('yard-remove').disabled = !placed.length; draw();
  }
  return render;
}
