# Adding research content

The Modular Vessel expansion adds discoveries in `js/vesselContent.js` and merges
them into the existing research catalog. Design discoveries gate fabrication,
while recovered physical module stock may be assembled before its design is
known. See [VESSEL_AUTHORING.md](VESSEL_AUTHORING.md) for the no-luck bootstrap,
off-site material routes, and construction contract.

Processing consumes discoveries through start-only `startConditions`. Its compiler
provides required discovery references to research linking without treating them
as grant producers. Unlocks affect new batches; accepted run contracts stay saved.
See [Processing authoring](PROCESSING_AUTHORING.md) for maintained physical
requirements that must not be represented as start-only research conditions.

Research is authored in `js/research/researchContent.js`. Items, recipes, equipment, locations, and dialogue keep their existing content files. Research grants shared discoveries; the other systems read those discoveries through conditions.

Reload after editing content. Run `node --test tests/*.test.mjs` for the core checks. The browser suite is `node --test tests/terminalTabs.browser.mjs` with Playwright available to Node.

## A simple example: electromagnetic shielding

This is a copyable extension example, not an additional discovery shipped in the opening.

Add this entry inside `researchDefinitions.discoveries`:

```js
electromagneticShielding: {
  name: "Electromagnetic shielding",
  description: "Conductive enclosures can reduce interference around a circuit.",
  families: ["materials", "energy"],
  eligibility: { discoveries: ["electricalConduction"] },
  threshold: 10,
  evidence: [
    {
      id: "barrierTest",
      samples: { allTags: ["metal"], maxSamples: 1 },
      insight: 4,
      observation: "The metal barrier reduces interference on its sheltered side."
    },
    {
      id: "circuitTest",
      samples: {
        distinct: [
          { allTags: ["metal"] },
          { allTags: ["electrical"] }
        ]
      },
      insight: 6,
      observation: "A conductive enclosure keeps the recovered circuit's response more consistent."
    }
  ]
}
```

After discovering electrical conduction, the player can experiment with metal scrap alone, then with metal scrap and electronic salvage. The first rule awards 4 baseline insight and the second 6, guaranteeing the threshold of 10 without luck. Each consumes one authored sample volume per selected raw resource, or one counted item. The first rule's sample limit keeps the combined experiment from counting as both tests.

Repeated equivalent evidence awards 100%, 40%, 10%, then nothing. Chance currently gives each award a 50% probability of an additional 25% insight. These numbers are content settings at the top of `researchDefinitions`; amounts are stored internally as integers at 100 units per authored insight point. Players see observations and family tendencies, not scores.

To make the discovery useful, add this component inside `definitions.items` in `js/content.js`:

```js
shieldedHousing: {
  name: "Shielded housing",
  description: "A formed conductive enclosure.",
  category: "component",
  unitVolumeM3: 0.005,
  tags: ["metal", "rigid"],
  roles: { structure: {} },
  recipes: [{
    id: "fabricate",
    name: "Fabricate shielded housing",
    conditions: { discoveries: ["electromagneticShielding"] },
    inputs: [{ id: "metal", item: "scrap", quantity: 2 }]
  }]
}
```

The recipe appears after discovery. Its structure role makes the component an option in compatible frame slots. A role grants compatibility, not new physical bonuses: shielding effectiveness would require a consuming system that models interference. The research engine does not need to know the item or recipe exists.

Add a hint near the end of `researchDefinitions.hints`, before any broader hint that should have lower priority:

```js
{
  conditions: {
    discoveries: ["electricalConduction"],
    not: { discoveries: ["electromagneticShielding"] }
  },
  text: "Compare a metal barrier on its own with a barrier surrounding recovered electrical material."
}
```

Hints are checked in authored order; the first matching hint is shown. Use hints to suggest available experiments, not to expose an entire hidden technology list.

## Adding a clue from dialogue or inspection

A dialogue choice can record an ordinary fact with the existing effect schema:

```js
effects: [{
  type: "setFlag", scope: "npc", target: "speaker",
  flag: "shieldingAdvice", value: true
}]
```

If this conversation belongs to Mira, a research evidence rule can recognize it:

