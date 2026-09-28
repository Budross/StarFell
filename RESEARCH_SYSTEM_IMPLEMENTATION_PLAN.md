# Research system — implementation plan

Status: implemented and verified, 2026-09-20. See [RESEARCH_AUTHORING.md](RESEARCH_AUTHORING.md) for the implemented schema, copyable extension example, and complete opening route table.

Implementation results:

- Research is available through its tab, Operations shortcut, and `research` presentation command. The pure resolver, context adapter, content catalog, managed actions, and bounded persistent journal are implemented.
- Six discoveries gate the new-game opening. Basic experiments work at zero power; a full no-luck route reaches solar repair, panel and antenna assembly, installation, and signal scanning.
- Version-six saves hold insight, evidence credits, seeded chance, and recent observations. Older saves receive the six opening discoveries once without changing their assets or NPC history.
- New discoveries, methods, evidence rules, and instrument variants can be authored without engine changes. Additive evidence changes reconcile automatically while preserving old progress and spent credits. Altering or removing existing mechanics requires explicit migration.
- All 90 unit tests and 29 browser checks pass. Browser checks use isolated saves. Desktop, 900-pixel, and 390-pixel screenshots were inspected; artifacts are in `artifacts/research-checks`.
- The sections below retain the approved design rationale and work breakdown. The authoring guide is authoritative for implemented field names and defaults.

This plan translates the supplied brainstorm into work packages grounded in the current game. The user confirmed two gameplay decisions: experiments should include some chance with guaranteed partial progress, and research should introduce gates throughout the opening crafting loop. Other defaults below are recommendations that can be adjusted before implementation.

## 1. Purpose and scope

Research discovers knowledge. Each consuming system decides what that knowledge allows.

The first implementation should support material experiments, several discoveries receiving insight from one experiment, alternate evidence routes, contextual clues, equipment capabilities, diminishing returns, a persistent journal, and discovery conditions throughout the opening. Ordinary additions using these behaviors should require authored content rather than changes to the engine or display.

Keep the existing synchronous action/save model. Defer timed research jobs, research queues, autonomous researchers, remote laboratory access, personal inventories, a general gameplay event framework, and arbitrary content scripts. Families classify research; they do not create levels or mandatory progression lanes. Record family exposure now, but defer familiarity bonuses until the basic balance is proven.

## 2. Existing foundations and actual integration constraints

| Existing code | What the plan uses or must accommodate |
| --- | --- |
| `js/conditions.js` | Already supports discoveries, global/local/targeted flags, equipment, capabilities, and nested all/any/not conditions. Reuse its semantics. |
| `js/state.js` | The current save version is 5. `knowledge.discoveries` already holds shared boolean knowledge. Research progress needs a separate state section and version 6 migration. |
| `js/app.js`, `js/playerActions.js` | Actions run on a candidate copy, validate, save, then commit. Action handlers return a string or undefined synchronously. Research must fit this contract. |
| `js/locations.js` | Inventory and installed equipment belong to sites or ships. `getLocationContext` exposes local assets; its action state contains live references and is not itself a detached research snapshot. |
| `js/content.js`, `js/itemCatalog.js` | Item tags, crafting roles, recipe conditions, and infrastructure capabilities already exist. Research affinity metadata belongs in its own catalog. |
| `js/dialogue.js` | Dialogue already supports a `discover` effect and scoped flags. Discoveries must remain usable independently of research. |
| `js/eventBus.js` | This is a terminal-message bus, not an authoritative gameplay event stream. Do not derive research progress from console messages. |
| `js/terminalTabs.js` | A Research panel can use the existing presentation-only tab registration. |

Corrections to the brainstorm examples: `anyFlags` is not a supported operator; use `any` with ordinary flag conditions. `npcFlags` is a map from NPC IDs to flag arrays, not a flat array. Inspection already records local keys such as `examined:collectors`. Capabilities currently mean installed quantity above zero, enabled, and positive health; power requirements are separate costs. There is no universal effect executor or general historical-action ledger to reuse.

