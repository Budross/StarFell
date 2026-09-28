import { draftAssembly, previewAssembly, shipyardReason } from './shipyard.js';
import { canUse } from './authority.js';
import { MODULE_CATEGORIES } from './vesselModuleCatalog.js';

// Detached, permitted presentation inputs. Locked recipes never enter this view.
export function shipyardView(state, draft, services) {
  const yardId = state.locationId, reason = shipyardReason(state, yardId, services);
  if (!canUse(state, 'player', yardId, 'viewCargo')) return { yardId, reason: reason || 'View cargo access is required to inspect assembly stocks.', palette: [], private: true };
  const stock = state.locations[yardId]?.resources ?? {}, used = {};
  for (const p of [draft?.core, ...(draft?.attachments ?? [])].filter(Boolean)) used[p.moduleId] = (used[p.moduleId] ?? 0) + 1;
  const palette = Object.values(services.content.vesselModules).filter(m => state.knowledge.discoveries[m.designDiscoveryId] || stock[m.id] > 0).map(m => {
    const known = state.knowledge.discoveries[m.designDiscoveryId] === true, item = services.content.items[m.id];
    return { id: m.id, role: m.role, category: m.category, name: known ? item.name : `Recovered ${m.category.toLowerCase()} hardware`,
      known, width: m.footprint.width, height: m.footprint.height, volumeUnits: item.unitVolumeUnits, stock: stock[m.id] ?? 0,
      available: Math.max(0, (stock[m.id] ?? 0) - (used[m.id] ?? 0)) };
  }).sort((a, b) => MODULE_CATEGORIES.indexOf(a.category) - MODULE_CATEGORIES.indexOf(b.category) || a.id.localeCompare(b.id));
  const request = draft ? { yardId, name: draft.name, assembly: draftAssembly(draft) } : null;
  const preview = request ? previewAssembly(state, request, services) : { ok: false, reason: 'Choose a core and attachments.' };
  return { yardId, reason, private: false, palette, preview, framesAvailable: stock.structuralFrame ?? 0, powerAvailable: stock.power ?? 0 };
}