```js
{
  id: "engineerClue",
  samples: { allTags: ["electrical"] },
  conditions: { npcFlags: { mira: ["shieldingAdvice"] } },
  insight: 4,
  once: true,
  observation: "Mira's advice suggests enclosing the signal circuit in a continuous conductive surface."
}
```

This awards once on a qualifying experiment, even if the conversation happened before eligibility. A condition-only clue may omit `samples` and will apply to any valid submitted experiment while eligible; it is still credited only during an experiment. Use `once: true` for such facts.

Location inspection already sets a flag. Inspecting a scene object with ID `fitting` in Habitat 05 produces `locationFlags: { habitat: ["examined:fitting"] }`. Add a scene object in `js/locationContent.js`, then reference its flag in an evidence rule. The location system does not import research.

Standalone research must name the NPC explicitly. `speaker`, `completed`, and `anyFlags` are not supported research conditions. Use explicit NPC flags and the shared `all`, `any`, and `not` operators. Dialogue can still grant a discovery directly with `{ type: "discover", id: "electromagneticShielding" }`; research respects that knowledge without inventing experimental progress.

## Discovery fields

| Field | Meaning |
| --- | --- |
| Object key | Stable ID: letter followed by letters, numbers, underscores, or hyphens. Never repurpose a released ID. |
| `name`, `description` | Required revealed text. Nonempty, at most 2,000 characters each. |
| `families` | Required array of existing family IDs. Classification, not levels. |
| `eligibility` | Optional shared conditions. All candidates use the context at the start of the experiment. |
| `threshold` | Required positive whole insight points, up to 1,000,000. |
| `evidence` | Required nonempty array of evidence rules. Different rules deliberately stack. |
| `effects` | Optional reward array, executed only when an experiment first learns this discovery. |
| `retired` | Optional boolean. Retains old progress and journal references but excludes this discovery from new experiments. |
| `legacyGrant` | Reserved for the six original opening discoveries during the version-5-to-6 migration. Omit on new content. |

Shared discovery IDs from outside research can be supplied with `externalDiscoveryIds` when composing a custom research system. The normal composition collects IDs already used by item, world, and people content. Research still validates its own discovery references against that combined set.

## Evidence and sample matching

An evidence rule has `id`, `insight`, and `observation`; optional fields are `samples`, `conditions`, `once`, `methods`, and `variants`. IDs are unique within the discovery. Insight is a positive whole number up to 1,000,000. Observations are nonempty and at most 2,000 characters. Omitting `methods` allows any available method; an explicit list restricts it to named method IDs.

| Sample field | Meaning |
| --- | --- |
| `items` | Every listed inventory item ID must be selected. |
| `allTags` | All listed tags must occur somewhere in the selected samples. |
| `anyTags` | At least one listed tag must occur. |
| `excludeTags` | No selected sample may have a listed tag. |
| `minSamples`, `maxSamples` | Selected item count limits, 1–3. |
| `distinct` | Up to three separate sample predicates, each allocated a different physical sample. These predicates cannot nest `distinct`. |

Fields combine with AND. One material can satisfy several tags in an ordinary `allTags` predicate. Use `distinct` when two physical samples are scientifically required. Tag matching is exact: `electrical`, `electronic`, and `conductive` are different existing properties. Referenced tags must exist on items; new tags are added to their items before research uses them.

Experiments use `researchSampleM3` for each selected raw resource and one item for each selected component/product. They reject duplicate IDs, caller-specified quantities, utilities, and installed infrastructure as samples. Uninstalled products may be consumed. Every selected sample is spent once per accepted experiment even if several discoveries advance. A non-informative proposal spends nothing.

## Equipment and meaningful variations

Equipment supplies generic capabilities through the existing infrastructure or product-installation definitions. Research can then require a capability such as `spectroscopy` in its conditions. Only enabled, positive-health equipment with positive quantity at the player's owned, occupied site counts. Equipment elsewhere, NPC inventory, and private passenger-ship equipment do not grant access.

To let an improved instrument reveal new evidence under the same research rule, add variants:

