import {cellAt,cellKey,cellPosition,compareKeys,containsPosition,distanceSquared,keyedRandom,validateSpace} from './worldSpace.js';

export function placeDestinations(seed,profile,anchors,startPosition,attempt=0) {
  const space=validateSpace(profile.space), cfg=profile.placement;
  const ordered=[...anchors].sort((a,b)=>compareKeys(a.id,b.id)), occupied=new Set();
  for(const a of ordered) {
    if(!containsPosition(space,a.position) || occupied.has(cellKey(cellAt(space,a.position)))) throw new Error('Authored anchors overlap or exceed world bounds.');
    occupied.add(cellKey(cellAt(space,a.position)));
  }
  const patches=Array.from({length:cfg.patchCount},(_,i)=>({position:space.min.map((n,j)=>n+keyedRandom(seed,'density',i,j)*(space.max[j]-n)),value:keyedRandom(seed,'density',i,'value')}));
  const candidates=[];
  for(let x=0;x<(space.max[0]-space.min[0])/space.cellSize;x++)for(let y=0;y<(space.max[1]-space.min[1])/space.cellSize;y++) {
    const cell=[x,y], placementKey=cellKey(cell), position=cellPosition(space,cell);
    if(occupied.has(placementKey))continue;
    // Broad density patches leave substantial empty space independently of geology.
    const nearest=patches.map((p,i)=>({i,d:distanceSquared(position,p.position),p})).sort((a,b)=>a.d-b.d||a.i-b.i)[0];
    const density=cfg.densityFloor+(1-cfg.densityFloor)*nearest.p.value;
    const nearStart=distanceSquared(position,startPosition)<cfg.startRadius**2;
    const priority=-Math.log(Math.max(1e-12,keyedRandom(seed,'placement',attempt,placementKey)))/(nearStart?Math.max(cfg.startDensity,density):density);
    candidates.push({placementKey,cell,position,priority});
  }
  candidates.sort((a,b)=>a.priority-b.priority||compareKeys(a.placementKey,b.placementKey));
  const accepted=[];
  for(const c of candidates) {
    if(ordered.some(a=>distanceSquared(a.position,c.position)<Math.max(cfg.minSpacing,a.exclusionRadius??0,a.minimumSpacing??0)**2) || accepted.some(a=>distanceSquared(a.position,c.position)<cfg.minSpacing**2))continue;
    accepted.push(c);if(accepted.length>=Math.min(cfg.targetCount,cfg.maxCount))break;
  }
  return accepted.sort((a,b)=>compareKeys(a.placementKey,b.placementKey));
}

export function deriveTopology(areas,rootId,config,requiredEdges=[]) {
  const nodes=[...areas].sort((a,b)=>compareKeys(a.id,b.id)), byId=new Map(nodes.map(a=>[a.id,a]));
  if(byId.size!==nodes.length || !byId.has(rootId))throw new Error('Invalid spatial identities/root.');
  const valid=[];
  for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++) {
    const d=distanceSquared(nodes[i].position,nodes[j].position);
    if(d<=config.maxDistance**2)valid.push({a:nodes[i].id,b:nodes[j].id,d});
  }
  valid.sort((a,b)=>a.d-b.d||compareKeys(a.a,b.a)||compareKeys(a.b,b.b));
  const reachable=new Set([rootId]);let changed=true;
  while(changed){changed=false;for(const e of valid)if(reachable.has(e.a)!==reachable.has(e.b)){reachable.add(e.a);reachable.add(e.b);changed=true;}}
  const parent=new Map([...reachable].map(id=>[id,id]));
  const find=id=>{while(parent.get(id)!==id)id=parent.get(id);return id;};
  const selected=new Map(), edgeKey=(a,b)=>[a,b].sort(compareKeys).join('/');
  const add=e=>selected.set(edgeKey(e.a,e.b),[e.a,e.b]);
  for(const e of valid)if(reachable.has(e.a)&&reachable.has(e.b)&&find(e.a)!==find(e.b)){parent.set(find(e.a),find(e.b));add(e);}
  for(const id of [...reachable].sort(compareKeys)) {
    let count=0;for(const e of valid)if((e.a===id||e.b===id)&&reachable.has(e.a)&&reachable.has(e.b)&&!selected.has(edgeKey(e.a,e.b))) {
      if(count>=config.extraEdgesPerNode)break;add(e);count++;
    }
  }
  for(const [a,b] of requiredEdges){const e=valid.find(e=>edgeKey(e.a,e.b)===edgeKey(a,b));if(!e||!reachable.has(a))throw new Error('Required physical edge exceeds range.');add(e);}
  return {reachable:[...reachable].sort(compareKeys),edges:[...selected.values()].sort((a,b)=>compareKeys(edgeKey(...a),edgeKey(...b)))};
}
