import { record, validId, safeKey, validateConditions, conditionContracts } from "../conditions.js";
import { conditionEntityReferences } from "../conditionReferences.js";
import { compileEffects, describeEffects } from "../effects.js";

export const INSIGHT_SCALE = 100;
const check = (ok, detail) => { if (!ok) throw new Error(`Invalid research catalog: ${detail}.`); };
const text = value => typeof value === "string" && !!value.trim() && value.length <= 2000;
const integer = (value, min, max = 1000000) => Number.isSafeInteger(value) && value >= min && value <= max;
const keys = (value, allowed, path) => { check(record(value), path); check(Object.keys(value).every(key => allowed.includes(key)), `unknown field at ${path}`); };
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
// A known capability spelling change is compatible only inside predicate fields.
// Effects, awards, samples and all other contract data retain strict comparison.
function canonicalContractPredicates(contract) {
  const visit = conditions => {
    if (!record(conditions)) return;
    if (Array.isArray(conditions.capabilities)) conditions.capabilities = conditions.capabilities.map(id => id === 'radio' ? 'radioCommunication' : id);
    (conditions.all ?? []).forEach(visit); (conditions.any ?? []).forEach(visit); if (conditions.not) visit(conditions.not);
  };
  visit(contract.eligibility);
  for (const rule of contract.evidence ?? []) { visit(rule.conditions); for (const variant of rule.variants ?? []) visit(variant.conditions); }
  return contract;
}

// Additive routes keep all old budgets intact. Altered thresholds, predicates,
// or existing awards need an explicit migration rather than a silent reset.
export function isAdditiveContract(previous, current) {
  if (previous === current) return true;
  try {
    const before = canonicalContractPredicates(JSON.parse(previous)), after = canonicalContractPredicates(JSON.parse(current));
    if (JSON.stringify(stable(before)) === JSON.stringify(stable(after))) return true;
    if (!record(before) || !Array.isArray(before.evidence) || before.evidence.length === 0 ||
      before.threshold !== after.threshold || JSON.stringify(before.eligibility) !== JSON.stringify(after.eligibility) ||
      JSON.stringify(stable(before.effects ?? [])) !== JSON.stringify(stable(after.effects ?? []))) return false;
    const unique = list => new Set(list.map(entry => entry.id)).size === list.length;
    if (!unique(before.evidence)) return false;
    return before.evidence.every(rule => {
      const replacement = after.evidence.find(entry => entry.id === rule.id);
      if (!replacement || !Array.isArray(rule.variants) || rule.variants.length === 0 || !unique(rule.variants)) return false;
      const { variants, ...base } = rule, { variants: replacements, ...newBase } = replacement;
      return JSON.stringify(stable(base)) === JSON.stringify(stable(newBase)) && variants.every(variant =>
        replacements.some(next => next.id === variant.id && JSON.stringify(stable(next)) === JSON.stringify(stable(variant))));
    });
  } catch { return false; }
}

