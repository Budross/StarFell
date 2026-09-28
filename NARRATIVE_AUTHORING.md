# Narrative v1 authoring and integration

Narrative reads a committed game snapshot and returns detached prose. Gameplay owns truth; presentation decides when to request prose; Narrative selects and realizes supported claims. All generated output goes to **Operations → `#narrative-stream`**. It requires no saved fields or save-version change.

## Entry points

`buildGameSystems()` explicitly constructs `systems.narrative`. Its methods are `buildContext(state, request)`, `selectBeats(context)`, and `describe(state, request, options?)`. Requests support:

```js
{ surface: 'inspect_location', subjectId: state.locationId }
{ surface: 'inspect_equipment', subjectId: state.locationId, equipmentId: 'thermalProcessors' }
{ surface: 'npc_greeting', subjectId: 'mira' }
{ surface: 'npc_ambient', subjectId: 'mira' }
```

Targets use instance IDs, not definition IDs. V1 observes the occupied host and available local NPCs. Remote or unavailable subjects return `status: 'unavailable'`; eligible requests with no useful content return `status: 'empty'`. Successful results contain `text`, detached `segments`, and a semantic `fingerprint`. Pass `{ diagnostics: true }` as the third argument to `describe` to inspect admitted facts, selected beats, score inputs/contributions, tuning, and rejection reasons. Inspection surfaces include a safe base; ambient observations can be empty. Explicit observations can repeat identical prose.

Equipment inspection uses the existing Available Directives choices, with no dropdown or additional narrative controls elsewhere. `narrativeActions.js` consumes admitted current facts to offer inspection for degraded/disabled equipment, limited/blocked work, or output awaiting delivery. Sound equipment with ordinary work/idle status does not create a choice; history alone does not create one. These presentation choices compose with gameplay directives but bypass the mutation/save transaction. Selection rechecks eligibility against the current committed context. Click the choice or type its displayed name. `look` and `observe` remain reserved presentation commands for location observation. These reads do not rerun the one-time console/scene inspection actions or their effects. Explicit requests reveal Operations and scroll the new receipt into view; automatic publication preserves the existing reading position. NPC greeting supplements after a committed dialogue start remain in Operations while People retains authored choices, passages, tokens, session state and effects. Generated speech is never stored in dialogue history.

## Truth and access

Providers in `js/narrative/providers/` own typed projections of their domains. Facts have `basis: 'current' | 'history'`, a typed subject, importance/severity, exposure, and provenance. History is a bounded, detached read of the recent World Ledger, interpreted by the owning provider. Facts and contexts are recursively frozen detached values. Selectors and realizers receive no state/catalog query capabilities.

Modular vessel construction joins the same pipeline. `vesselFacts.js` projects
current geometry and authorized composition at the occupied ship or its actual
berth; a separate `recent_vessel_assembly` fact interprets committed ledger
history. The `VESSEL_ASSEMBLED` trigger can produce one mixed history/current
construction beat after commit. Current geometry may be inspected again; old
construction does not replay automatically on reload. See
[Modular vessel authoring](VESSEL_AUTHORING.md).

The stages only narrow information:

1. Existing `authority.js`/domain decisions grant mechanical access. Narrative consumes `useFacilities`, `manageEquipment`, `viewCargo`, and existing entity visibility decisions.
2. World/equipment `narrative.observableTopics` can expose **coarse local** observations. It never grants precise private values or exposes a hidden entity. A visible condition band contains no exact health, quantity, enabled state, upgrades, cargo, or allocation numbers.
3. `narrativeKnowledge` determines observer knowledge. NPCs can perceive admitted current local facts. Historical NPC facts require explicit participation; being nearby now or appearing in a ledger query is insufficient. V1 does not implement memory, witnesses or public-report channels.
4. NPC `narrative.observationInterests` limits which known topics become speech candidates. Interests never grant knowledge/access. Private speech requires both speaker and listener access.
5. Hard eligibility precedes scoring and budgets. No score restores denied information.

Metadata is optional and compiled in existing catalog builders:

```js
// Location/type or installed-equipment definition
narrative: {
  base: 'A compact industrial habitat among the unfinished collectors.',
  observableTopics: ['equipment_condition', 'industrial_activity'],
  dimensions: { origin: ['industrial'], scale: ['compact'] }
}

// NPC definition: preferences, not world observability
narrative: {
  tone: 'practical', greeting: 'Hello.',
  observationInterests: ['equipment_condition', 'industrial_activity']
}
```

Equipment installation metadata belongs on the item's `installation.narrative`, which is copied into the compiled equipment group. Location type dimensions merge per dimension; an explicit location dimension replaces that dimension's inherited values. Topic/tone IDs and dimensions are validated. Missing observability metadata grants no extra operational detail. Fixed location bases must describe durable identity/setting, not continuous operational states such as empty racks or working life support. Instance fallback bases use the resolved instance name.

Keep these distinctions intact: current truth ≠ historical occurrence; enabled ≠ powered; operational ≠ currently progressing; empty reserve ≠ universal blackout; delivered completion ≠ buffered delivery; unknown ≠ absent; visible condition ≠ an unrepresented mechanical defect. Templates may not invent leaks, cracked busbars, deaths, radiation breaches, broken actuators, or blocked intakes.

## Processing truth

`calculateProcessingReadiness` in `js/processingQuery.js` is the **one pure instantaneous planner** used by both simulation and narrative. It preserves run-ID ordering, equipment capacity, host/source access, blocker precedence and power allocation. Immediate buffer deliveries are previewed in order on detached resource values so released equipment slots affect the same allocation used by simulation. Simulation applies the planned deliveries and integrates the result; queries never perform them. Actual working/delivery phase and buffered material remain current facts until mutation commits.