```js
variants: [
  { id: "basic", priority: 0 },
  {
    id: "spectral", priority: 10,
    conditions: { capabilities: ["spectroscopy"] },
    insight: 8,
    observation: "Spectral measurements reveal the structure behind the earlier result."
  }
]
```

First add equipment with `spectroscopy` in `js/content.js`; otherwise the capability reference is rejected. This example is not installed by default. Rules without authored variants receive a generated `base` variant.

Each variant has a unique ID and integer priority (0–1,000); priorities must also be unique within the rule. It inherits the rule's samples, insight, and observation unless it overrides them. Rule conditions and variant conditions both apply. At most 16 variants are allowed per rule.

Only the highest-priority matching variant awards credit, even if it is exhausted; the engine does not fall back to farm weaker observations. Counters are keyed by discovery/rule/variant. Changing ingredient order, padding with irrelevant material, or toggling equipment off and back on never clears them. A new scientifically meaningful variant has a finite separate budget. When extending a released rule that had no explicit variants, retain its generated `base` variant with priority 0, then add the new variant. Substantial changes to an already-used rule require the compatibility handling below.

## Methods and families

Methods live in `researchDefinitions.methods`. Required fields are `name`, `minSamples`, `maxSamples`, and `blockedReason`; `conditions`, `cost`, and `retired` are optional. Counts are 1–3. Costs contain existing utility IDs with positive whole quantities. Sample costs are added automatically. Retired methods stay available for journal references but cannot be selected.

The shipped bench method requires `benchAnalysis`, which the existing fabricator supplies, and has no power cost. Do not put the first research capability behind the knowledge required to create it. New methods appear in the Research selector without UI registration.

Families have a stable ID, name, and optional description. Affinity rules have a `tags` array (all must match the sample set) and a `weights` map of family IDs to whole weights from 0–100. Matching rules add their weights once per experiment, not once per sample. Affinities drive qualitative tendencies and bounded family exposure; only evidence rules award discovery insight.

## Shipped opening routes

All amounts below are baseline insight, before chance. Every row lists a route that does not require luck. Experiments consume one of each listed sample. Material acquisition remains renewable at Habitat 05.

| Discovery / threshold | Guaranteed route | Alternative or shortcut |
| --- | --- | --- |
| Structural fabrication / 8 | Scrap twice: 6 + 2.4. Research consumes 2 scrap; gather another 8 to fabricate the 2 repair parts. | Inspect fitting, then scrap: 2 clue + 6 test. Costs 1 research scrap. |
| Electrical conduction / 10 | Scrap + electronic salvage: 6 electrical + 4 contact in one experiment. No prerequisite discovery. | Mira's advice + electronic salvage: 4 clue + 6 test. |
| Circuit assembly / 10 | After electrical conduction, scrap + electronic salvage: 6 circuit + 4 grounding. | Prepared conductive parts + salvage: the improved variant gives 10. Mira's advice + salvage also gives 10. |
| Semiconductor behavior / 8 | Silicon-bearing minerals + electronic salvage: 6 material + 2 probe. No prerequisite discovery. | Minerals twice: 6 + 2.4. |
| Photovoltaic fabrication / 10 | Become eligible through semiconductor knowledge; then silicon + salvage gives 4, and silicon + electronic parts gives 6. The electronic part requires circuit assembly and 2 additional salvage to fabricate. | Inspect solar hardware and hear Mira's advice: silicon + salvage gives 2 hardware + 4 advice + 4 test, without requiring semiconductor knowledge first. |
| Radio assembly / 10 | After circuit assembly, electronic parts + conductive parts gives 6 signal + 4 coupling. Those experimental components cost 3 salvage + 2 scrap to fabricate. | Electronic parts + scrap + electronic salvage gives 6 signal + 4 aerial. |

Experiments may contribute to other simultaneously eligible discoveries. A discovery earned during an experiment affects eligibility only on the next experiment. To use a newly unlocked material, fabricate it in Workshop after the discovery is committed.

## Experimental completion rewards

A discovery may declare `effects[]` using the shared effect vocabulary:

```js
// On a new discovery definition:
effects: [
  { type: "grantItem", itemId: "electronicParts", amount: 1 },
  { type: "activateLocation", targetId: "supplyPlatform" }
]
```