The current opening also includes Mira and Oren at Habitat 05. A solitary opening would be a separate narrative change; this research plan uses the existing cast without requiring either NPC for essential progress.

## 3. Architecture and ownership

The dependency flow is: authored catalogs and game state → research context adapter → pure research resolution → research action → existing validate/save/commit flow. Other systems continue reading shared discovery conditions.

| Proposed module | Responsibility |
| --- | --- |
| `js/research/researchContent.js` | Families, tag affinities, experiment methods, discoveries, evidence rules, hints, and tuning values. |
| `js/research/researchCatalog.js` | Validate definitions and cross-references; compile predicate and evidence indexes. No game-state mutation. |
| `js/research/researchContext.js` | Translate current local access, selected inventory items, known facts, and condition results into detached research data. |
| `js/research/researchProfile.js` | Normalize selected samples and interpret generic item tags. No inventory access or progression decisions. |
| `js/research/researchEngine.js` | Pure evidence matching, repetition discounts, insight accumulation, chance, and discovery resolution. |
| `js/research/researchState.js` | Research defaults, validation, compact journal records, evidence-credit counters, and content reconciliation. |
| `js/research/researchActions.js` | Validate requests, pay local costs, apply returned research changes and discoveries to the candidate state, and return result text. |
| `js/research/researchDisplay.js` | Research selection, cost preview, hints, journal, and discovered knowledge. Uses actions for gameplay changes. |
| `js/research/researchSystem.js` | Compose and cache the compiled research catalog from supplied item/world/people catalogs, following the existing people-system pattern. |
| `js/knowledge.js` | Small shared, idempotent discovery-grant helper, usable by both dialogue and research. No import of research definitions. |

The engine must not import crafting, NPCs, locations, resources, saving, rendering, or the terminal bus. It accepts compiled research data, a detached context, research progress, and random-generator state; it returns deltas and structured observations without modifying its inputs.

Do not create a second condition interpreter. The context adapter evaluates compiled eligibility/evidence predicates with the existing `conditionReason`, using the current location view and explicit root/NPC context. It passes predicate results keyed by stable compiled IDs to the engine. Research rules referring to NPCs must identify them explicitly; implicit dialogue `speaker` conditions are invalid in standalone research. Defer dialogue-completion predicates unless an explicit NPC binding is supplied; existing persistent NPC flags cover the first content.

Compile in dependency order: items → world → people → research → complete action validation. Pass compiled dependencies into research state creation/migration/validation rather than letting the pure engine import default game catalogs. Keep test catalogs injectable.

## 4. Authoring contract

| Definition | Required meaning |
| --- | --- |
| Family | Stable ID, player-facing label, optional description. Start with active Materials, Mechanics, Energy, Computation, and Navigation; the remaining brainstorm families can be added as content grows. Treat electrical/electronic tags as properties mapping to families. |
| Affinity rule | Matches item tags and supplies nonnegative family weights. Drives observations and candidate indexing, not free discovery progress. |
| Experiment method | Stable ID, sample limits, cost, equipment/capability conditions, and clear blocked text. First method is basic bench experimentation. |
| Discovery | Stable ID, revealed title/description, family membership, eligibility conditions, positive insight threshold, evidence rules, and hints. Contains no recipe IDs or arbitrary game effects. |
| Evidence rule | Stable ID within a discovery, sample predicate, context predicate, positive baseline insight, credit policy, optional finite observation variants, and authored observation text. |
| Hint | Conditions and player-facing text that suggest a useful direction without revealing hidden progress or the whole discovery catalog. |

Sample matching must have explicit semantics. Support required item IDs and all/any tags over the selected sample set. A sample with two tags may satisfy a combined-property predicate; requirements for distinct physical samples must declare separate sample requirements and allocate each unit once. Quantities and duplicate selections are normalized before matching and payment. Matching several discoveries does not multiply the cost of the same experiment.

Use generic tags without adding researchValue/researchUnlocks fields to items. Semantic tag aliases such as electrical and electronic must be authored deliberately, not inferred from spelling. An unknown tag or capability reference is a catalog error; a recognized tag with no research affinity is allowed.

