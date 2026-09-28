// Compatibility defaults for standalone consumers. The application imports
// stateCore.js so legacy default-world compilation cannot precede feature linking.
import { content as defaultContent } from "./content.js";
import { worldFor } from "./worldCatalog.js";
import { peopleFor } from "./peopleSystem.js";
import { researchFor } from "./research/researchSystem.js";
import * as core from "./stateCore.js";
export { defaultWorld, worldFor } from "./worldCatalog.js";

export function createInitialState(content = defaultContent, world = worldFor(content), people = peopleFor(content, world), research = researchFor(content, world, people), seed = 0x07B3A91D, lifecycle) {
  return core.createInitialState(content, world, people, research, seed, lifecycle);
}

export function migrateState(saved, content = defaultContent, world = worldFor(content), people = peopleFor(content, world), notices = [], research = researchFor(content, world, people), legacyStorage, lifecycle) {
  return core.migrateState(saved, content, world, people, notices, research, legacyStorage, lifecycle);
}

export function validateState(state, content = defaultContent, world = worldFor(content), people = peopleFor(content, world), research = researchFor(content, world, people), collectors, lifecycle) {
  return core.validateState(state, content, world, people, research, collectors, lifecycle);
}