Never use saved `blockedReason` as an instantaneous readiness query, and never recreate allocation in a provider. The Workshop read view also consumes this planner to avoid showing a stale blocker immediately after an action. `NO_POWER` can mean fractional progress: templates distinguish limited progress from waiting for power. `PROCESS_COMPLETED` means output entered cargo; work-finished transitions only supply a transient trigger hint. Depletion can coexist with undelivered output.

## Beats, templates and tuning

`narrativeContent.js` holds surface policies, score coefficients/floors, phrase lexicon and authored template variants. They are content-tuning parameters. Architectural guarantees are hard eligibility → score → stable total ordering → topic/category/history budgets, not particular percentages. Tune against representative descriptions and use diagnostics to explain the result.

Dynamic beats cite nonempty fact keys and clause-specific evidence. `beatBasis` derives `current`, `history`, or `mixed`; candidates/templates cannot author a competing provenance value. Every mixed or historical beat consumes one history slot. A zero history budget excludes both. Missing evidence, unsupported clause bases and private values in coarse projections fail validation. Current activity and equivalent started/blocked/resumed history share coverage to reduce repetition.

Templates are literal strings with compiled typed `{slots}`. Each family has a fixed claim/slot contract; variants must say the same thing. The compiler rejects malformed braces, unknown/unused slots and duplicate variant IDs. No executable expressions, gameplay conditions, scripting DSL or runtime generation is allowed. The condition lexicon supplies predicate phrases, not a mixture of incompatible grammatical roles. Review all variants for truth as well as grammar.

Production uses a fixed narrative seed. **Two playthroughs with the same subject, selected meanings and narrative content version use the same wording.** There is no per-save cosmetic variation. Choice salts include each beat's own meaning so unrelated facts do not rephrase it. Exact progress, unused reserve fractions, wall time, research RNG and ledger counters do not seed prose. If broader world generation later introduces an immutable world seed, bootstrap can incorporate it using the existing `narrativeSeed` seam. V1 must not save a seed solely for narration or reuse research RNG.

## Presentation triggers

`createNarrativePresentation` in `js/narrativePresentation.js` owns publication requests, outside domains/providers. `app.js` handles the existing stream and tabs.

| Trigger | Source | Publication/focus |
| --- | --- | --- |
| Explicit observation | Observe/Inspect/Look/Hear | Read current committed state; repeated results allowed; reveal Operations. |
| Direct-action aftermath | Successful action commit | Relevant process start/abort, equipment repair, entry/boarding, or dialogue start. Request at most one contextual result after validation/save/commit. A failed action/save produces none. |
| World transition | Successful simulation commit | Explicit supported semantic edges, filtered for local/player relevance and consolidated into one request. Append without switching tabs or moving focus. |

The committed adapter reads records with IDs above the previous snapshot's ledger counter, plus Processing's transient working→delivery reports. It notes partial retention when a long transaction exceeds the ledger window. This is a bounded best-effort presentation summary, not a queue or durable replay channel. The runtime's existing `{ previous, state, ...output }` contract remains generic. Optional `processingTransitions` output is emitted only when an actual phase edge occurs.

The explicit v1 allow-list covers local Processing blocked/resumed/completed/aborted transitions, resource-node depletion, buffer phase edges, action starts/repairs, and occupied-ship/local-berth arrival/departure. A record's existence does not imply narration. Continuous progress, quantities, health fractions, battery/rate changes and simulation time do not trigger text. Remote machines/ships, generic research/NPC/entity updates and future goals/director work are not automatically reported. One-time inspection actions retain their authored receipts; no generic effect/state-diff policy infers aftermath from arbitrary changes.

Internal `operations_update` requests contain the occupied host and filtered transition references. Providers supply actual truth independently; the selector restricts candidates to supported resulting conditions/relevant retained history. This surface has no base identity, at most two dynamic beats, and one history slot including mixed evidence. It never concatenates one sentence per ledger entry. A removed run cannot be described as working or buffered just because an earlier phase hint occurred in the same transaction.

Transient weak committed-state identities suppress repeated automatic handling. Explicit observations bypass suppression. No seen-message/cursor fields are saved. Reload begins with one current opening observation and authored tutorial guidance; it does not replay an automatic backlog. Operations marks new off-tab observations with a small dot, cleared when opened. App narrative errors are isolated from successful commits and cannot pause/roll back simulation. Existing log entries remain immutable observation receipts, subject to the existing transient log's length limit.

Future Event Director consequences can use ordinary gameplay operations → domain semantic edges/ledger → successful commit → an explicitly composed presentation rule → this same narrative pipeline. Major scripted moments can still use authored prose. Add actual producers/providers and tests for new cases; do not add a mutable registry, general diff engine, saved queue, narrative event bus or remote reporting mechanism.

## Verification

Run `node --test tests/*.test.mjs`, including existing Processing numerical fixtures and `tests/narrative.test.mjs`. With Playwright available, run `node --test tests/terminalTabs.browser.mjs`. Narrative tests cover detached generation, mixed evidence/quotas, privacy/knowledge/interests, metadata validation, shared allocation including delivery slot release, stale blockers, relative scoring, templates, deterministic wording, edge-only updates, consolidation, buffering, remote silence, reload and save failure. Browser cases exercise actual app frame callbacks, explicit repeat/reveal behavior, automatic focus preservation/duplicates, immutable log receipts, mobile layout, authored conversations, and failed-save silence.
