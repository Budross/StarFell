import { processingWorkshopView, blockerLabels } from './processingView.js';
import { formatQuantity } from './quantities.js';

export default function processingDisplay(services,onAction) {
  const panel = document.querySelector('#processing-machines'), drafts = new Map();
  let state, signature = '', rows = new Map(), review = null, returnFocus = null;
  const amounts = lines => lines.map(l => `${formatQuantity(l.amount,l.itemId,services.content)} ${services.content.items[l.itemId].name.toLowerCase()}`).join(' + ');
  const element = (tag,text) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; return e; };
  function cancel() { review = null; panel.querySelector('.processing-review')?.remove(); if (returnFocus?.isConnected) returnFocus.focus(); returnFocus = null; }
  function reviewAbort(run) {
    cancel(); returnFocus = document.activeElement; review = { runId: run.id,phase: run.phase };
    const form = element('div'); form.className = 'processing-review'; form.setAttribute('role','alertdialog'); form.setAttribute('aria-label','Review batch loss');
    form.append(element('p',run.phase === 'delivery' ? `Discard finished batch? ${amounts(run.pendingOutputs)} held inside the machine will be lost.` :
      run.kind === 'refining' ? `Abort batch? The loaded materials (${amounts(run.committedInputs)}) will be lost.` : 'Abort extraction? The source claim will be released. No ore has left the deposit.'));
    const confirm = element('button',run.phase === 'delivery' ? 'Discard finished batch' : 'Abort batch'), back = element('button','Cancel');
    back.onclick = cancel;
    confirm.onclick = () => { const request = { ...review,confirmed: true }; cancel(); onAction('abortProcess',request); };
    form.append(confirm,back); panel.append(form); back.focus();
  }
  return function render(next) {
    state = next; const view = processingWorkshopView(state,services);
    if (review) { const run = state.processing.runs[review.runId]; if (!run || run.hostId !== view.hostId || run.phase !== review.phase || !view.groups.flatMap(g => g.runs).find(r => r.id === run.id)?.abort.ok) cancel(); }
    const shape = JSON.stringify([view.hostId,view.private,view.canViewCargo,view.groups.map(g => [g.equipmentId,g.quantity,g.idle,g.runs.map(r => r.id),g.choices.map(c => c.request)])]);
    if (shape !== signature) {
      cancel(); signature = shape; rows = new Map(); panel.replaceChildren();
      if (!view.groups.length) panel.append(element('p',view.private ? 'Facility access required.' : 'No industrial machines installed here. Assemble and install a mineral extractor or thermal processor to begin.'));
      for (const group of view.groups) {
        const card = element('section'); card.className = 'processing-machine'; card.dataset.equipmentId = group.equipmentId; card.tabIndex = -1;
        card.append(element('h4',`${group.name} · ${group.quantity} installed`));
        for (const run of group.runs) {
          const row = element('div'); row.className = 'processing-run'; row.dataset.runId = run.id;
          const title = element('strong'), progress = element('progress'); progress.max = 1; progress.setAttribute('aria-label',`${run.label} work progress`);
          const status = element('p'), buffer = element('p'), button = element('button');
          button.onclick = () => { const live = processingWorkshopView(state,services).groups.flatMap(g => g.runs).find(r => r.id === run.id); if (live?.abort.ok) reviewAbort(live); };
          row.append(title,progress,status,buffer,button); card.append(row); rows.set(`run:${run.id}`,{ title,progress,status,buffer,button });
        }
        for (let i=0;i<group.idle;i++) {
          const key = `${view.hostId}/${group.equipmentId}/${i}`, row = element('div'); row.className = 'processing-idle';
          const label = element('label',`Idle machine ${i+1}: `), select = element('select'); select.setAttribute('aria-label',`${group.name} idle machine ${i+1} process`);
          group.choices.forEach((c,j) => select.add(new Option(c.label,String(j))));
          const saved = drafts.get(key); if (saved) { const index = group.choices.findIndex(c => JSON.stringify(c.request) === saved); if (index >= 0) select.value = String(index); }
          select.onchange = () => { drafts.set(key,JSON.stringify(group.choices[Number(select.value)]?.request)); render(state); };
          const preview = element('p'), reason = element('p'), start = element('button');
          start.onclick = () => { const live = processingWorkshopView(state,services).groups.find(g => g.equipmentId === group.equipmentId)?.choices[Number(select.value)]; if (live?.preview.ok) onAction('startProcess',live.request); };
          label.append(select); row.append(label,preview,reason,start); card.append(row); rows.set(key,{ select,preview,reason,start });
        }
        panel.append(card);
      }
    }
    for (const group of view.groups) {
      for (const run of group.runs) {
        const row = rows.get(`run:${run.id}`); row.title.textContent = `${run.label} · batch ${run.id}`; row.progress.value = run.progress;
        const destination = run.kind === 'extraction' ? 'cargo' : 'storage';
        const waiting = run.blockedReason === 'OUTPUT_FULL' ? `Waiting for ${destination} space` : blockerLabels[run.blockedReason] ?? 'Unloading';
        row.status.textContent = run.phase === 'delivery' ? `${run.kind === 'extraction' ? 'Extraction complete' : 'Batch complete'} — ${waiting}. Machine occupied.` : `${run.kind === 'extraction' ? 'Extracting' : 'Batch loaded — processing'} · ${Math.round(run.progress*100)}% · ${blockerLabels[run.blockedReason] ?? 'Working'}`;
        row.buffer.textContent = run.phase === 'delivery' ? `${run.kind === 'extraction' ? 'Output buffer' : 'Output hopper'}: ${amounts(run.pendingOutputs)}. Unloads automatically when ${destination} has room.${!group.operational ? ' Machine disabled; finished output can still unload.' : ''}` : `Expected output: ${amounts(run.pendingOutputs)}.${run.committedInputs.length ? ` Materials loaded: ${amounts(run.committedInputs)}.` : ''}`;
        row.button.textContent = run.phase === 'delivery' ? 'Discard finished batch…' : 'Abort batch…'; row.button.disabled = !run.abort.ok; row.button.title = run.abort.reason;
      }
      for (let i=0;i<group.idle;i++) {
        const row = rows.get(`${view.hostId}/${group.equipmentId}/${i}`), choice = group.choices[Number(row.select.value)];
        row.select.disabled = !group.choices.length;
        const contract = choice?.preview.contract, process = choice && services.catalog.definitions[choice.request.processId];
        const inputs = contract?.committedInputs ?? process?.inputs ?? [], outputs = contract?.pendingOutputs ?? process?.outputs ?? [];
        row.preview.textContent = !choice ? (view.canViewCargo ? 'No unlocked compatible processes available.' : 'Cargo is private. View access is required for process previews.') : `${inputs.length ? `Load batch: ${amounts(inputs)}. Loaded material is committed; aborting before unloading loses the batch. ` : ''}${outputs.length ? `Output: ${amounts(outputs)}. ` : ''}${choice.preview.workTotal ?? process.duration}s · ${choice.preview.powerRate ?? process.powerRate} power/s.${choice.reserve ? ` Source: ${formatQuantity(choice.reserve.remaining,state.locations[choice.request.sourceLocationId].resourceNodes[choice.request.nodeId].resourceId,services.content)} remaining; ${choice.reserve.claimed/1000000} m³ claimed; ${(choice.reserve.remaining-choice.reserve.claimed)/1000000} m³ available.` : ''}`;
        row.reason.textContent = choice?.preview.reason || choice?.preview.warning || '';
        row.start.textContent = process?.kind === 'refining' ? 'Load & start batch' : 'Start extraction'; row.start.disabled = !choice?.preview.ok;
      }
    }
  };
}
