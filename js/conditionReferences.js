import { entityReference } from "./entityReferences.js";

// Compilers enumerate condition inputs. This traversal never walks unrelated data.
export function collectDiscoveryReferences(conditions, grants = []) {
  const required = new Set();
  function visit(value = {}) {
    (value.discoveries ?? []).forEach(id => required.add(id));
    (value.all ?? []).forEach(visit); (value.any ?? []).forEach(visit);
    if (value.not) visit(value.not);
  }
  conditions.forEach(visit);
  return { required: [...required], granted: [...new Set(grants)] };
}

export function mergeDiscoveryReferences(...summaries) {
  return { required: [...new Set(summaries.flatMap(s => s?.required ?? []))],
    granted: [...new Set(summaries.flatMap(s => s?.granted ?? []))] };
}

export function conditionEntityReferences(value = {}, path = "conditions") {
  return [
    ...(value.locations ?? []).map(id => entityReference(path, id, "content")),
    ...Object.keys(value.locationFlags ?? {}).map(id => entityReference(path, id, "content")),
    ...[...(value.met ?? []), ...Object.keys(value.npcFlags ?? {})].filter(id => id !== "speaker").map(id => entityReference(path, id, "historyNpc")),
    ...(value.all ?? []).flatMap((c, i) => conditionEntityReferences(c, `${path}.all[${i}]`)),
    ...(value.any ?? []).flatMap((c, i) => conditionEntityReferences(c, `${path}.any[${i}]`)),
    ...(value.not ? conditionEntityReferences(value.not, `${path}.not`) : [])
  ];
}