Validate IDs, duplicate rules, finite positive thresholds/costs, fixed-point numeric bounds, valid condition syntax, item and targeted entity references, capabilities, observation variants, and insight caps. Discovery references resolve against research IDs plus an explicit set of external knowledge IDs supplied by the composition layer. Do not require every pre-existing discovery or dialogue fact to belong to research.

Warn about unreachable-looking discoveries, prerequisite cycles without an entry route, and insufficient total guaranteed evidence. Complex world reachability still needs authored scenario tests; static validation cannot prove every route.

## 5. Experiment behavior

Recommended first-version controls: choose one to three distinct inventory item types, one unit of each, then run an immediate bench experiment. Resources, components, and uninstalled products may be samples. Installed equipment and the power utility are not samples. Supporting larger quantities or additional methods later is a content/schema extension, not a requirement for the first UI.

All selected samples are consumed on a successful, informative experiment. Methods may add a separate local power cost; the opening bench method costs zero power. Preview shows the complete cost before submission. Browsing the journal and editing an unsubmitted selection do not save or advance research.

Resolution sequence:

1. Recheck payload, occupied site, ownership, method capability, inventory, and costs inside the action transaction.
2. Build the detached context and normalized sample profile from the candidate state.
3. Select undiscovered candidates eligible at the start of this experiment.
4. Match evidence rules and determine remaining credit for each matched observation variant.
5. Award positive baseline insight to eligible, informative evidence; add a bounded random bonus.
6. Accumulate insight for every matching discovery and clamp progress to its threshold.
7. Grant all discoveries reaching their thresholds. Newly granted discoveries affect eligibility on the next experiment, avoiding order-dependent cascades.
8. Return research deltas, next random state, observations, and newly granted IDs.
9. The action pays the complete cost, applies deltas and shared discovery grants, and records the attempt in the candidate. Existing validation/save/commit handles publication.

An experiment can make progress toward several discoveries. It cannot roll an unrelated technology. If the same evidence rule has several matching variants, choose its explicitly prioritized most informative variant; do not accidentally award all variants. Different rules can stack when deliberately authored to represent different evidence.

### Chance and guaranteed progress

Guarantee progress for every accepted, informative experiment. Randomness adds insight to relevant evidence; it never removes baseline insight and is never required for the guaranteed path to a discovery. Proposed initial tuning: a 50% chance of no bonus and a 50% chance of an additional 25% of that rule's discounted baseline. Keep probabilities and bounds in research content. Resolve matches in stable discovery/rule ID order so catalog insertion order cannot alter the random draws.

Use integer fixed-point insight, for example 100 internal units per authored insight point, to make repetition discounts exact. Define rounding and a positive minimum internal credit for an informative match. The UI shows qualitative observations, not these numbers.

Persist a small seeded random-generator state. The pure resolver returns its successor. New-game creation supplies the initial seed; tests and legacy migration use explicit reproducible seeds. Preview never draws randomness. Failed actions/save failures commit neither progress nor the generator state; reloading the same saved state and making the same experiment reproduces its result.

No useful evidence remains is a blocked proposal: explain that the setup offers nothing new, suggest changing materials or context, and spend nothing. This makes the guarantee finite and avoids either grinding unlimited insight or paying for empty failures. Hints and authored observations should carry the sense of inconclusive science without penalizing the player with silent resource loss.

### Repetition and context

Retain the brainstorm's proposed 100%, 40%, 10%, then 0% schedule for repeatable experimental evidence. Context-only clues award once. These values are initial tuning, not hardcoded engine policy.

Track credited evidence by discovery/rule/observation-variant, not just a hash of all supplied materials. This deliberately treats scientifically equivalent experiments as repeats. Reordering samples, adding an irrelevant item, switching between equivalent material tags, traveling somewhere irrelevant, or changing an unrelated flag cannot restore credit.

A genuinely new capability or relevant fact may expose a new authored observation variant with its own finite credit budget. Returning to an old variant retains its old counter. Only meaningful declared changes distinguish variants. Store normalized raw input signatures in the journal for display, not as an ever-growing progression index.