export function buildResearchCatalog(source, { content, world, people, externalDiscoveryIds = [], externalGrantIds = externalDiscoveryIds }) {
  keys(source, ["families", "affinities", "methods", "discoveries", "hints", "repetition", "bonusChance", "bonusPercent"], "root");
  const catalog = structuredClone(source);
  check(record(catalog.discoveries) && record(catalog.methods) && Object.keys(catalog.methods).length > 0 && record(catalog.families), "definition groups");
  catalog.effectSources = Object.entries(catalog.discoveries).map(([id, discovery]) => {
    check(record(discovery), `discovery ${id}`);
    discovery.effects = compileEffects(discovery.effects, { content, world, npcs: people.npcs }, { kind: "research" }, `research.discoveries.${id}.effects`);
    return { path: `research.discoveries.${id}.effects`, effects: discovery.effects, trigger: { kind: "research" }, discoveryId: id };
  });
  const effectMetadata = catalog.effectSources.flatMap(source => describeEffects(source.effects, source.path));
  const ids = new Set([...Object.keys(catalog.discoveries), ...externalDiscoveryIds,
    ...effectMetadata.filter(m => m.kind === "discovery" && m.access === "produce").map(m => m.id)]);
  check([...ids].every(safeKey), "discovery IDs");
  const tags = new Set(Object.values(content.items).flatMap(item => item.tags));
  const capabilities = new Set(Object.keys(content.equipmentContracts));
  check(Array.isArray(catalog.repetition) && catalog.repetition.length > 0 && catalog.repetition.length <= 10 &&
    catalog.repetition[0] === 100 && catalog.repetition.every((n, i, a) => integer(n, 1, 100) && (!i || n <= a[i - 1])), "repetition percentages");
  check(Number.isFinite(catalog.bonusChance) && catalog.bonusChance >= 0 && catalog.bonusChance <= 1 && integer(catalog.bonusPercent, 0, 100), "chance policy");
  catalog.conditionSources=[];catalog.predicates = {}; catalog.credits = {}; catalog.contracts = {}; catalog.warnings = [];
  function condition(value = {}, path) {
    const [kind,id,ruleId,variantId]=path.split('/');
    const discovery=catalog.discoveries[id],ruleIndex=discovery?.evidence?.findIndex(r=>r.id===ruleId);
    const authoredPath=kind==='method'?`research.methods.${id}.conditions`:kind==='discovery'?`research.discoveries.${id}.eligibility`:kind==='hint'?`research.hints.${id}.conditions`:
      `research.discoveries.${id}.evidence.${ruleIndex}${kind==='variant'?`.variants.${discovery.evidence[ruleIndex].variants.findIndex(v=>v.id===variantId)}`:''}.conditions`;
    validateConditions(value, { content, world, npcs: people.npcs, conversations: people.dialogue.conversations,contract:conditionContracts.state,conditionSources:catalog.conditionSources }, authoredPath);
    function references(c) {
      check(!c.completed && !Object.hasOwn(c.npcFlags ?? {}, "speaker"), `explicit NPC flags required at ${path}`);
      check((c.capabilities ?? []).every(id => capabilities.has(id)), `unknown capability at ${authoredPath}`);
      (c.all ?? []).forEach(references); (c.any ?? []).forEach(references); if (c.not) references(c.not);
    }
    references(value); catalog.predicates[path] = value; return path;
  }
  function samples(value = {}, path, child = false) {
    keys(value, ["items", "allTags", "anyTags", "excludeTags", "minSamples", "maxSamples", ...(child ? [] : ["distinct"])], path);
    for (const key of ["items", "allTags", "anyTags", "excludeTags"]) if (value[key] !== undefined) {
      check(Array.isArray(value[key]) && value[key].length > 0 && new Set(value[key]).size === value[key].length &&
        value[key].every(id => key === "items" ? Object.hasOwn(content.items, id) : tags.has(id)), `unknown or duplicate ${key} at ${path}`);
    }
    for (const key of ["minSamples", "maxSamples"]) if (value[key] !== undefined) check(integer(value[key], 1, 3), `${key} at ${path}`);
    check((value.minSamples ?? 1) <= (value.maxSamples ?? 3), `sample limits at ${path}`);
    if (value.distinct !== undefined) { check(Array.isArray(value.distinct) && value.distinct.length > 0 && value.distinct.length <= 3, `distinct samples at ${path}`); value.distinct.forEach((v, i) => samples(v, `${path}/${i}`, true)); }
    return value;
  }
  for (const [id, family] of Object.entries(catalog.families)) {
    keys(family, ["name", "description"], `family ${id}`); check(validId(id) && text(family.name), `family ${id}`);
  }
  check(Array.isArray(catalog.affinities), "affinities");
  for (const rule of catalog.affinities) {
    keys(rule, ["tags", "weights"], "affinity"); check(Array.isArray(rule.tags) && rule.tags.length > 0 && rule.tags.every(tag => tags.has(tag)) && record(rule.weights), "affinity tags/weights");
    check(Object.entries(rule.weights).every(([id, weight]) => Object.hasOwn(catalog.families, id) && integer(weight, 0, 100)), "affinity family weight");
  }
  for (const [id, method] of Object.entries(catalog.methods)) {
    keys(method, ["name", "minSamples", "maxSamples", "cost", "conditions", "blockedReason", "retired"], `method ${id}`);
    check(validId(id) && text(method.name) && text(method.blockedReason) && integer(method.minSamples, 1, 3) && integer(method.maxSamples, method.minSamples, 3), `method ${id}`);
    check(method.retired === undefined || typeof method.retired === "boolean", `retired method ${id}`);
    method.cost ??= {};
    check(record(method.cost) && Object.entries(method.cost).every(([key, amount]) => content.utilities.includes(key) && integer(amount, 1)), `method ${id} utility costs`);
    method.predicate = condition(method.conditions, `method/${id}`); method.id = id;
  }
  for (const [id, discovery] of Object.entries(catalog.discoveries)) {
    keys(discovery, ["name", "description", "families", "eligibility", "threshold", "evidence", "legacyGrant", "retired", "effects", "studyOnly", "classification"], `discovery ${id}`);
    check(discovery.studyOnly===undefined||discovery.studyOnly===true,`study-only ${id}`);
    check(discovery.classification===undefined||['principle','design'].includes(discovery.classification),`classification ${id}`);
    check(validId(id) && text(discovery.name) && text(discovery.description) && integer(discovery.threshold, 1), `discovery ${id}`);
    check(Array.isArray(discovery.families) && discovery.families.length > 0 && discovery.families.every(key => Object.hasOwn(catalog.families, key)), `families of ${id}`);
    for (const key of ["legacyGrant", "retired"]) check(discovery[key] === undefined || typeof discovery[key] === "boolean", `${key} on ${id}`);
    discovery.id = id; discovery.thresholdUnits = discovery.threshold * INSIGHT_SCALE;
    discovery.predicate = condition(discovery.eligibility, `discovery/${id}`);
    check(Array.isArray(discovery.evidence) && (discovery.studyOnly ? discovery.evidence.length===0 && !discovery.effects.length : discovery.evidence.length > 0), `evidence of ${id}`);
    const seen = new Set(); let potential = 0;
    for (const rule of discovery.evidence) {
      keys(rule, ["id", "samples", "conditions", "insight", "observation", "once", "variants", "methods"], `evidence of ${id}`);
      check(validId(rule.id) && !seen.has(rule.id), `duplicate/invalid evidence ${id}/${rule.id}`); seen.add(rule.id);
      const base = `${id}/${rule.id}`;
      rule.samples = samples(rule.samples, base);
      rule.predicate = condition(rule.conditions, `rule/${base}`);
      check(rule.methods === undefined || (Array.isArray(rule.methods) && rule.methods.length > 0 && rule.methods.every(key => Object.hasOwn(catalog.methods, key))), `methods of ${base}`);
      rule.methods ??= null;
      check(integer(rule.insight, 1) && text(rule.observation) && (rule.once === undefined || typeof rule.once === "boolean"), `evidence award ${base}`);
      rule.variants ??= [{ id: "base", priority: 0 }];
      check(Array.isArray(rule.variants) && rule.variants.length > 0 && rule.variants.length <= 16, `variants of ${base}`);
      const variantIds = new Set(), priorities = new Set();
      rule.variants = rule.variants.map(v => {
        keys(v, ["id", "priority", "samples", "conditions", "insight", "observation"], `variant of ${base}`);
        check(validId(v.id) && !variantIds.has(v.id) && integer(v.priority, 0, 1000) && !priorities.has(v.priority), `variant identity/priority ${base}`);
        variantIds.add(v.id); priorities.add(v.priority);
        const variant = { ...v, samples: samples(v.samples ?? rule.samples, `${base}/${v.id}`), insight: v.insight ?? rule.insight, observation: v.observation ?? rule.observation };
        check(integer(variant.insight, 1) && text(variant.observation), `variant award ${base}`);
        variant.predicate = condition(v.conditions, `variant/${base}/${v.id}`);
        variant.key = `${base}/${v.id}`; variant.insightUnits = variant.insight * INSIGHT_SCALE;
        variant.discounts = rule.once ? [100] : [...catalog.repetition];
        catalog.credits[variant.key] = { discoveryId: id, limit: variant.discounts.length };
        potential += variant.discounts.reduce((sum, percent) => sum + variant.insight * percent / 100, 0);
        return variant;
      }).sort((a, b) => b.priority - a.priority);
    }
    discovery.evidence.sort((a, b) => a.id.localeCompare(b.id));
    if (!discovery.studyOnly && potential < discovery.threshold) catalog.warnings.push(`${id}: total baseline evidence cannot reach its threshold.`);
    // Save a mechanical contract only for used progress; text-only edits stay compatible.
    catalog.contracts[id] = JSON.stringify(stable({ threshold: discovery.threshold, eligibility: discovery.eligibility ?? {}, effects: discovery.effects,
      evidence: discovery.evidence.map(r => ({ id: r.id, conditions: r.conditions ?? {}, methods: r.methods ? [...r.methods].sort() : null, samples: r.samples,
        variants: r.variants.map(v => ({ id: v.id, priority: v.priority, conditions: v.conditions ?? {}, samples: v.samples, insight: v.insight, discounts: v.discounts })) })) }));
  }
  catalog.orderedDiscoveries = Object.values(catalog.discoveries).sort((a, b) => a.id.localeCompare(b.id));
  check(Array.isArray(catalog.hints ?? []), "hints");
  catalog.hints = (catalog.hints ?? []).map((hint, i) => {
    keys(hint, ["text", "conditions"], `hint ${i}`); check(text(hint.text), `hint ${i}`);
    return { ...hint, predicate: condition(hint.conditions, `hint/${i}`) };
  });
  // Conservative prerequisite audit: OR branches with no discovery requirements remain entry routes.
  function reachable(c = {}, known) {
    return (c.discoveries ?? []).every(id => known.has(id)) && (c.all ?? []).every(v => reachable(v, known)) && (!c.any || c.any.some(v => reachable(v, known)));
  }
  const reachableIds = new Set(externalGrantIds);
  for (let i = 0; i < catalog.orderedDiscoveries.length; i++) for (const d of catalog.orderedDiscoveries) if (!d.retired && reachable(d.eligibility, reachableIds)) {
    reachableIds.add(d.id);
    // Conditional reward producers are reachable only through their owning experiment.
    for (const ref of describeEffects(d.effects).filter(m => m.kind === "discovery" && m.access === "produce")) reachableIds.add(ref.id);
  }
  for (const d of catalog.orderedDiscoveries) if (!d.retired && !reachableIds.has(d.id)) catalog.warnings.push(`${d.id}: prerequisite cycle or missing entry route.`);
  catalog.entityReferences = Object.entries(catalog.predicates).flatMap(([key, c]) => conditionEntityReferences(c, `research:${key}`))
    .concat(effectMetadata.filter(m => m.kind === "entity" && !["current", "speaker"].includes(m.targetId)));
  return catalog;
}
