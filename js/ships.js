import { locationDefinition, locationInstances } from "./entityQueries.js";
import { isEntityActive } from "./entities.js";
import { permissionReason, canUse } from "./authority.js";
import { entityReference } from "./entityReferences.js";
import { isTerminal } from "./entities.js";
import { propulsionOutput } from "./equipment.js";
import { pay } from "./resources.js";
import { conditionReason } from "./conditionContext.js";
import { getLocationContext, isKnown, graphView, physicalLinks } from "./locations.js";
import { deriveVessel, vesselSpeed } from './vessels.js';
import { consumeVesselFuel } from './vesselFuel.js';
import { VESSEL_REFERENCE_MASS_KG } from './vesselModuleCatalog.js';

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
export const isShip = (world, id, state = {}) => locationDefinition(state, world, id)?.mobile === true;

// Speed is snapshotted at departure. Equipment changes affect the next journey.
export function shipSpeed(state, shipId, world, content) {
  const def = locationDefinition(state, world, shipId), local = state.locations[shipId];
  if (!def?.mobile || !local) return 0;
  const speed = def.travelSpeed * propulsionOutput(local.infrastructure, def.propulsionCapability, content);
  return local.assembly ? vesselSpeed(deriveVessel(local.assembly, content), local.infrastructure, content, def.travelSpeed) : speed;
}

export function journeyQuote(state, targetId, world, content, shipId = state.locationId) {
  const ship = locationDefinition(state, world, shipId), target = locationDefinition(state, world, targetId);
  if (!ship?.mobile || !target) return null;
  const local = state.locations[ship.id];
  const area = target.kind === "area";
  const origin = locationDefinition(state, world, local.areaId);
  const distance = area ? Math.hypot(target.position[0] - origin.position[0], target.position[1] - origin.position[1]) : ship.localTravelDistance;
  const speed = shipSpeed(state, ship.id, world, content);
  const quote = { kind: area ? "area" : "dock", targetId, originAreaId: local.areaId,
    powerCost: area ? ship.areaTravelPowerCost : ship.localTravelPowerCost,
    duration: speed > 0 ? distance / speed : Infinity };
  if (local.assembly) {
    const vessel = deriveVessel(local.assembly, content);
    let contribution = 0, rate = 0, fuelItemId;
    for (const [id, count] of Object.entries(vessel.counts)) {
      const module = content.vesselModules[id], drive = module.capabilities?.propulsion, machine = local.infrastructure[module.group];
      if (!drive || !machine.enabled || machine.health <= 0) continue;
      const output = drive.travelSpeed * count * machine.health;
      contribution += output; rate += output / drive.distancePerFuelUnit; fuelItemId = drive.fuelItemId;
    }
    const units = contribution > 0 ? Math.max(1, Math.ceil(distance * rate / contribution * vessel.dryMassKg / VESSEL_REFERENCE_MASS_KG)) : 0;
    if (!Number.isSafeInteger(units) || units < 0) throw new Error('Vessel fuel quote exceeds safe numeric bounds.');
    Object.assign(quote, { fuelItemId, fuelUnits: units, dryMassKg: vessel.dryMassKg });
  }
  return quote;
}

