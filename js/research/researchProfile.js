// Only detached item descriptors enter this module.
export function buildResearchProfile(inputs, affinities) {
  const samples = inputs.map(item => ({ id: item.id, tags: [...item.tags] })).sort((a, b) => a.id.localeCompare(b.id));
  const tags = [...new Set(samples.flatMap(item => item.tags))].sort();
  const families = {};
  for (const rule of affinities) if (rule.tags.every(tag => tags.includes(tag))) {
    for (const [family, weight] of Object.entries(rule.weights)) families[family] = (families[family] ?? 0) + weight;
  }
  return { samples, tags, families };
}

function matchesSet(samples, predicate) {
  const tags = new Set(samples.flatMap(item => item.tags));
  return (predicate.items ?? []).every(id => samples.some(item => item.id === id)) &&
    (predicate.allTags ?? []).every(tag => tags.has(tag)) &&
    (!(predicate.anyTags?.length) || predicate.anyTags.some(tag => tags.has(tag))) &&
    !(predicate.excludeTags ?? []).some(tag => tags.has(tag)) &&
    samples.length >= (predicate.minSamples ?? 0) && samples.length <= (predicate.maxSamples ?? Infinity);
}

export function matchesSamples(profile, predicate = {}) {
  if (!matchesSet(profile.samples, predicate)) return false;
  // Each distinct requirement gets a different physical sample. Backtracking avoids greedy mismatches.
  function allocate(index, remaining) {
    if (index === (predicate.distinct?.length ?? 0)) return true;
    return remaining.some((sample, i) => matchesSet([sample], predicate.distinct[index]) &&
      allocate(index + 1, remaining.filter((_, j) => i !== j)));
  }
  return allocate(0, profile.samples);
}
