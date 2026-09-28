import { locationDefinition } from './entityQueries.js';
import { isKnown } from './locations.js';
import { canUse } from './authority.js';
import { vesselLinkReason } from './vesselAccess.js';
import { droneCommandReason, droneTransferReason } from './vesselCommandActions.js';
import { navigationReason, journeyQuote } from './ships.js';
import { vesselFuelSummary, fuelMovementReason } from './vesselFuel.js';
import { processingHostView } from './processingView.js';
import { deriveVessel } from './vessels.js';
import { parseQuantity, formatQuantity, formatVolume } from './quantities.js';
import { storageSummary } from './storage.js';

// Presentation state only. Every command is checked again by its domain action.
export default function vesselControlsDisplay(services, onAction) {
  const panel = document.querySelector('#vessel-controls');
  panel.innerHTML = `<h2>DRONES</h2><label>Selected vessel<select id="vc-vessel" aria-label="Selected modular vessel"></select></label><p id="vc-empty"></p>
    <div id="vc-detail" hidden><p id="vc-status" role="status"></p><p id="vc-geometry"></p><p id="vc-stock"></p><p id="vc-link"></p>
    <div class="vc-grid"><section><h3>NAVIGATION</h3><p id="vc-journey"></p><button id="vc-undock" type="button">Undock</button>
      <label>Area destination<select id="vc-area"></select></label><p id="vc-area-quote"></p><button id="vc-travel" type="button">Travel to area</button>
      <label>Docking site<select id="vc-site"></select></label><p id="vc-site-quote"></p><button id="vc-dock" type="button">Dock at site</button></section>
    <section><h3>FUEL CARTRIDGES</h3><p id="vc-fuel"></p><label>Source or destination<select id="vc-fuel-cargo"></select></label>
      <label>Cartridge<select id="vc-fuel-item"></select></label><label>Whole cartridges<input id="vc-fuel-amount" type="number" min="1" step="1" value="1"></label>
      <button id="vc-load" type="button">Load tank</button><button id="vc-unload" type="button">Unload tank</button><p id="vc-fuel-reason"></p></section>
    <section><h3>PROCESSING</h3><label>Available batch<select id="vc-process"></select></label><p id="vc-process-detail"></p>
      <button id="vc-start" type="button">Start one batch</button><div id="vc-runs"></div></section>
    <section><h3>BERTH CARGO</h3><p id="vc-berth"></p><label>Direction<select id="vc-direction"><option value="unload">Vessel → berth</option><option value="load">Berth → vessel</option></select></label>
      <label>Item<select id="vc-transfer-item"></select></label><label>Amount<input id="vc-transfer-amount" value="1" inputmode="decimal"></label>
      <button id="vc-transfer" type="button">Transfer cargo</button><p id="vc-transfer-reason"></p></section></div></div>`;
  const el = id => panel.querySelector(`#${id}`), write = (id, value) => { if (el(id).textContent !== value) el(id).textContent = value; };
  let state, vesselId = '', choices = [], runs = [];
  function setOptions(id, entries) {
    const select = el(id), previous = select.value, signature = JSON.stringify(entries);
    if (select.dataset.signature !== signature) {
      select.dataset.signature = signature; select.replaceChildren();
      for (const [value, label] of entries) select.add(new Option(label, value));
      if (entries.some(([value]) => value === previous)) select.value = previous;
    }
  }
  function act(id, payload) { const result = onAction(id, payload); if (result?.ok) render(state); }
  function current() { return state?.locations[vesselId]; }
  function commandable() { return !droneCommandReason(state, vesselId, services); }
  function nav(operation, targetId) { return navigationReason(state, operation, targetId, services.world, services.content, vesselId); }
  function commandNav(operation, targetId) { act('commandVesselNavigation', { vesselId, operation, ...(targetId ? { targetId } : {}) }); }
  el('vc-vessel').onchange = () => { vesselId = el('vc-vessel').value; render(state); };
  el('vc-area').onchange = el('vc-site').onchange = () => refreshChoices();
  el('vc-fuel-cargo').onchange = el('vc-fuel-item').onchange = el('vc-fuel-amount').oninput = () => refreshFuel();
  el('vc-process').onchange = () => refreshProcess();
  el('vc-direction').onchange = el('vc-transfer-item').onchange = el('vc-transfer-amount').oninput = () => refreshTransfer();
  el('vc-undock').onclick = () => commandNav('undock');
  el('vc-travel').onclick = () => commandNav('travel', el('vc-area').value);
  el('vc-dock').onclick = () => commandNav('dock', el('vc-site').value);
  for (const direction of ['load', 'unload']) el(`vc-${direction}`).onclick = () => {
    act(`${direction}VesselFuel`, { vesselId, cargoId: el('vc-fuel-cargo').value, fuelItemId: el('vc-fuel-item').value, amount: Number(el('vc-fuel-amount').value) });
  };
  el('vc-start').onclick = () => { const selected = choices[Number(el('vc-process').value)]; if (selected) act('commandVesselProcess', selected.request); };
  el('vc-runs').onclick = event => {
    const button = event.target.closest('button[data-run-id]'); if (!button) return;
    const run = runs.find(r => r.id === Number(button.dataset.runId));
    if (!run || !button.parentElement.querySelector('input[type="checkbox"]').checked) return;
    act('commandVesselAbort', { vesselId, runId: run.id, phase: run.phase, confirmed: true });
  };
  el('vc-transfer').onclick = () => {
    const berth = current()?.dockedAtId, direction = el('vc-direction').value, assetId = el('vc-transfer-item').value;
    let amount; try { amount = parseQuantity(el('vc-transfer-amount').value, assetId, services.content); }
    catch (error) { write('vc-transfer-reason', error.message); return; }
    act('commandVesselTransfer', { vesselId, sourceId: direction === 'load' ? berth : vesselId,
      destinationId: direction === 'load' ? vesselId : berth, assetId, amount });
  };
  function refreshChoices() {
    const local = current(), command = commandable(); if (!local) return;
    const area = el('vc-area').value, site = el('vc-site').value;
    el('vc-undock').disabled = !command || !!nav('undock');
    for (const [operation, target, quoteId, buttonId] of [['travel', area, 'vc-area-quote', 'vc-travel'], ['dock', site, 'vc-site-quote', 'vc-dock']]) {
      const reason = target ? nav(operation, target) : 'Choose a destination.';
      const quote = target ? journeyQuote(state, target, services.world, services.content, vesselId) : null;
      write(quoteId, quote && Number.isFinite(quote.duration) ? `${Math.ceil(quote.duration)}s · ${quote.powerCost} power · ${quote.fuelUnits} cartridges · DRY MASS ${quote.dryMassKg} kg${reason ? ` · ${reason}` : ''}` : reason);
      el(buttonId).disabled = !command || !!reason;
    }
  }
  function refreshFuel() {
    if (!current()) return;
    const base = { vesselId, cargoId: el('vc-fuel-cargo').value, fuelItemId: el('vc-fuel-item').value, amount: Number(el('vc-fuel-amount').value) };
    const messages = [];
    for (const direction of ['load', 'unload']) {
      const reason = fuelMovementReason(state, { ...base, direction }, services);
      el(`vc-${direction}`).disabled = !!reason; messages.push(`${direction}: ${reason || 'ready'}`);
    }
    write('vc-fuel-reason', messages.join(' · '));
  }
  function refreshProcess() {
    const selected = choices[Number(el('vc-process').value)];
    write('vc-process-detail', selected ? `${selected.label} · ${selected.preview.reason || `Ready, ${Math.ceil(selected.preview.workTotal)}s`}${selected.preview.warning ? ` · ${selected.preview.warning}` : ''}` : 'No compatible batch is available here.');
    el('vc-start').disabled = !selected?.preview.ok || !commandable();
  }
  function refreshTransfer() {
    const local = current(), berth = local?.dockedAtId, direction = el('vc-direction').value;
    const sourceId = direction === 'load' ? berth : vesselId, destinationId = direction === 'load' ? vesselId : berth;
    const source = state?.locations[sourceId]?.resources ?? {};
    const entries = berth && canUse(state, 'player', sourceId, 'viewCargo') ? Object.entries(source).filter(([id, amount]) => id !== 'power' && amount > 0 && services.content.items[id])
      .map(([id, amount]) => [id, `${services.content.items[id].name} · ${formatQuantity(amount, id, services.content)}`]) : [];
    setOptions('vc-transfer-item', entries);
    let reason = 'Dock at a stationary berth to transfer cargo.';
    if (entries.length) try {
      const assetId = el('vc-transfer-item').value, amount = parseQuantity(el('vc-transfer-amount').value, assetId, services.content);
      reason = droneTransferReason(state, { vesselId, sourceId, destinationId, assetId, amount }, services);
    } catch (error) { reason = error.message; }
    else if (berth) reason = 'No available item at this endpoint.';
    write('vc-transfer-reason', reason || 'Ready to transfer at the actual berth.');
    el('vc-transfer').disabled = !!reason || !commandable();
  }
  function render(nextState) {
    state = nextState;
    const vessels = Object.entries(state.entities).filter(([id, e]) => e.lifecycle === 'active' && e.type === 'ship' && state.locations[id]?.assembly &&
      isKnown(state, services.world, services.content, id) && canUse(state, 'player', id, 'viewCargo'));
    setOptions('vc-vessel', vessels.map(([id]) => [id, locationDefinition(state, services.world, id).name]));
    if (!vessels.some(([id]) => id === vesselId)) vesselId = vessels[0]?.[0] ?? '';
    if (el('vc-vessel').value !== vesselId) el('vc-vessel').value = vesselId;
    write('vc-empty', vessels.length ? '' : 'Assemble a vessel at Habitat 05 to unlock these controls.');
    el('vc-detail').hidden = !vesselId;
    if (!vesselId) return;
    const local = current(), def = locationDefinition(state, services.world, vesselId), derived = deriveVessel(local.assembly, services.content);
    const link = vesselLinkReason(state, vesselId, services), command = droneCommandReason(state, vesselId, services);
    write('vc-status', `${def.name} · ${def.vesselClass} · ${local.journey ? `En route to ${locationDefinition(state, services.world, local.journey.targetId).name} (${Math.ceil(local.journey.remaining)}s)` : local.dockedAtId ? `Docked at ${locationDefinition(state, services.world, local.dockedAtId).name}` : `Undocked in ${locationDefinition(state, services.world, local.areaId).name}`}`);
    write('vc-link', command || (link ? `Service access: ${link}` : 'Command and service link active.'));
    write('vc-geometry', `${derived.geometry.width} × ${derived.geometry.length} × ${derived.geometry.depth.toFixed(3)} m · DRY MASS ${derived.dryMassKg} kg · ${derived.moduleCount} modules`);
    const cargo = storageSummary({ ...local, capacityVolumeUnits: def.capacityVolumeUnits }, services.content), fuel = vesselFuelSummary(state, vesselId, services.content);
    write('vc-stock', `Cargo ${formatVolume(cargo.usedVolumeUnits)} / ${formatVolume(cargo.capacityVolumeUnits)} · Ship power ${local.resources.power.toFixed(2)}`);
    write('vc-fuel', `${formatVolume(fuel.usedVolumeUnits)} / ${formatVolume(fuel.capacityVolumeUnits)} · ${fuel.overloadVolumeUnits ? `OVERLOADED BY ${formatVolume(fuel.overloadVolumeUnits)}` : 'Tank within capacity'} · ${Object.entries(fuel.items).map(([id,n]) => `${n} ${services.content.items[id].name}`).join(', ') || 'Empty'}`);
    write('vc-journey', local.journey ? 'Movement completes with simulation time.' : 'Navigation pays all power and fuel at departure.');
    const known = Object.keys(state.locations).filter(id => isKnown(state, services.world, services.content, id));
    setOptions('vc-area', known.filter(id => locationDefinition(state, services.world, id)?.kind === 'area' && id !== local.areaId).map(id => [id, locationDefinition(state, services.world, id).name]));
    setOptions('vc-site', known.filter(id => { const d = locationDefinition(state, services.world, id); return d?.kind === 'site' && !d.mobile && state.locations[id]?.areaId === local.areaId; }).map(id => [id, locationDefinition(state, services.world, id).name]));
    refreshChoices();
    setOptions('vc-fuel-cargo', [vesselId, local.dockedAtId].filter(Boolean).map(id => [id, id === vesselId ? 'Vessel cargo' : locationDefinition(state, services.world, id).name]));
    setOptions('vc-fuel-item', fuel.acceptedFuelItemIds.map(id => [id, services.content.items[id].name])); refreshFuel();
    const processing = processingHostView(state, services.processing, vesselId);
    choices = processing.groups.flatMap(g => g.choices); runs = processing.groups.flatMap(g => g.runs.map(r => ({ ...r, equipmentName: g.name })));
    setOptions('vc-process', choices.map((choice, i) => [String(i), choice.label])); refreshProcess();
    const runHolder = el('vc-runs'), signature = JSON.stringify([commandable(), runs.map(r => [r.id, r.phase, r.blockedReason, Math.round(r.progress * 100), r.abort.ok])]);
    if (runHolder.dataset.signature !== signature) {
      runHolder.dataset.signature = signature; runHolder.replaceChildren();
      for (const run of runs) {
        const row = document.createElement('p'), label = document.createElement('span'); label.textContent = `${run.label} · ${run.phase} · ${Math.round(run.progress * 100)}%${run.blockedReason ? ` · ${run.blockedReason}` : ''} `;
        const confirm = document.createElement('input'); confirm.type = 'checkbox'; confirm.setAttribute('aria-label', `Review material loss for batch ${run.id}`);
        const button = document.createElement('button'); button.type = 'button'; button.dataset.runId = run.id; button.textContent = 'Abort batch'; button.disabled = !run.abort.ok || !commandable();
        row.append(label, confirm, button); runHolder.append(row);
      }
    }
    write('vc-berth', local.dockedAtId ? `Actual berth: ${locationDefinition(state, services.world, local.dockedAtId).name}` : 'No stationary berth.');
    refreshTransfer();
  }
  return render;
}