This is a refinement of exact-input repetition from the brainstorm: it bounds saved counters by catalog size and prevents ingredient-padding exploits. If later gameplay needs individual material novelty, introduce finite material classes in the rules rather than unlimited input-combination counters.

## 6. Outside evidence, equipment, and shared knowledge

Inspection and dialogue continue recording their existing flags. The next submitted experiment can recognize an uncredited clue and award its one-time contextual evidence. This avoids per-frame research scans or changes to every action producer. A later explicit Study notes method could process clues without materials; it is deferred from the first slice.

Already known clues remain visible to the adapter, including clues learned before a discovery became eligible. Do not consume their credit while the discovery is ineligible. Direct discovery grants from dialogue immediately become shared knowledge; research subsequently treats those discoveries as complete without duplicate rewards or progress announcements.

Capabilities come only from operational, accessible equipment at the occupied site or ship. Owned equipment elsewhere and NPC inventories provide no implicit laboratory access. Basic experimentation can use a new generic bench-analysis capability on the existing fabricator. Adding a spectrometer later means authoring equipment with spectroscopy and research evidence that requires it.

Recipes, acquisition, equipment operations, and dialogue continue owning their own discovery conditions. A discovered alternative conductor becomes useful through its existing crafting role. Tags still do not confer crafting compatibility. Prove alternate role-based solutions with test content; do not expand the production item roster merely to demonstrate architecture.

Historical actions and visited-location counts are not currently recorded generically. Use existing persisted facts in version one. Future historical evidence should add a specifically needed, bounded fact/counter through an explicit adapter, rather than logging all actions or parsing narrative text.

## 7. Opening progression slice

Introduce research gates across the existing opening, while keeping salvage and inspection available from the start. The player must never need a researched item to access their first research method.

| Proposed discovery | Existing behavior it gates | Initial research direction |
| --- | --- | --- |
| Structural fabrication | `iron:refine` and solar-array repair | Examine a newly authored damaged structural fitting; experiment with metal scrap. |
| Electrical conduction | `conductiveParts:fabricate` | Study electronic salvage and mixed metal/electrical samples. |
| Circuit assembly | `electronicParts:fabricate` | Electrical experiments using salvage and available conductors; optional engineer clue. |
| Semiconductor behavior | Evidence context for later discoveries | Analyze silicon-bearing samples; more than one material/context route. |
| Photovoltaic fabrication | `solarCells:fabricate`; `solarPanel:assemble` also requires relevant structural/electrical knowledge | Analyze silicon with electrical materials, inspect damaged solar hardware, or use an optional NPC clue. |
| Radio assembly | `radioAntenna:assemble` | Combine circuit-related evidence and communications context. |

Installation and operation may rely on the assembled item's existence where another knowledge gate adds no useful choice. Author gates on the actual recipes and repair action rather than having research call unlock functions.

Add inspectable damaged hardware at Habitat 05 and an optional technical dialogue topic. Do not repurpose the existing unfinished-mirrors observation as evidence about photovoltaic manufacturing; give the clue accurate subject matter. Do not require the antenna's scan as a prerequisite for building the first antenna, or require travel to the currently unreachable relay for opening progress.

The opening sequence becomes inspect/salvage → discover structural fabrication → fabricate structural parts → repair solar array → pursue electrical/circuit/solar/radio research. Later opening discoveries may overlap and branch rather than forming one mandatory linear chain.

Recommended numerical proof cases before balancing the whole slice:

- Structural fabrication: threshold 8, a scrap experiment gives 6 baseline, and its second evidence credit gives 2.4. Thus two experiments suffice without luck or an NPC. An optional inspection clue worth 2 permits discovery on the first experiment. Budget research scrap separately from the eight scrap needed for repair parts.
- Photovoltaic fabrication: illustrative threshold 10, one qualifying silicon/salvage experiment gives 4 and another qualifying silicon/electronic-parts experiment gives 6. Guaranteed discovery is possible without a random bonus. Inspection, a semiconductor discovery, or an NPC clue may offer alternative eligibility/context routes. Each route must be checked for access to its materials before the gated discovery.