export function navigationReason(state, operation, targetId, world, content, shipId = state.locationId, actorId = "player") {
  return previewNavigation(state,operation,targetId,world,content,shipId,actorId).reason;
}
export function previewNavigation(state, operation, targetId, world, content, shipId = state.locationId, actorId = "player") {
  const result=(reason,code='BLOCKED')=>({ok:!reason,reason,code:reason ? code:null});
  if (!state.locations[shipId] || !locationDefinition(state,world,shipId)) return result('This ship or site is unavailable.');
  if (state.entities && !isEntityActive(state, shipId)) return result("This ship or site is unavailable.");
  const current = getLocationContext(state, content, world, shipId, actorId);
  const target = locationDefinition(state, world, targetId);
  if (operation === "board") {
    if (!target?.mobile) return result("Choose a ship to board.");
    if (target.boardable === false) return result('Autonomous vessels cannot carry occupants.');
    if (current.definition.mobile) return result("Disembark at a site before boarding another ship.");
    const ship = state.locations[targetId];
    if (ship.journey || ship.dockedAtId !== current.id || ship.areaId !== current.local.areaId) return result("The ship must be docked at your current site.");
    if (!isKnown(state, world, content, targetId)) return result("This ship is not yet known.");
    return result(permissionReason(state, actorId, targetId, "enter") || conditionReason(current.actionState, target.accessConditions, content));
  }
  if (!current.definition.mobile) return result("Board a ship to travel between locations.");
  if (current.local.journey) return result("A journey is already in progress. Wait for arrival.",'JOURNEY');
  if (!["board", "disembark"].includes(operation) && !canUse(state, actorId, shipId, "pilot") && !(actorId === "player" && state.locationId === shipId && canUse(state, actorId, shipId, "passengerNavigation"))) return result("Requires pilot permission.");
  if (operation === "undock") return result(current.local.dockedAtId ? "" : "The ship is already undocked.");
  if (!target || !isKnown(state, world, content, targetId)) return result("This destination is not yet known.");
  if (operation === "disembark") {
    if (current.local.dockedAtId !== targetId) return result("Dock at this site before disembarking.");
    return result(permissionReason(state, actorId, targetId, "enter") || conditionReason(current.actionState, target.accessConditions, content));
  }
  if (!["travel", "dock"].includes(operation)) return result("Unknown navigation operation.");
  if (current.local.dockedAtId) return result("Undock before starting a journey.");
  if (operation === "travel") {
    if (target.kind !== "area") return result("Choose an area destination.");
    if (targetId === current.local.areaId) return result("The ship is already in this area.");
    if (!physicalLinks(state,world).some(([a, b]) => (a === current.local.areaId && b === targetId) || (b === current.local.areaId && a === targetId))) return result("This area is beyond connection range.");
  } else if (target.kind !== "site" || target.mobile) return result("Docking requires a stationary site.");
  else if (state.locations[targetId].areaId !== current.local.areaId) return result("Travel to this site's area first.");
  const access = permissionReason(state, actorId, targetId, operation === "dock" ? "dock" : "enter") || conditionReason(current.actionState, target.accessConditions, content);
  if (access) return result(access);
  const quote = journeyQuote(state, targetId, world, content, shipId);
  if (!(quote.duration > 0) || !Number.isFinite(quote.duration)) return result("Requires operational propulsion with positive travel speed.");
  if (current.local.resources.power < quote.powerCost) return result("Insufficient ship power for this journey.",'POWER');
  if (current.local.assembly && (current.local.fuel.items[quote.fuelItemId] ?? 0) < quote.fuelUnits) return result('Insufficient loaded vessel fuel.','FUEL');
  if (quote.powerCost > 0 && current.local.resources.power - quote.powerCost === current.local.resources.power) return result("Journey power cost is too small to debit accurately.");
  return result('');
}

export function navigate(state, operation, targetId, world, content, shipId = state.locationId, actorId = "player", ledgerServices) {
  if (["board", "disembark"].includes(operation) && (actorId !== "player" || shipId !== state.locationId)) throw new Error("Player navigation requires the current location.");
  const reason = navigationReason(state, operation, targetId, world, content, shipId, actorId);
  if (reason) throw new Error(reason);
  const local = state.locations[shipId];
  const name = locationDefinition(state, world, targetId)?.name;
  if (operation === "board" || operation === "disembark") {
    state.locationId = targetId;
    return `${operation === "board" ? "Boarded" : "Disembarked at"} ${name}. ${locationDefinition(state, world, targetId).description}`;
  }
  if (operation === "undock") {
    const dock = locationDefinition(state, world, local.dockedAtId).name;
    local.dockedAtId = null;
    return `Undocked from ${dock}.`;
  }
  const quote = journeyQuote(state, targetId, world, content, shipId);
  const { powerCost, kind, originAreaId, duration } = quote;
  pay(getLocationContext(state, content, world, shipId, actorId).store, { power: powerCost }, content);
  if (local.assembly) consumeVesselFuel(state, shipId, quote.fuelItemId, quote.fuelUnits, content);
  const journey = { kind, targetId, originAreaId, duration };
  local.journey = { ...journey, remaining: duration };
  ledgerServices?.append(state, { type: 'SHIP_DEPARTED', actorId: shipId, targetId,
    locationId: journey.originAreaId, areaId: journey.originAreaId,
    data: { kind: journey.kind, originAreaId: journey.originAreaId, destinationId: targetId, initiatorId: actorId } });
  return `Departing for ${name}. Journey time: ${formatDuration(journey.duration)}. Ship power used: ${powerCost}.`;
}

