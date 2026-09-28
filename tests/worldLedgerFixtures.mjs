import { createEffectServices } from '../js/bootstrap.js';
import { createWorldOperations } from '../js/worldOperations.js';
import { createWorldLedgerServices } from '../js/worldLedger.js';
import { quantityKind } from '../js/quantities.js';

// Standalone legacy-domain test compositions now inject semantic operations.
export function effectServicesFor(systems) {
  const resourceKind = id => quantityKind(id, systems.content);
  const ledgerServices = createWorldLedgerServices({ resourceKind,
    isCurrentEquipmentId: id => Object.hasOwn(systems.content.infrastructure, id) });
  const worldOperations = createWorldOperations({ ...systems, resourceKind, ledgerServices });
  return createEffectServices({ ...systems, worldOperations });
}
