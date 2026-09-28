import { matchesSamples } from "./researchProfile.js";

export function collectEvidence(catalog, context, progress) {
  const matches = [];
  for (const discovery of catalog.orderedDiscoveries) {
    if (discovery.retired || context.discoveries[discovery.id] || !context.predicates[discovery.predicate]) continue;
    for (const rule of discovery.evidence) {
      if ((rule.methods && !rule.methods.includes(context.methodId)) || !context.predicates[rule.predicate] || !matchesSamples(context.profile, rule.samples)) continue;
      // Select the most informative matching variant even if exhausted; never fall back to farm lesser evidence.
      const variant = rule.variants.find(v => context.predicates[v.predicate] && matchesSamples(context.profile, v.samples));
      if (!variant) continue;
      const uses = progress.credits[variant.key] ?? 0;
      const discount = variant.discounts[uses] ?? 0;
      if (!discount) continue;
      matches.push({ discoveryId: discovery.id, key: variant.key, uses: uses + 1,
        baseline: Math.max(1, Math.floor(variant.insightUnits * discount / 100)), observation: variant.observation });
    }
  }
  return matches;
}

// Mulberry-style mixing over a saved uint32: all entropy is an explicit input/output.
function draw(seed) {
  const next = (seed + 0x6D2B79F5) >>> 0;
  let value = Math.imul(next ^ next >>> 15, next | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  return { seed: next, value: ((value ^ value >>> 14) >>> 0) / 4294967296 };
}

export function resolveExperiment(catalog, context, progress) {
  const evidence = collectEvidence(catalog, context, progress);
  if (!evidence.length) throw new Error("This setup offers no new evidence. Change materials or use a relevant new clue or capability. Nothing was spent.");
  let rng = progress.rng;
  const insight = {}, credits = {}, contracts = {}, discoveries = [], observations = [];
  for (const match of evidence) {
    const random = draw(rng); rng = random.seed;
    const bonus = random.value < catalog.bonusChance ? Math.floor(match.baseline * catalog.bonusPercent / 100) : 0;
    const discovery = catalog.discoveries[match.discoveryId];
    insight[discovery.id] = Math.min(discovery.thresholdUnits, (insight[discovery.id] ?? progress.insight[discovery.id] ?? 0) + match.baseline + bonus);
    credits[match.key] = match.uses; contracts[discovery.id] = catalog.contracts[discovery.id];
    if (!observations.includes(match.observation)) observations.push(match.observation);
  }
  for (const [id, amount] of Object.entries(insight)) if (amount >= catalog.discoveries[id].thresholdUnits) discoveries.push(id);
  return { insight, credits, contracts, discoveries, observations, rng, families: { ...context.profile.families } };
}
