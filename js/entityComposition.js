import { collectLocationReferences } from './locations.js';
import { collectShipReferences } from './ships.js';
import { collectNpcReferences } from './npcs.js';
import { collectDialogueReferences } from './dialogue.js';
import { collectResearchReferences } from './research/researchState.js';
import { collectAuthorityReferences, collectRetainedReferences } from './entityReferences.js';
import { collectWorldLedgerReferences } from './worldLedger.js';
import { collectProcessingReferences } from './processing.js';

// Explicit composition, not a system loader. New domains supply their own collectors.
export const stateReferenceCollectors = [collectLocationReferences, collectShipReferences, collectNpcReferences,
  collectDialogueReferences, collectResearchReferences, collectAuthorityReferences, collectRetainedReferences, collectWorldLedgerReferences, collectProcessingReferences];

export function contentReferenceCollector({ world, people, content, research, processing }) {
  const refs = [world.entityReferences, people.entityReferences, content.entityReferences, research.catalog.entityReferences, processing?.catalog.entityReferences].flatMap(r => r ?? []);
  return () => refs;
}
