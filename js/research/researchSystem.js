import { mergeDiscoveryReferences } from "../conditionReferences.js";
import { researchDefinitions } from "./researchContent.js";
import { buildResearchCatalog } from "./researchCatalog.js";

export function buildResearchSystem(content, world, people, source = researchDefinitions, externalDiscoveryIds = [], additionalReferences) {
  const references = mergeDiscoveryReferences(content.discoveryReferences, world.discoveryReferences, people.discoveryReferences, additionalReferences);
  // Required external IDs remain legal for compatibility with custom knowledge.
  // Only actual producers seed the prerequisite diagnostic.
  const catalog = buildResearchCatalog(source, { content, world, people,
    externalDiscoveryIds: [...new Set([...references.required, ...references.granted, ...externalDiscoveryIds])],
    externalGrantIds: [...new Set([...references.granted, ...externalDiscoveryIds])] });
  return { content, world, people, catalog };
}

const cache = new WeakMap();
export function researchFor(content, world, people) {
  if (!cache.has(people)) {
    cache.set(people, buildResearchSystem(content, world, people));
  }
  return cache.get(people);
}
