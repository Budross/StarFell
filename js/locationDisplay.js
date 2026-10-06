import { locationDefinition, getEntityLabel } from "./entityQueries.js";
import { canUse } from "./authority.js";
import { graphView, areaOf, isKnown, getLocationContext } from "./locations.js";
import { storageSummary, describeStorage } from "./storage.js";
import { getActionStatus as legacyGetActionStatus } from "./playerActions.js";

const AREA_ENTRY_ZOOM = 4;
const UNSELECTED_AREA_ENTRY_ZOOM = 5;
const MAX_ZOOM = 5;
const AREA_MAP_SCALE = 2;
const OVERVIEW_PADDING = 20;

// All map navigation and form drafts are presentation state, never saved world state.
export default function locationDisplay(world, content, onAction, getGraph = graphView, getShipStatus = () => "", getActionStatus = legacyGetActionStatus,
  labelFor = (state, id) => getEntityLabel(state, { world }, id)) {
  const panel = document.querySelector("#locations-panel");
  panel.innerHTML = `
    <div class="map-toolbar">
      <span id="map-view" role="status"></span>
      <button id="ship-undock" type="button" hidden>Undock</button>
    </div>
    <p id="ship-status" class="local-store-label"></p>
    <div class="map-stage">
      <canvas id="location-map" tabindex="0" aria-label="Location map. Tab cycles nodes; Enter views area or focuses action; Plus and minus zoom; arrow keys pan; Escape returns to the area network."></canvas>
      <div class="map-controls">
        <button id="map-current" type="button">Current area</button>
        <button id="map-in" type="button" aria-label="Zoom in">+</button>
        <button id="map-out" type="button" aria-label="Zoom out">−</button>
      </div>
      <aside id="map-sidebar" aria-label="Selected location" hidden>
        <button id="map-close" type="button" aria-label="Close location details">Close ×</button>
        <h3 id="map-name"></h3><p id="map-owner"></p><p id="map-description"></p><p id="map-cargo"></p>
        <p id="map-reason" role="status"></p><button id="map-action" type="button">Travel</button>
      </aside>
      <section id="vessel-controls" class="vessel-controls drone-map-panel" aria-label="Drone controls" hidden></section>
    </div>
    <nav id="map-destinations" class="map-destinations" aria-label="Map destinations"></nav>
    <p class="map-legend"><span class="map-current-legend">◆ Your location / departure area</span> · ○ Selected · ? Detected · Dark grid: unmapped · Lines: known routes (local: docked ships) · Dashed ring: mission stop.</p>
    <button id="map-drones" type="button" aria-controls="vessel-controls" aria-expanded="false">Drone missions</button>`;
  const el = id => panel.querySelector(`#${id}`);
  const canvas = el("location-map"), ctx = canvas.getContext("2d"), sidebar = el("map-sidebar");
  el('map-drones').onclick=()=>{const holder=el('vessel-controls');holder.hidden=!holder.hidden;el('map-drones').setAttribute('aria-expanded',String(!holder.hidden));if(!holder.hidden)holder.dispatchEvent(new Event('open-drone-controls'));update();};
  const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
  let state, areaId = null, selectedId = "", collapsed = true, graph = { nodes: [], links: [] };
  let zoom = 1, pan = [0, 0], parent = null, drawn = [], graphSignature = "";
  let revealAll = false;
  let cameraMinimumZoom = 0.55;
  const mapGraph = targetArea => getGraph(state, world, content, targetArea, { revealAll });
  const lastSelectedSites = new Map();
  let panAnimation = null;
  let missionStops=[];
  let destinationSignature='';
  el('vessel-controls').addEventListener('mission-preview',event=>{
    const next=event.detail;
    if(JSON.stringify(next)!==JSON.stringify(missionStops)){missionStops=next;draw();}
  });

  function cancelPanAnimation() {
    if (panAnimation) {
      cancelAnimationFrame(panAnimation);
      panAnimation = null;
    }
  }

  function mapLayout(targetGraph, w, h) {
    const positions = targetGraph.nodes.map((node, i) => node.position ?? [
      Math.cos(i * Math.PI * 2 / Math.max(1, targetGraph.nodes.length)) * 55,
      Math.sin(i * Math.PI * 2 / Math.max(1, targetGraph.nodes.length)) * 55
    ]);
    const xs = positions.map(p => p[0]), ys = positions.map(p => p[1]);
    const minX = targetGraph.space?.min[0] ?? Math.min(0, ...xs), maxX = targetGraph.space?.max[0] ?? Math.max(0, ...xs), minY = targetGraph.space?.min[1] ?? Math.min(0, ...ys), maxY = targetGraph.space?.max[1] ?? Math.max(0, ...ys);
    // A small terminal viewport starts close enough to distinguish nearby anchors.
    // Camera scale depends on the fixed extent, never on what the player knows.
    const scale = (targetGraph.space ? AREA_MAP_SCALE : 1) * Math.max(targetGraph.space ? .75 : 0, Math.min((w - 150) / Math.max(100, maxX - minX), (h - 100) / Math.max(100, maxY - minY)));
    const minZoom = targetGraph.space ? Math.min(0.55,
      Math.max(1, w - OVERVIEW_PADDING * 2) / ((maxX - minX) * scale),
      Math.max(1, h - OVERVIEW_PADDING * 2) / ((maxY - minY) * scale)) : 0.55;
    return { positions, minX, maxX, minY, maxY, scale, minZoom };
  }

  function getPanForNode(nodeId, targetZoom = zoom, targetGraph = graph) {
    if (!nodeId || !targetGraph?.nodes?.length) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    if (!w || !h) return [0, 0];
    const idx = targetGraph.nodes.findIndex(n => n.id === nodeId);
    if (idx === -1) return [0, 0];
    const { positions, minX, maxX, minY, maxY, scale, minZoom } = mapLayout(targetGraph, w, h);
    if (targetGraph.space && targetZoom <= minZoom) return [0, 0];
    return [
      - (positions[idx][0] - (minX + maxX) / 2) * scale * targetZoom,
      - (positions[idx][1] - (minY + maxY) / 2) * scale * targetZoom
    ];
  }

  function select(id, animated = false) {
    const prevSelected = selectedId;
    selectedId = id;
    collapsed = !id;
    if(graph.nodes.find(n=>n.id===id)?.drone) {el('vessel-controls').hidden=false;el('map-drones').setAttribute('aria-expanded','true');el('vessel-controls').dispatchEvent(new CustomEvent('select-drone',{detail:id}));}
    else if(id)el('vessel-controls').dispatchEvent(new CustomEvent('mission-destination',{detail:id}));
    if (id && areaId) lastSelectedSites.set(areaId, id);
    cancelPanAnimation();
    if (id) {
      const targetPan = getPanForNode(id, zoom);
      const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if (animated && prevSelected && prevSelected !== id && !prefersReducedMotion) {
        const startPan = [...pan];
        const dist = Math.hypot(targetPan[0] - startPan[0], targetPan[1] - startPan[1]);
        const duration = Math.max(220, Math.min(400, dist * 0.7));
        const startTime = performance.now();
        function step(now) {
          const elapsed = now - startTime;
          const progress = Math.min(1, elapsed / duration);
          const ease = 1 - Math.pow(1 - progress, 3);
          pan = [
            startPan[0] + (targetPan[0] - startPan[0]) * ease,
            startPan[1] + (targetPan[1] - startPan[1]) * ease
          ];
          draw();
          if (progress < 1) {
            panAnimation = requestAnimationFrame(step);
          } else {
            pan = targetPan;
            panAnimation = null;
            draw();
          }
        }
        panAnimation = requestAnimationFrame(step);
      } else {
        pan = targetPan;
      }
    }
    update();
  }

  el("map-close").addEventListener("click", () => { collapsed = true; sidebar.hidden = true; canvas.focus(); });
  el("ship-undock").addEventListener("click", () => onAction("undock"));
  el("map-action").addEventListener("click", () => { const node = graph.nodes.find(n => n.id === selectedId); if (node?.actionId) onAction(node.actionId); });

  function enter(id) {
    cancelPanAnimation();
    if (locationDefinition(state, world, id)?.kind !== "area") return;
    if (!areaId) parent = { zoom, pan: [...pan], selectedId: selectedId || id };
    areaId = id;
    zoom = 1;
    graph = mapGraph(areaId);
    const restoredSite = lastSelectedSites.get(id);
    const siteToSelect = (restoredSite && graph.nodes.some(n => n.id === restoredSite))
      ? restoredSite
      : (graph.nodes.some(n => n.id === state.locationId) ? state.locationId : locationDefinition(state,world,id)?.primaryLocalId ?? "");
    selectedId = siteToSelect;
    collapsed = true;
    pan = selectedId ? getPanForNode(selectedId, zoom, graph) : [0, 0];
    update();
  }

  function back(isZoom = false) {
    cancelPanAnimation();
    if (!areaId) {
      zoom = 1;
      pan = [0, 0];
    } else {
      const exitingAreaId = areaId;
      if (selectedId) lastSelectedSites.set(exitingAreaId, selectedId);
      areaId = null;
      graph = mapGraph(null);
      zoom = Math.min(parent?.zoom ?? AREA_ENTRY_ZOOM / 1.25, MAX_ZOOM);
      const targetArea = (parent?.selectedId && locationDefinition(state, world, parent.selectedId)?.kind === "area")
        ? parent.selectedId
        : exitingAreaId;
      if (isZoom || parent?.selectedId) {
        selectedId = targetArea;
      } else {
        selectedId = parent?.selectedId ?? "";
      }
      pan = targetArea ? getPanForNode(targetArea, zoom, graph) : (parent?.pan ?? [0, 0]);
    }
    collapsed = true;
    update();
  }

  function changeZoom(direction) {
    if (!state) return;
    cancelPanAnimation();
    const next = zoom * (direction > 0 ? 1.25 : 0.8);
    if (areaId && next < 0.7) { back(true); return; }
    if (!areaId && direction > 0) {
      const selected = graph.nodes.find(n => n.id === selectedId && n.kind === "area");
      if (selected && next >= AREA_ENTRY_ZOOM) { enter(selected.id); return; }
      const bounds = canvas.getBoundingClientRect();
      const distances = drawn.filter(n=>n.kind==='area').map(n => ({ ...n, distance: Math.hypot(n.x - bounds.width / 2, n.y - bounds.height / 2) })).sort((a, b) => a.distance - b.distance);
      if (!selected && next >= UNSELECTED_AREA_ENTRY_ZOOM && distances[0]?.distance < Math.min(bounds.width, bounds.height) * 0.23 &&
          (!distances[1] || distances[0].distance < distances[1].distance * 0.55)) { enter(distances[0].id); return; }
    }
    const rect = canvas.getBoundingClientRect();
    const { minZoom } = mapLayout(graph, rect.width, rect.height);
    zoom = Math.max(minZoom, Math.min(MAX_ZOOM, next));
    if (graph.space && zoom <= minZoom) {
      pan = [0, 0];
    } else if (selectedId) {
      pan = getPanForNode(selectedId, zoom);
    }
    draw();
  }
  el("map-in").addEventListener("click", () => changeZoom(1));
  el("map-out").addEventListener("click", () => changeZoom(-1));
  el("map-current").addEventListener("click", () => enter(areaOf(state, world, state.locationId)));
  canvas.addEventListener("wheel", event => { event.preventDefault(); changeZoom(event.deltaY < 0 ? 1 : -1); }, { passive: false });
  canvas.addEventListener("keydown", event => {
    if (event.key === "Tab" && graph.nodes.length > 0) {
      event.preventDefault();
      const currentIndex = graph.nodes.findIndex(n => n.id === selectedId);
      const nextIndex = event.shiftKey
        ? (currentIndex <= 0 ? graph.nodes.length - 1 : currentIndex - 1)
        : (currentIndex === -1 || currentIndex >= graph.nodes.length - 1 ? 0 : currentIndex + 1);
      select(graph.nodes[nextIndex].id);
      return;
    }
    if (event.key === "Enter") {
      if (locationDefinition(state, world, selectedId)?.kind === "area") {
        event.preventDefault();
        enter(selectedId);
      } else if (selectedId && !sidebar.hidden) {
        event.preventDefault();
        el("map-action").focus();
      }
      return;
    }
    if (["+", "=", "-", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      if (["+", "="].includes(event.key)) changeZoom(1);
      else if (event.key === "-") changeZoom(-1);
      else if (event.key === "Escape") back(false);
      else {
        cancelPanAnimation();
        const offset = { ArrowLeft: [30, 0], ArrowRight: [-30, 0], ArrowUp: [0, 30], ArrowDown: [0, -30] }[event.key];
        if (offset) { pan = pan.map((v, i) => v + offset[i]); draw(); }
      }
    }
  });
  let pointer;
  canvas.addEventListener("pointerdown", event => {
    cancelPanAnimation();
    pointer = { x: event.clientX, y: event.clientY, pan: [...pan], moved: false };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", event => {
    if (!pointer) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (Math.hypot(dx, dy) > 5) pointer.moved = true;
    if (pointer.moved) { pan = [pointer.pan[0] + dx, pointer.pan[1] + dy]; draw(); }
  });
  canvas.addEventListener("pointerup", event => {
    if (pointer && !pointer.moved) {
      const rect = canvas.getBoundingClientRect();
      const node = drawn.map(n=>({node:n,distance:Math.hypot(n.x-(event.clientX-rect.left),n.y-(event.clientY-rect.top))})).filter(n=>n.distance<25).sort((a,b)=>a.distance-b.distance)[0]?.node;
      select(node?.id ?? "", true);
    }
    pointer = null;
  });
  canvas.addEventListener("pointercancel", () => { pointer = null; });

  function draw() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = window.devicePixelRatio || 1;
    const targetWidth = Math.round(rect.width * ratio);
    const targetHeight = Math.round(rect.height * ratio);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      if (selectedId) pan = getPanForNode(selectedId, zoom);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    const w = rect.width, h = rect.height;
    ctx.fillStyle = "#101916"; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#a9c6a20b"; ctx.lineWidth = 1;
    const { positions, minX, maxX, minY, maxY, scale, minZoom } = mapLayout(graph, w, h);
    const wasAtOverview = graph.space && zoom <= cameraMinimumZoom;
    cameraMinimumZoom = minZoom;
    zoom = wasAtOverview ? minZoom : Math.max(minZoom, zoom);
    if (graph.space && zoom <= minZoom) pan = [0, 0];
    if(graph.space) {
      const step=graph.space.cellSize*4;
      for(let x=minX;x<=maxX;x+=step){const px=w/2+(x-(minX+maxX)/2)*scale*zoom+pan[0];ctx.beginPath();ctx.moveTo(px,0);ctx.lineTo(px,h);ctx.stroke();}
      for(let y=minY;y<=maxY;y+=step){const py=h/2+(y-(minY+maxY)/2)*scale*zoom+pan[1];ctx.beginPath();ctx.moveTo(0,py);ctx.lineTo(w,py);ctx.stroke();}
    }else {
      for(let x=0;x<w;x+=30){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
      for(let y=0;y<h;y+=30){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
    }
    drawn = graph.nodes.map((node, i) => ({ ...node, x: w / 2 + ((positions[i][0] - (minX + maxX) / 2) * scale * zoom) + pan[0],
      y: h / 2 + ((positions[i][1] - (minY + maxY) / 2) * scale * zoom) + pan[1] }));
    const byId = new Map(drawn.map(node => [node.id, node]));
    ctx.strokeStyle = "#789a7966"; ctx.lineWidth = 1;
    for (const [a, b] of graph.links) { const p = byId.get(a), q = byId.get(b); if (!p || !q) continue; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
    ctx.font = "12px Consolas, monospace"; ctx.textAlign = "center";
    const playerColor = getComputedStyle(panel).getPropertyValue("--phosphor-blue").trim();
    for (const node of drawn) {
      const isPlayerLocation = node.current || node.containsPlayer;
      if(missionStops.includes(node.id) && !el('vessel-controls').hidden) {
        ctx.strokeStyle='#8cb9cc';ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.beginPath();ctx.arc(node.x,node.y,27,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
      }
      if (isPlayerLocation) { ctx.strokeStyle = playerColor; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(node.x, node.y, graph.space ? 13 : 23, 0, Math.PI * 2); ctx.stroke(); }
      if (node.id === selectedId) { ctx.strokeStyle = "#e6b86b"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(node.x, node.y, graph.space ? 10 : 18, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = isPlayerLocation ? playerColor : node.mobile ? "#8cb9cc" : "#a9c6a2";
      ctx.beginPath();
      if (isPlayerLocation) { ctx.moveTo(node.x, node.y - 9); ctx.lineTo(node.x + 9, node.y); ctx.lineTo(node.x, node.y + 9); ctx.lineTo(node.x - 9, node.y); ctx.closePath(); }
      else ctx.arc(node.x, node.y, graph.space ? 4 : 7, 0, Math.PI * 2);
      ctx.fill(); ctx.fillStyle = node.id === selectedId ? "#e6b86b" : "#bbcbbd";
      if(!graph.space || zoom>=2 || node.id===selectedId || isPlayerLocation || node.kind==='contact')ctx.fillText(node.kind==='contact'?'?':node.name, node.x, node.y + (graph.space ? 18 : 34));
    }
    canvas.dataset.view = areaId ?? "network";
    canvas.dataset.zoom = String(zoom);
    canvas.dataset.selected = selectedId;
    canvas.dataset.fogOfWar = revealAll ? 'off' : 'on';
  }

  function update() {
    if (!state) return;
    if (areaId && !revealAll && !isKnown(state, world, content, areaId)) {
      areaId = null; selectedId = ""; zoom = 1; pan = [0, 0]; parent = null;
    }
    graph = mapGraph(areaId);
    const signature=JSON.stringify(graph.nodes.map(n=>[n.id,n.name,n.position,n.kind]));
    if(signature!==destinationSignature) {
      destinationSignature=signature;
      el('map-destinations').replaceChildren(...graph.nodes.map(node=>{
        const button=document.createElement('button');button.type='button';
        button.textContent=`${node.kind==='contact'?'? Detected body':node.name}${node.position?` · ${node.kind==='contact'?'approx. ':''}(${node.position.join(', ')})`:''}`;
        button.onclick=()=>select(node.id);return button;
      }));
    }
    setText(el("ship-status"), getShipStatus(state, world));
    const undock = getActionStatus("undock");
    el("ship-undock").hidden = !undock.visible;
    el("ship-undock").disabled = !undock.available;
    el("ship-undock").title = undock.reason;
    if (!graph.nodes.some(node => node.id === selectedId)) { selectedId = ""; collapsed = true; }
    setText(el("map-view"), `${areaId ? locationDefinition(state, world, areaId).name : "Area network"}${revealAll ? ' · DEBUG: fog of war off' : ''}`);
    const node = graph.nodes.find(n => n.id === selectedId);
    if (sidebar.contains(document.activeElement) && (!node || collapsed)) canvas.focus();
    sidebar.hidden = !node || collapsed;
    if (node) {
      setText(el("map-name"), node.name);
      setText(el("map-owner"), node.current ? "Your current location" : node.owned ? "Player-owned" : node.ownerId ? `Owned by ${labelFor(state, node.ownerId)}` : node.kind === "area" ? "Area" : "Unowned");
      setText(el("map-description"), [node.description,node.position?`${node.kind==='contact'?'Detected · approximate':node.debugVisible?'Debug · coordinate':'Known · coordinate'} (${node.position.join(', ')})`:null,Number.isFinite(node.distance)?`Distance: ${node.distance.toFixed(1)}`:null].filter(Boolean).join(' · '));
      setText(el("map-cargo"), node.drone ? node.observable.report?.cargoText ?? '' : locationDefinition(state, world, node.id)?.kind === "site" && canUse(state, "player", node.id, "viewCargo")
        ? describeStorage(storageSummary(getLocationContext(state, content, world, node.id).store, content)) : "");
      const status = node.actionId ? getActionStatus(node.actionId) : { available: false, reason: node.drone?'Use Drone missions for accepted orders and last reported status.':"Board a ship to travel." };
      setText(el("map-reason"), [node.reason || status.reason, node.detail].filter(Boolean).join(" · "));
      setText(el("map-action"), node.actionLabel ?? "Travel");
      el("map-action").disabled = Boolean(node.reason) || !status.available;
    }
    const next = JSON.stringify([areaId, selectedId, zoom, pan, graph]);
    if (next !== graphSignature) { graphSignature = next; draw(); }
  }
  const observer = new ResizeObserver(draw); observer.observe(canvas);
  function renderLocations(nextState) {
    state = nextState;
    if (!state.vesselReports?.byVessel[selectedId] && (!state.locations[selectedId] || !canUse(state, "player", selectedId, "viewCargo"))) setText(el("map-cargo"), "");
    if (!panel.hidden) update();
  }
  renderLocations.toggleFogOfWar = () => {
    cancelPanAnimation();
    revealAll = !revealAll;
    graphSignature = '';
    update();
    return !revealAll;
  };
  renderLocations.select = id => {
    if (!state) return;
    const drone=state.vesselReports?.byVessel[id] ? world.observableVesselStatus(state,id):null;
    if(drone && drone.areaId===null) {el('vessel-controls').hidden=false;el('map-drones').setAttribute('aria-expanded','true');el('vessel-controls').dispatchEvent(new CustomEvent('select-drone',{detail:id}));return;}
    if(!drone && !revealAll && !isKnown(state,world,content,id))return;
    cancelPanAnimation(); areaId=drone ? drone.areaId:areaOf(state,world,id); selectedId=id; collapsed=false; zoom=1; pan=[0,0];
    update(); if(drone){el('vessel-controls').hidden=false;el('map-drones').setAttribute('aria-expanded','true');el('vessel-controls').dispatchEvent(new CustomEvent('select-drone',{detail:id}));}el('map-name').tabIndex=-1; el('map-name').focus({preventScroll:true});
  };
  return renderLocations;
}