These rewards execute only when an experiment first grants the discovery. A generic
`discover` effect from dialogue, inspection, or another reward records knowledge
without experimental rewards or progress. Known discoveries are never rewarded
retroactively. Preview, reload, reconciliation, and journal rendering never run rewards.

Execution captures all discoveries completed by the experiment before rewards,
grants that entire set, then runs reward arrays in stable discovery-ID order. Each
array retains authored order and the same captured source location. If Alpha's
reward grants Beta, Beta still earns its own reward if that experiment completed
both; a reward-only grant of Beta does not cascade into Beta's experimental reward.
`speaker` is invalid in research; `current` is the original experiment location.

Rewards share the existing root transaction with sample/power costs, evidence,
insight, RNG, knowledge, journal, entity allocation, and completion. A blocked
lifecycle transition, insufficient cargo capacity, or failed save commits none of
these changes. Rewards do not fund sample costs. Spawn initialization quantities
use authored units; see [ENTITY_AUTHORING.md](ENTITY_AUTHORING.md). Choose affordable
rewards that do not prevent a player from completing important discoveries.

The prerequisite diagnostic counts reward discovery producers only after their
owning experiment is reachable. A discovery cannot open its own entry route merely
by rewarding its prerequisite. This audit remains conservative rather than proving
complete world reachability.

## Save-compatible editing

The current version-eight save retains shared discoveries plus research insight, evidence credits, a random-generator state, capped family exposure, and the latest 100 journal entries. Older saves receive the six original opening discoveries once to preserve formerly available recipes. New games begin with no discoveries. Detailed log trimming does not erase evidence credits or lifetime attempt count.

Adding a discovery, hint, family, or method and editing display text is compatible with existing progress. New entries default to zero; starting grants are not replayed. Adding an evidence rule or variant is also compatible when the threshold, eligibility, reward array, and all existing rules/variants remain unchanged. Load reconciliation updates the mechanical contract while preserving existing insight, spent credits, journal entries, and random state. A new method shares existing evidence counters; switching methods does not restore spent credit.

For every used discovery, the save records a mechanical contract covering its threshold, eligibility, canonical compiled reward array in authored order, and evidence/sample/variant rules. Removing or changing existing mechanics causes loading to stop with a migration explanation and preserves the stored save; the additive changes described above are reconciled automatically. This prevents exhausted progress becoming unreachable or spent evidence becoming farmable after an edit. Changing chance affects future awards only; it does not reinterpret past evidence.
Older contracts without `effects` normalize to an empty array when otherwise
compatible, without replay or changing the save version. Adding, removing, reordering,
or changing rewards on used progress requires an explicit compatibility migration,
even when the discovery is already known. Reward text that affects execution
(e.g. a spawned display name or lifecycle reason) is part of this contract; unrelated
discovery/observation wording remains a display-only edit.

To retire content, keep its original definition and IDs with `retired: true`. Removed items, locations, methods, families, or discoveries referenced by saves also need compatibility handling. For a deliberate balance change or ID rename, add an explicit migration before research reconciliation in `migrateState`: map the affected insight, credit keys, contract, knowledge, and journal references together, preserve previously spent budgets, and test old saves. Merely replacing a saved contract string is not a sufficient migration. Never delete research state as a shortcut.

The journal uses simulation time; neither reload nor tab switching performs experiments. Preview makes no random draws. A failed save does not spend samples or change the next random outcome.

## Checklist for an addition

1. Confirm the prerequisite knowledge, materials, and equipment are obtainable first.
2. Give the discovery enough finite baseline evidence to reach its threshold with zero chance bonuses.
3. Add useful observation text and a hint; author alternate routes when appropriate.
4. Put resulting recipe/role/dialogue conditions in the consuming content file.
5. Check a new game and a representative existing save; use explicit migration for mechanical edits to used discoveries.
6. Add a route test. The compiler checks schema and warns about obvious insufficient evidence and prerequisite cycles; it cannot prove full world reachability.

See `tests/research.test.mjs` for examples covering content-only extensions, instrument variants, equivalent sample repetition, local equipment access, compaction, migration, and the complete no-luck opening.
