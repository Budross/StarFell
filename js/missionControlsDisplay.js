import { formatQuantity } from './quantities.js';
import { vesselLinkReason } from './vesselAccess.js';
// Form drafts only. All orders use the canonical compiler and saved actions.
export default function missionControlsDisplay(holder,services,onAction) {
  const {missions,content}=services;let contracts=missions.getMissionActionAuthoringContracts();
  holder.innerHTML=`<h3>MISSION</h3><p id="mission-report" role="status"></p>
    <label>Task<select id="mission-kind"><option value="mining">Mining</option><option value="cargo">Cargo transport</option></select></label>
    <div id="mission-objectives"></div><label>Home<select id="mission-home"></select></label>
    <p class="mission-help">Choose a stationary home. Mining returns with its cargo; unloading is a separate berth transfer.</p>
    <label id="mission-replace-label" hidden><input id="mission-replace" type="checkbox"> Replace the remaining instructions</label>
    <p id="mission-preview" role="status"></p><p id="mission-communication"></p>
    <button id="mission-assign" type="button">Assign and launch</button><button id="mission-recall" type="button">Return home</button>`;
  const el=id=>holder.querySelector(`#${id}`);
  let state,vesselId='',seen,editors=[],destinationField=null;
  function option(select,value,label) { select.add(new Option(label,value)); }
  function destinations(select) { for(const site of state?missions.getDestinations(state):[])option(select,site.id,site.name); }
  destinations(el('mission-home'));
  function build() {
    editors=[];el('mission-objectives').replaceChildren();
    // Convenience templates, not an exhaustive action catalog or separate schema.
    const template=el('mission-kind').value==='mining'?[['extractResource','Mining destination']]:[['pickupCargo','Collect from'],['deliverCargo','Deliver to']];
    for(const [id,title] of template) {
      const contract=contracts.find(c=>c.id===id);if(!contract)continue;
      const section=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent=title;section.append(legend);
      const controls={}, labels={};
      function field(key,label,control) {const row=document.createElement('label'),caption=document.createElement('span');caption.textContent=label;row.append(caption,control);section.append(row);controls[key]=control;labels[key]=caption;control.dataset.field=key;control.onfocus=()=>{if(key==='destinationId')destinationField=control;};}
      const destination=document.createElement('select');destinations(destination);field('destinationId',title,destination);
      for(const [key,schema] of Object.entries(contract.parameters)) {
        const control=document.createElement(schema.type==='reference'?'select':'input');
        control.dataset.required=String(schema.required);
        const label=key.replace(/Id$/,'').replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase());
        if(schema.type==='reference') {
          if(!schema.required)option(control,'','Automatic');
          for(const candidate of contract.catalogs?.[schema.catalog] ?? [])option(control,candidate.id,candidate.name);
        } else {control.value='0.10';control.inputMode='decimal';}
        field(key,label,control);
      }
      const editor={id,contract,controls};editors.push(editor);el('mission-objectives').append(section);
      function quantityLabels(reset=false) {
        for(const [key,schema] of Object.entries(contract.parameters))if(schema.type==='quantity' && schema.itemField) {
          const itemId=controls[schema.itemField]?.value;
          const kind=contract.catalogs?.[contract.parameters[schema.itemField]?.catalog]?.find(c=>c.id===itemId)?.quantityKind ?? (content.items[itemId]?.category==='resource'?'bulk':'count');
          labels[key].textContent=kind==='bulk'?'Quantity (m³)':'Quantity (whole items)';
          if(reset)controls[key].value=kind==='bulk'?'0.10':'1';
        }
      }
      function scopedChoices() {
        for(const [key,schema] of Object.entries(contract.parameters))if(schema.destinationScoped) {
          const select=controls[key],previous=select.value;select.replaceChildren();
          const choices=(contract.catalogs[schema.catalog] ?? []).filter(c=>c.destinationId===destination.value);
          for(const c of choices)option(select,c.id,`${contract.catalogs.resources?.find(r=>r.id===c.resourceId)?.name ?? c.name}`);
          if(choices.some(c=>c.id===previous))select.value=previous;
          const chosen=choices.find(c=>c.id===select.value);if(chosen?.resourceId && controls.resourceId)controls.resourceId.value=chosen.resourceId;
        }
      }
      destination.onchange=()=>{scopedChoices();quantityLabels();preview();};
      for(const [key,control] of Object.entries(controls))if(key!=='destinationId')control.onchange=control.oninput=()=>{
        if(contract.parameters[key]?.destinationScoped) {
          const c=contract.catalogs[contract.parameters[key].catalog].find(c=>c.id===control.value && c.destinationId===destination.value);
          if(c?.resourceId && controls.resourceId)controls.resourceId.value=c.resourceId;
        }
        quantityLabels();preview();
      };
      scopedChoices();quantityLabels(true);
    }
    destinationField=editors[0]?.controls.destinationId;
  }
  function request() {
    const objectives=editors.map((e,i)=>({id:`objective${i+1}`,destinationId:e.controls.destinationId.value,action:e.id,parameters:Object.fromEntries(Object.entries(e.contract.parameters).flatMap(([key,schema])=>{
      const value=e.controls[key].value;if(!value && !schema.required)return [];return [[key,schema.type==='quantity'?Number(value):value]];
    }))}));
    return {vesselId,name:el('mission-kind').value==='mining'?'Mining run':'Cargo transport',homeLocationId:el('mission-home').value,objectives,returnPolicy:{onComplete:'home',onBlocked:'home'}};
  }
  function preview() {
    if(!state || !vesselId)return;
    const active=seen?.report?.mission && seen.report.mission.phase!=='COMPLETED';
    el('mission-replace-label').hidden=!active;
    el('mission-assign').textContent=active?'Upload new orders':'Assign and launch';
    el('mission-recall').disabled=!seen.commandable || !active;
    const r=request();if(active)r.revision=seen.report.mission.revision;
    const result=seen.commandable?missions.preview(state,r,'player',!!active):{ok:false,reason:'Reconnect locally or by radio to upload or preview new orders.'};
    holder.parentElement.dispatchEvent(new CustomEvent('mission-preview',{detail:result.ok?result.route.map(leg=>leg.targetId).filter(Boolean):[]}));
    const quantities=result.ok?result.accepted.objectives.flatMap(o=>{
      const contract=contracts.find(c=>c.id===o.action);
      return Object.entries(contract.parameters).filter(([,s])=>s.type==='quantity').map(([key,s])=>s.itemField ? `${formatQuantity(o.parameters[key],o.parameters[s.itemField],content)} ${content.items[o.parameters[s.itemField]].name}`:String(o.parameters[key]));
    }):[];
    el('mission-preview').textContent=result.ok?`${result.message} Estimated fuel: ${result.fuel} cartridges. Accepted: ${quantities.join('; ')}.`:result.reason;
    el('mission-assign').disabled=!result.ok || active && !el('mission-replace').checked;
    const local=seen.commandable?state.locations[vesselId]:null;
    const launchLink=local?.dockedAtId ? vesselLinkReason({...state,locations:{...state.locations,[vesselId]:{...local,dockedAtId:null}}},vesselId,services):null;
    el('mission-communication').textContent=`${launchLink?'This drone will lose contact on launch. ':''}Accepted orders continue without radio. Without a link, tracking and new orders wait until the drone returns. Current travel and active work finish before revised orders take effect.`;
  }
  el('mission-kind').onchange=()=>{build();preview();};el('mission-home').onchange=el('mission-replace').onchange=preview;
  el('mission-assign').onclick=()=>{const r=request(),m=seen?.report?.mission;if(m && m.phase!=='COMPLETED')r.revision=m.revision;onAction(r.revision===undefined?'assignMission':'updateMission',r);};
  el('mission-recall').onclick=()=>onAction('recallMission',{vesselId,revision:seen.report.mission.revision});
  holder.parentElement.addEventListener('mission-destination',event=>{if(destinationField && [...destinationField.options].some(o=>o.value===event.detail)){destinationField.value=event.detail;destinationField.dispatchEvent(new Event('change'));}});
  build();
  return (nextState,id,observed)=>{
    state=nextState;seen=observed;contracts=services.missionRuntimeContracts(state);
    const sites=missions.getDestinations(state),signature=JSON.stringify(sites);
    if(holder.dataset.destinations!==signature) {
      const initialized=holder.dataset.destinations!==undefined;
      holder.dataset.destinations=signature;
      // Retain drafts as sites become available; generated stationary berths are
      // runtime candidates, while the authoring facade keeps content identities.
      const previous=initialized?editors.map(e=>Object.fromEntries(Object.entries(e.controls).map(([k,c])=>[k,c.value]))):[],home=el('mission-home').value;
      el('mission-home').replaceChildren();destinations(el('mission-home'));build();
      editors.forEach((e,i)=>{
        const draft=previous[i];if(!draft)return;
        if([...e.controls.destinationId.options].some(o=>o.value===draft.destinationId))e.controls.destinationId.value=draft.destinationId;
        e.controls.destinationId.onchange();
        for(const [key,value] of Object.entries(draft))if(key!=='destinationId')e.controls[key].value=value;
      });
      if(sites.some(s=>s.id===home))el('mission-home').value=home;
    }
    if(vesselId!==id){vesselId=id;el('mission-replace').checked=false;const home=seen.report?.dockedAtId;if(home && [...el('mission-home').options].some(o=>o.value===home))el('mission-home').value=home;}
    const m=seen.report?.mission;
    const legacy=m?.currentRevisionOutcome.reasonCode==='LEGACY_UNSCOPED';
    el('mission-report').textContent=m?`${m.name} · ${m.phase}${m.pending?' · revised orders pending':''} · Current orders ${m.instructionRevision ?? '(legacy)'}: ${legacy?'legacy result scope unavailable':m.currentRevisionOutcome.status} · Mission lifetime: ${m.lifetimeOutcome.status} · ${m.progressText}${m.outcome.reasonCode&&!legacy?` · ${m.outcome.reasonCode}`:''}`:'No mission report received.';
    for(const control of holder.querySelectorAll('input,select'))control.disabled=!seen.commandable;
    preview();
  };
}
