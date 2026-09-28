import { locationDefinition, getEntityLabel } from '../../entityQueries.js';
import { canUse } from '../../authority.js';
import { isKnown } from '../../locations.js';
import { deriveVessel, moduleGeometry } from '../../vessels.js';
import { fact } from '../narrativeFacts.js';
import { historyAge } from '../narrativeContext.js';

export function vesselFactProvider({ world, content }) {
  return { id: 'vessels', provide(state, scope) {
    const facts = [];
    for (const [id, local] of Object.entries(state.locations)) {
      if (!local.assembly || state.entities[id]?.lifecycle !== 'active' || !isKnown(state, world, content, id)) continue;
      const own = id === scope.locationId, berth = local.dockedAtId === scope.locationId && !local.journey;
      if (!own && !berth) continue;
      const def = locationDefinition(state, world, id), derived = deriveVessel(local.assembly, content), subject = { type: 'entity', id };
      const shape = derived.geometry.elongated ? 'elongated' : derived.geometry.sparse ? 'spread-out' : derived.geometry.compactCluster ? 'compact' : 'irregular';
      if (!scope.equipmentId) facts.push(fact('vessels', 'vessel_geometry', subject,
        { name: def.name, vesselClass: def.vesselClass, shape, width: derived.geometry.width, length: derived.geometry.length,
          depth: Number(derived.geometry.depth.toFixed(3)) }, scope, { importance: .7 }));
      const detailed = canUse(state, scope.actorId, id, 'viewCargo') && (!scope.speaker || canUse(state, scope.observerId, id, 'viewCargo'));
      if (!detailed) continue;
      if (!scope.equipmentId) facts.push(fact('vessels', 'vessel_composition', subject,
        { name: def.name, moduleCount: derived.moduleCount, dryMass: derived.dryMassKg,
          cargoVolume: derived.cargoVolumeUnits / 1_000_000, fuelVolume: derived.fuelVolumeUnits / 1_000_000 }, scope,
        { exposure: 'cargo_detail', importance: .6 }));
      const seen = new Set();
      for (const placement of [local.assembly.core, ...local.assembly.attachments]) {
        if (seen.has(placement.moduleId)) continue;
        seen.add(placement.moduleId);
        const module = content.vesselModules[placement.moduleId];
        if (scope.equipmentId && scope.equipmentId !== module.group) continue;
        if (!scope.equipmentId) continue; // detailed module inspection is opt-in
        const geometry = moduleGeometry(placement.moduleId, content);
        facts.push(fact('vessels', 'module_geometry', { type: 'equipment_group', hostId: id, equipmentId: module.group },
          { name: state.knowledge.discoveries[module.designDiscoveryId] ? content.items[module.id].name : `Recovered ${module.category.toLowerCase()} hardware`,
            category: module.category, width: geometry.width, length: geometry.length, depth: Number(geometry.depth.toFixed(3)),
            sizeBand: geometry.sizeBand, shallow: geometry.shallow, elongated: geometry.elongated }, scope,
          { exposure: 'facility_detail', importance: .8 }));
      }
    }
    return facts;
  }, interpret(entry, scope, state) {
    if (entry.type !== 'VESSEL_ASSEMBLED' || scope.equipmentId || entry.locationId !== scope.locationId && entry.targetId !== scope.locationId) return [];
    if (state.entities[entry.targetId]?.lifecycle === 'active' && !isKnown(state, world, content, entry.targetId)) return [];
    return [fact('vessels', 'recent_vessel_assembly', { type: 'entity', id: entry.targetId },
      { name: getEntityLabel(state, { world }, entry.targetId), ageBand: historyAge(scope, entry.time) }, scope,
      { basis: 'history', event: entry, importance: .9 })];
  } };
}