These are tuning proposals, not final content numbers. Before implementation of the content slice, write a route table for all six discoveries listing prerequisites, available materials, baseline awards, repetition caps, and minimum-cost routes. Each discovery needs a route that succeeds with every random bonus set to zero; key later discoveries need at least two meaningfully different routes.

Zero power must not prevent opening research, salvage, basic fabrication, or solar repair. The current fabrication path has no base power charge; preserve that recovery property while introducing knowledge gates. Show the next useful research hint when a numbered opening directive is unavailable. Preserve shortcuts 1/2/3, and explain why refine/repair cannot yet run instead of silently leaving the player without direction.

## 8. Saved state and compatibility

Keep `knowledge.discoveries` as the sole authority for completed knowledge. Add a `research` section containing per-discovery insight, bounded evidence-credit counters, family exposure summaries, attempt count/next attempt ID, random-generator state, and recent journal entries. Persist no catalog copies, context snapshots, callbacks, or derived available-discovery lists.

Each journal entry contains a stable sequential ID, method, selected items, occupied location, simulation time, qualitative observations, and discoveries made. Retain the newest 100 attempts initially. Keep historical totals and evidence counters independently; trimming the journal must never restore exhausted credit. Cap any exposure score once it reaches its display maximum so counters cannot grow without purpose.

Validation checks finite nonnegative quantities, safe integer counters, known method/evidence references, legal random state, journal bounds, and consistency with discovery thresholds. A discovery granted externally or by migration may have no experimental insight; completion must not depend on manufacturing a matching research history. Raw journal history is not the source of truth for current insight.

Migrate supported versions 1–5 through the existing migrations and then to version 6. Never reset inventory, equipment, NPC history, flags, or existing discoveries. Malformed saves remain preserved under the current startup failure behavior.

Recommended legacy policy: grant the six opening discoveries to older saves, since those recipes were previously available without research. New games experience the complete gated opening; existing games retain their former capabilities. This is an explicit compatibility decision, not reconstructed experiment history. Mark legacy grants separately from experimental journal entries if explanatory text is needed.

Reconcile research content on every load, independently of the save-version migration. Add new progress entries lazily/default-empty. Renaming or removing IDs requires an explicit mapping or tombstone that preserves earned discoveries and spent evidence; never silently discard those counters. Text edits do not reset progress. Threshold or rule-credit changes require an explicit balance migration policy so exhausted old saves cannot become stranded. Do not automatically grant discoveries or advance random state during rendering or passive reconciliation.

## 9. Research tab and feedback

Add a Research tab with three sections: experiment workbench, observations/recent attempts, and discovered knowledge. Show local facility availability, owned sample inventory, selected sample cost, qualitative family tendencies, and one useful hint near the experiment control.

Do not list undiscovered technologies or numeric hidden insight. Reveal names and descriptions when knowledge is granted. Exact costs, unavailable equipment, and exhausted setups are visible. Clearly explain that related setups can share exhausted evidence. Include a concise discovery announcement after successful save and commit.

Keep the sample selection local to the panel, bound to its current location. Clear it on location change; revalidate it whenever inventory/access changes. Preserve it across ordinary tab switches. Submission always rechecks current state even if the UI was previously enabled. Do not silently choose or consume replacement samples.

Journal access is available while visiting unowned sites, but their inventories and equipment remain private. Use normal tab keyboard behavior, labeled controls, a single result announcement, and a scrolling journal on narrow screens. Avoid full DOM rebuilds on every simulation frame; catalog compilation and experiment resolution never belong in the render loop.

Register research execution as a normal managed action with explicit site/ship locations, derived after the world is compiled. This avoids widening the location catalog's currently restricted crafting/equipment action collections just to add research. Method conditions determine where execution is supported. Do not make the action global and assume the registry will enforce ownership: its automatic managed-access check explicitly exempts global actions.

## 10. Ordered implementation work packages