export function formatDuration(seconds) {
  return `${Math.ceil(seconds)}s`;
}

// Called on the same candidate as power simulation. Caller saves before publishing arrivals.
export function advanceJourneys(state, elapsedSeconds, world, ledgerServices) {
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return [];
  const arrivals = [];
  for (const [id, local] of Object.entries(state.locations)) {
    if (!local.journey || state.entities && !isEntityActive(state, id)) continue;
    local.journey.remaining = Math.max(0, local.journey.remaining - elapsedSeconds);
    if (local.journey.remaining > 0) continue;
    const { kind, targetId, originAreaId } = local.journey;
    if (kind === "area") local.areaId = targetId;
    else local.dockedAtId = targetId;
    local.journey = null;
    ledgerServices?.append(state, { type: 'SHIP_ARRIVED', actorId: id, targetId,
      locationId: targetId, areaId: local.areaId, data: { kind, originAreaId, destinationId: targetId } });
    arrivals.push({ shipId: id, targetId, message: `${locationDefinition(state, world, id).name} ${kind === "area" ? "arrived in" : "docked at"} ${locationDefinition(state, world, targetId).name}. ${locationDefinition(state, world, targetId).description}` });
  }
  return arrivals;
}

export function validateShipStates(state, world) {
  for (const def of locationInstances(state, world, ["active", "inactive"])) {
    const id = def.id;
    const local = state.locations[id];
    const fail = field => { throw new Error(`Invalid ${field} at ${id}.`); };
    if (!def.mobile) {
      if (local.dockedAtId !== undefined || local.journey !== undefined) fail("ship state on a stationary location");
      continue;
    }
    const dock = locationDefinition(state, world, local.dockedAtId);
    if (local.dockedAtId !== null && (typeof local.dockedAtId !== "string" || dock?.kind !== "site" || dock.mobile || state.locations[dock.id].areaId !== local.areaId)) fail("dockedAtId");
    const journey = local.journey;
    if (journey === null) continue;
    if (!record(journey) || local.dockedAtId !== null || journey.originAreaId !== local.areaId ||
        !["area", "dock"].includes(journey.kind) || !Number.isFinite(journey.duration) || journey.duration <= 0 ||
        !Number.isFinite(journey.remaining) || journey.remaining <= 0 || journey.remaining > journey.duration) fail("journey");
    const target = locationDefinition(state, world, journey.targetId);
    if (journey.kind === "area") {
      if (target?.kind !== "area" || !physicalLinks(state,world).some(([a, b]) => (a === local.areaId && b === target.id) || (b === local.areaId && a === target.id))) fail("journey target");
    } else if (target?.kind !== "site" || target.mobile || state.locations[target.id].areaId !== local.areaId) fail("journey docking target");
    if (!state.entities && state.locationId !== id) fail("unoccupied active journey");
  }
}

