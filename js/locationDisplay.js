import { locationDefinition, getEntityLabel } from "./entityQueries.js";
import { canUse } from "./authority.js";
import { graphView, areaOf, isKnown, getLocationContext } from "./locations.js";
import { storageSummary, describeStorage } from "./storage.js";
import { getActionStatus as legacyGetActionStatus } from "./playerActions.js";

// All map navigation and form drafts are presentation state, never saved world state.
export default function locationDisplay(world, content, onAction, getGraph = graphView, getShipStatus = () => "", getActionStatus = legacyGetActionStatus,
  labelFor = (state, id) => getEntityLabel(state, { world }, id)) {
  const panel = document.querySelector("#locations-panel");
  panel.innerHTML = `
    <div class="map-toolbar">
      <div class="map-controls">
        <button id="map-current" type="button">Current area</button>
        <button id="map-in" type="button" aria-label="Zoom in">+</button>
        <button id="map-out" type="button" aria-label="Zoom out">−</button>
      </div>
      <span id="map-view" role="status"></span>
      <button id="ship-undock" type="button" hidden>Undock</button>
    </div>
    <p id="ship-status" class="local-store-label"></p>
    <div class="map-stage">
      <canvas id="location-map" tabindex="0" aria-label="Location map. Tab cycles nodes; Enter views area or focuses action; Plus and minus zoom; arrow keys pan; Escape returns to the area network."></canvas>
      <aside id="map-sidebar" aria-label="Selected location" hidden>
        <button id="map-close" type="button" aria-label="Close location details">Close ×</button>
        <h3 id="map-name"></h3><p id="map-owner"></p><p id="map-description"></p><p id="map-cargo"></p>
        <p id="map-reason" role="status"></p><button id="map-action" type="button">Travel</button>
      </aside>
    </div>
    <p class="map-legend">◆ Your location / departure area · ○ Selected · Network lines: ship routes. Local lines: docked ships. Selecting and zooming only browse.</p>
    <section id="vessel-controls" class="vessel-controls" aria-label="Drone controls"></section>`;
  const el = id => panel.querySelector(`#${id}`);
  const canvas = el("location-map"), ctx = canvas.getContext("2d"), sidebar = el("map-sidebar");
  const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
  let state, areaId = null, selectedId = "", collapsed = true, graph = { nodes: [], links: [] };
  let zoom = 1, pan = [0, 0], parent = null, drawn = [], graphSignature = "";
  const lastSelectedSites = new Map();
  let panAnimation = null;

  function cancelPanAnimation() {
    if (panAnimation) {
      cancelAnimationFrame(panAnimation);
      panAnimation = null;
    }
  }

  function getPanForNode(nodeId, targetZoom = zoom, targetGraph = graph) {
    if (!nodeId || !targetGraph?.nodes?.length) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    if (!w || !h) return [0, 0];
    const idx = targetGraph.nodes.findIndex(n => n.id === nodeId);
    if (idx === -1) return [0, 0];
    const positions = targetGraph.nodes.map((node, i) => node.position ?? [
      Math.cos(i * Math.PI * 2 / Math.max(1, targetGraph.nodes.length)) * 55,
      Math.sin(i * Math.PI * 2 / Math.max(1, targetGraph.nodes.length)) * 55
    ]);
    const xs = positions.map(p => p[0]), ys = positions.map(p => p[1]);
    const minX = Math.min(0, ...xs), maxX = Math.max(0, ...xs), minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys);
    const scale = Math.min((w - 150) / Math.max(100, maxX - minX), (h - 100) / Math.max(100, maxY - minY));
    return [
      - (positions[idx][0] - (minX + maxX) / 2) * scale * targetZoom,
      - (positions[idx][1] - (minY + maxY) / 2) * scale * targetZoom
    ];
  }

  function select(id, animated = false) {
    const prevSelected = selectedId;
    selectedId = id;
    collapsed = !id;
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
    graph = getGraph(state, world, content, areaId);
    const restoredSite = lastSelectedSites.get(id);
    const siteToSelect = (restoredSite && graph.nodes.some(n => n.id === restoredSite))
      ? restoredSite
      : (graph.nodes.some(n => n.id === state.locationId) ? state.locationId : "");
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
      graph = getGraph(state, world, content, null);
      zoom = Math.min(parent?.zoom ?? 1.4, 1.4);
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
      if (selected && next >= 1.8) { enter(selected.id); return; }
      const bounds = canvas.getBoundingClientRect();
      const distances = drawn.map(n => ({ ...n, distance: Math.hypot(n.x - bounds.width / 2, n.y - bounds.height / 2) })).sort((a, b) => a.distance - b.distance);
      if (!selected && next >= 2.5 && distances[0]?.distance < Math.min(bounds.width, bounds.height) * 0.23 &&
          (!distances[1] || distances[0].distance < distances[1].distance * 0.55)) { enter(distances[0].id); return; }
    }
    zoom = Math.max(0.55, Math.min(5, next));
    if (selectedId) {
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
      const node = drawn.find(n => Math.hypot(n.x - (event.clientX - rect.left), n.y - (event.clientY - rect.top)) < 25);
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
    for (let x = 0; x < w; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    const positions = graph.nodes.map((node, i) => node.position ?? [Math.cos(i * Math.PI * 2 / Math.max(1, graph.nodes.length)) * 55, Math.sin(i * Math.PI * 2 / Math.max(1, graph.nodes.length)) * 55]);
    const xs = positions.map(p => p[0]), ys = positions.map(p => p[1]);
    const minX = Math.min(0, ...xs), maxX = Math.max(0, ...xs), minY = Math.min(0, ...ys), maxY = Math.max(0, ...ys);
    const scale = Math.min((w - 150) / Math.max(100, maxX - minX), (h - 100) / Math.max(100, maxY - minY));
    drawn = graph.nodes.map((node, i) => ({ ...node, x: w / 2 + ((positions[i][0] - (minX + maxX) / 2) * scale * zoom) + pan[0],
      y: h / 2 + ((positions[i][1] - (minY + maxY) / 2) * scale * zoom) + pan[1] }));
    const byId = new Map(drawn.map(node => [node.id, node]));
    ctx.strokeStyle = "#789a7966"; ctx.lineWidth = 1;
    for (const [a, b] of graph.links) { const p = byId.get(a), q = byId.get(b); if (!p || !q) continue; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
    ctx.font = "12px Consolas, monospace"; ctx.textAlign = "center";
    for (const node of drawn) {
      if (node.id === selectedId) { ctx.strokeStyle = "#e6b86b"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(node.x, node.y, 18, 0, Math.PI * 2); ctx.stroke(); }
      ctx.fillStyle = node.mobile ? "#8cb9cc" : node.kind === "object" ? "#88938c" : "#a9c6a2";
      ctx.beginPath();
      if (node.current || node.containsPlayer) { ctx.moveTo(node.x, node.y - 9); ctx.lineTo(node.x + 9, node.y); ctx.lineTo(node.x, node.y + 9); ctx.lineTo(node.x - 9, node.y); ctx.closePath(); }
      else ctx.arc(node.x, node.y, node.kind === "object" ? 4 : 7, 0, Math.PI * 2);
      ctx.fill(); ctx.fillStyle = node.id === selectedId ? "#e6b86b" : "#bbcbbd";
      ctx.fillText(node.name, node.x, node.y + 34);
    }
    canvas.dataset.view = areaId ?? "network";
    canvas.dataset.zoom = String(zoom);
    canvas.dataset.selected = selectedId;
  }

  function update() {
    if (!state) return;
    if (areaId && !isKnown(state, world, content, areaId)) { areaId = null; selectedId = ""; }
    graph = getGraph(state, world, content, areaId);
    setText(el("ship-status"), getShipStatus(state, world));
    const undock = getActionStatus("undock");
    el("ship-undock").hidden = !undock.visible;
    el("ship-undock").disabled = !undock.available;
    el("ship-undock").title = undock.reason;
    if (!graph.nodes.some(node => node.id === selectedId)) { selectedId = ""; collapsed = true; }
    setText(el("map-view"), areaId ? locationDefinition(state, world, areaId).name : "Area network");
    const node = graph.nodes.find(n => n.id === selectedId);
    if (sidebar.contains(document.activeElement) && (!node || collapsed)) canvas.focus();
    sidebar.hidden = !node || collapsed;
    if (node) {
      setText(el("map-name"), node.name);
      setText(el("map-owner"), node.kind === "object" ? "Scene object" : node.current ? "Your current location" : node.owned ? "Player-owned" : node.ownerId ? `Owned by ${labelFor(state, node.ownerId)}` : node.kind === "area" ? "Area" : "Unowned");
      setText(el("map-description"), node.description);
      setText(el("map-cargo"), locationDefinition(state, world, node.id)?.kind === "site" && canUse(state, "player", node.id, "viewCargo")
        ? describeStorage(storageSummary(getLocationContext(state, content, world, node.id).store, content)) : "");
      const status = node.actionId ? getActionStatus(node.actionId) : { available: false, reason: "Board a ship to travel." };
      setText(el("map-reason"), [node.reason || status.reason, node.detail].filter(Boolean).join(" · "));
      setText(el("map-action"), node.kind === "object" ? "Inspect" : node.actionLabel ?? "Travel");
      el("map-action").disabled = Boolean(node.reason) || !status.available;
    }
    const next = JSON.stringify([areaId, selectedId, zoom, pan, graph]);
    if (next !== graphSignature) { graphSignature = next; draw(); }
  }
  const observer = new ResizeObserver(draw); observer.observe(canvas);
  return function renderLocations(nextState) {
    state = nextState;
    if (!state.locations[selectedId] || !canUse(state, "player", selectedId, "viewCargo")) setText(el("map-cargo"), "");
    if (!panel.hidden) update();
  };
}
