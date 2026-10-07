import {subjectKey} from './immediateLocation.js';

// This renderer holds selection/disclosure only. All noun/verb admission is read
// fresh from the domain projections; all mutations use the existing action path.
export default function surroundingsDisplay({views,getActionStatus,onAction,onObserve,onOpen,onSelect}) {
  const panel=document.querySelector('#surroundings'),workspace=document.querySelector('#terminal-workspace'),toggle=document.querySelector('#surroundings-toggle');
  const heading=document.querySelector('#surroundings-heading'),context=document.querySelector('#subject-context'),contextHeading=document.querySelector('#subject-heading');
  const commands=new Map(),buttons=new Map();let state,selected=null,opener=null,activeTab='operations',otherExpanded=false,operationsExpanded=true;
  const setText=(el,value)=>{if(el.textContent!==value)el.textContent=value;};
  function disclose(){const expanded=activeTab==='operations'?operationsExpanded:otherExpanded;panel.hidden=!expanded;toggle.setAttribute('aria-expanded',String(expanded));workspace.classList.toggle('surroundings-expanded',expanded);}
  toggle.addEventListener('click',()=>{if(activeTab==='operations')operationsExpanded=!operationsExpanded;else otherExpanded=!otherExpanded;disclose();});
  function list(container,rows,empty='') {
    const keys=new Set(rows.map(r=>r.key));
    for(const button of [...container.children])if(button.tagName==='BUTTON'&&!keys.has(button.dataset.key)){
      if(button===document.activeElement)heading.focus({preventScroll:true});buttons.delete(button.dataset.key);button.remove();
    }
    let emptyNode=container.querySelector('.surroundings-empty');
    if(rows.length){emptyNode?.remove();}
    else if(empty){if(!emptyNode){emptyNode=document.createElement('p');emptyNode.className='surroundings-empty';container.append(emptyNode);}setText(emptyNode,empty);}
    rows.forEach((row,i)=>{
      let button=buttons.get(row.key);if(!button){button=document.createElement('button');button.type='button';button.dataset.key=row.key;
        button.append(document.createElement('span'),document.createElement('small'));buttons.set(row.key,button);}
      if(container.children[i]!==button)container.insertBefore(button,container.children[i]??null);
      setText(button.children[0],row.name);setText(button.children[1],row.status??'');button.disabled=!!row.disabled;
      button.setAttribute('aria-label',row.label??row.name);button.classList.toggle('selected',!!row.selected);
      button.title=row.reason??'';commands.set(row.key,row.run);
    });
  }
  function clear(){selected=null;context.hidden=true;if(opener?.isConnected&&!opener.closest('[hidden]'))opener.focus({preventScroll:true});else heading.focus({preventScroll:true});render(state);}
  document.querySelector('#subject-clear').addEventListener('click',clear);
  context.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();clear();}});
  for(const surface of [panel,context])surface.addEventListener('click',event=>{const button=event.target.closest('button[data-key]');if(button&&!button.disabled)commands.get(button.dataset.key)?.(button);});
  document.querySelector('#surroundings-locations').addEventListener('click',()=>onOpen({tab:'locations'}));
  function render(next){
    state=next;commands.clear();const spatial=views.immediateLocationView(state);
    setText(document.querySelector('#position-breadcrumb'),spatial.position.breadcrumbs.join(' / '));setText(heading,spatial.position.title);
    list(document.querySelector('#surroundings-here'),spatial.here.map(e=>({key:`here:${e.id}`,name:e.name,status:e.status,disabled:!!e.reason,reason:e.reason,
      label:`Move to ${e.name}${e.reason?`. ${e.reason}`:''}`,run:()=>onAction(`moveLocal:${e.id}`)})),'No other local places observed.');
    list(document.querySelector('#surroundings-present'),spatial.present.map(e=>({key:`present:${subjectKey(e.ref)}`,name:e.name,status:e.status,
      label:`Select ${e.name}`,selected:selected&&subjectKey(selected)===subjectKey(e.ref),run:button=>{
        selected=e.ref;opener=button;onSelect();render(state);contextHeading.focus({preventScroll:true});context.scrollIntoView({block:'nearest'});
      }})),'No distinct subjects perceived here.');
    list(document.querySelector('#surroundings-nearby'),spatial.nearby.map(e=>({key:`nearby:${subjectKey(e.ref)}`,name:e.name,status:e.status,label:`Select destination ${e.name}`,
      run:button=>{selected=e.ref;opener=button;onSelect();render(state);contextHeading.focus({preventScroll:true});context.scrollIntoView({block:'nearest'});}})),'No immediate destinations observed.');
    context.hidden=!selected;
    if(selected){
      const view=views.subjectInteractionView(state,selected,getActionStatus);
      setText(contextHeading,view.name);setText(document.querySelector('#subject-status'),view.status??'');setText(document.querySelector('#subject-description'),view.description??'');
      const service=view.serviceAccess?.mode;setText(document.querySelector('#subject-service'),service&&service!=='local'?`${service==='facility'?'Facility':'Remote'} access`:'');
      list(document.querySelector('#subject-actions'),[
        ...view.actions.map(a=>({key:`verb:${a.id}`,name:a.name,status:a.reason||a.description||'',reason:a.reason,disabled:!a.available,run:()=>{
          // Re-read before activation: a moving NPC/removed object cannot keep a
          // stale read-only observation or link alive between refreshes.
          const current=views.subjectInteractionView(state,selected,getActionStatus).actions.find(v=>v.id===a.id);
          if(!current?.available)return;
          if(current.request)onObserve(current.request);else{const result=onAction(current.id,current.payload);if(result?.ok&&current.id==='dialogue:start')onOpen({tab:'people'});}
        }})),
        ...view.links.map(link=>({key:`link:${link.tab}`,name:link.name,run:()=>onOpen(link)}))
      ],view.available?'No further actions available.':'');
    }else list(document.querySelector('#subject-actions'),[]);
    disclose();
    return spatial;
  }
  render.setActiveTab=id=>{activeTab=id;if(selected?.hostId!==state?.locationId)selected=null;disclose();};
  // The renderer need not inspect raw definitions to find mapped verbs: the
  // interaction projection supplies them, including unavailable contextual verbs.
  render.mappedActionIds=()=>{
    if(!state)return new Set();const ids=new Set();
    for(const e of views.immediateLocationView(state).present){
      if(e.ref.kind==='scene')ids.add(`inspect:${e.ref.hostId}:${e.ref.id}`);
      if(e.ref.kind==='equipment')ids.add(`observe-equipment:${e.ref.hostId}:${e.ref.id}`);
      for(const a of views.subjectInteractionView(state,e.ref,getActionStatus).actions)if(!a.request&&a.id!=='dialogue:start')ids.add(a.id);
    }return ids;
  };
  return render;
}