export function createShipActions(world, content, ledgerServices) {
  return ["board", "travel", "dock", "disembark", "undock"].map(operation => {
    const verb = { board: "Board", dock: "Dock at", disembark: "Disembark at", travel: "Travel to", undock: "Undock" }[operation];
    return { id: operation, name: verb, group: "navigation", scope: "global", navigation: true,
      ...(operation === "undock" ? {} : { targets: state => locationInstances(state, world).filter(d =>
        operation === "board" ? d.mobile && d.boardable !== false : operation === "travel" ? d.kind === "area" : d.kind === "site" && !d.mobile)
        .map(d => ({ id: operation + ":" + d.id, name: verb + " " + d.name, payload: { targetId: d.id } })) }),
      visible: (state, _ctx, payload) => operation === "undock" ? isShip(world, state.locationId, state) : !!payload?.targetId && isKnown(state, world, content, payload.targetId),
      requirement: (state, _ctx, payload) => navigationReason(state, operation, payload?.targetId, world, content),
      execute: (state, _ctx, payload) => navigate(state, operation, payload?.targetId, world, content, state.locationId, 'player', ledgerServices) };
  });
}

export function shipStatus(state, world) {
  const id = state.locationId, local = state.locations[id];
  if (!isShip(world, id, state)) return "Board a docked ship to travel between locations.";
  if (local.journey) return `En route from ${locationDefinition(state, world, local.areaId).name} to ${locationDefinition(state, world, local.journey.targetId).name} · ${formatDuration(local.journey.remaining)} remaining`;
  return `${locationDefinition(state, world, local.areaId).name} · ${local.dockedAtId ? `Docked at ${locationDefinition(state, world, local.dockedAtId).name}` : "Undocked"}`;
}

export function navigationView(state, targetId, world, content) {
  const target = locationDefinition(state, world, targetId), local = state.locations[state.locationId];
  const operation = target.mobile ? "board" : target.kind === "area" ? "travel" :
    isShip(world, state.locationId, state) && local.dockedAtId === targetId ? "disembark" : "dock";
  const label = { board: "Board", travel: "Travel to area", dock: "Approach and dock", disembark: "Disembark" }[operation];
  const reason = navigationReason(state, operation, targetId, world, content);
  const quote = ["travel", "dock"].includes(operation) ? journeyQuote(state, targetId, world, content) : null;
  return { actionId: `${operation}:${targetId}`, actionLabel: label, reason,
    detail: quote && Number.isFinite(quote.duration) && quote.duration > 0 ? `${formatDuration(quote.duration)} · ${quote.powerCost} ship power${quote.fuelUnits !== undefined ? ` · ${quote.fuelUnits} cartridges · DRY MASS ${quote.dryMassKg} kg` : ''}` : "" };
}

export function shipGraphView(state, world, content, areaId = null, options = {}) {
  const graph = graphView(state, world, content, areaId, options);
  for (const node of graph.nodes) {
    if (node.kind === "object" || node.kind==='contact') continue;
    if(node.drone) { node.actionLabel='Drone controls';node.detail=node.observable.report?.mission ? `${node.observable.report.mission.phase} · ${node.observable.report.mission.progressText}`:'';continue; }
    Object.assign(node, navigationView(state, node.id, world, content));
    if (isShip(world, node.id, state)) {
      const ship = state.locations[node.id];
      node.description += ship.journey ? ` En route to ${locationDefinition(state, world, ship.journey.targetId).name}.` :
        ship.dockedAtId ? ` Docked at ${locationDefinition(state, world, ship.dockedAtId).name}.` : " Undocked.";
      node.mobile = true;
    }
  }
  return graph;
}

export function collectShipReferences(state) {
  const refs = [];
  for (const [id, local] of Object.entries(state.locations)) {
    if (isTerminal(state.entities[id])) continue;
    if (local.dockedAtId) refs.push(entityReference(`locations.${id}.dockedAtId`, local.dockedAtId, "dock", id));
    if (local.journey) {
      refs.push(entityReference(`locations.${id}.journey.targetId`, local.journey.targetId, "destination", id));
      refs.push(entityReference(`locations.${id}.journey.originAreaId`, local.journey.originAreaId, "area", id));
    }
  }
  return refs;
}

export function cancelJourney(state, shipId) {
  const local = state.locations[shipId];
  if (!isEntityActive(state, shipId) || !local?.journey) throw new Error("No active journey to cancel.");
  // Position is represented by the departure area throughout transit. No refund.
  local.journey = null;
}