| Step | Work and affected areas | Completion evidence |
| --- | --- | --- |
| 1. Freeze contracts and opening routes | Finalize research schema, state ownership, numeric policy, route table, and legacy migration choice. | All six discoveries have a no-luck route; research/repair bootstrap has no power or prerequisite cycle. |
| 2. Compile research content | Add content, catalog, and composition modules. Validate references after item/world/people compilation. | Invalid definitions fail clearly; test-only definitions compile without runtime edits. |
| 3. Implement the pure resolver | Add profiles, detached context, evidence matching, repetition, insight, seeded chance, and result structures. | Identical inputs/progress/seed reproduce output; frozen inputs remain unchanged; multiple discoveries and alternate routes pass. |
| 4. Persist research safely | Add research state helpers, version 6 migration, content reconciliation, and shared knowledge helper; adopt helper for existing dialogue discovery effects. | Versions 1–5 migrate; malformed saves are preserved; journal trimming does not restore evidence. |
| 5. Connect managed actions | Add research actions and register them in `app.js`; use existing resource payment and candidate transaction. Validate the complete action set. | Invalid/stale requests and save failures spend nothing; local ownership and equipment access hold on sites and ships. |
| 6. Author the opening | Add bench capability, six discoveries, hardware inspections, optional technical dialogue, recipe/repair gates, and contextual opening hints. | A fresh game reaches repair, solar-panel assembly, and antenna operation through research with zero random bonuses. |
| 7. Add Research presentation | Extend `index.html`, `style.css`, and tab/render wiring in `app.js`; add the research display. | Selection, costs, hints, journal, discoveries, keyboard access, mobile layout, and location changes work. |
| 8. Verify and document authoring | Add `RESEARCH_AUTHORING.md`; update README and affected authoring guides/tests. | Full applicable unit/browser checks pass; adding a discovery, clue route, and capability variant needs only supported content edits. |

No broad rewrite of the game loop, action registry, location ownership, crafting engine, or message bus is required. Steps 4–5 must be complete before gameplay/UI can commit research progress.

## 11. Verification and acceptance criteria

Add focused research catalog, engine, and transaction tests using the existing Node test setup. Extend existing crafting/player-action expectations where knowledge gates intentionally change the opening. Keep browser checks in the established isolated-save harness.

Required checks:

- No mutation of frozen engine inputs; repeatable seeded outcomes; baseline progress across every random outcome; no unrelated discoveries and no same-experiment eligibility cascade.
- Multiple candidates progress, multiple thresholds can be crossed, external discovery grants are idempotent, and ineligible discoveries do not consume evidence credit.
- Reordered/irrelevant inputs and equivalent material substitutions cannot reset credit; relevant capability variants can; toggling back preserves counters.
- Context-only clues award once, survive being learned early, and work through both targeted location and NPC flags.
- Invalid IDs, duplicate sample requests, negative/fractional quantities, utility samples, installed equipment, insufficient stock/power, and stale selections cannot produce partial payment.
- Research at another owned site cannot draw Habitat 05 assets; unowned-site and passenger-ship research cannot access private equipment/inventory; owned equipped ships follow the same rules as sites.
- Forced storage failures leave resources, insight, journal, knowledge, and random state unchanged, with no success announcement.
- Legacy saves retain assets and formerly available capabilities; new games receive no legacy discovery grants. Reload, history trimming, and compatible content edits preserve progression.
- Full opening routes succeed with zero bonuses, including after power reaches zero. Optional NPC and alternate material routes reach the same knowledge. Essential materials remain renewable and obtainable before their gates.
- Browser checks cover Research tab focus, costs/results, hidden discovery information, exhausted feedback, inventory changes, location changes, reload, long journals, and 390-pixel layouts.

Verification used `node --test tests/*.test.mjs` and `node --test tests/terminalTabs.browser.mjs` with the established Playwright setup. After the final additive-compatibility change, the full unit suite and all affected research browser cases passed again.

The system is ready when research gates the new-game opening without stranding the player, alternate routes succeed without luck, saves remain transactional, and a new discovery or equipment-based evidence route can be added without modifying the engine or its consumers.
