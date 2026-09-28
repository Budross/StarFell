# Simulation Step and State Lifecycle Registries — Implementation Plan

Status: implementation complete; final verification results appear in section 11.
Inspected and implemented against the current repository on 2026-09-26/27.
Baseline: all 188 unit tests and 37 isolated browser checks pass.

Approved refinements: `createStateDomains` is the only default state manifest;
`entityState.js` is narrowly runtime entity/state consistency logic; both bootstrap
composition hooks run only during construction. Retain `reconcileCurrentInstances`
as per-load context: separate manifests or extra phases would complicate the
existing historical migration path without improving its behavior.

## 1. Outcome and scope

Implement simulation composition first, then current-state lifecycle composition.
Both use explicit ordered arrays assembled by `bootstrap.js`. Domains export
narrow synchronous capabilities; generic runners invoke them. There is no
self-registration, discovery, mutable global registry, or plugin framework.

Acceptance conditions:

- A timed subsystem joins through an adapter and one simulation-composition entry,
  with no changes to `runtime.js`.
- A persistent subsystem joins current validation/reconciliation through its
  hooks and one state-composition entry, with no changes to `stateCore.js`.
- These extension paths are proved with test-only participants through the
  production bootstrap, not just by directly testing a loop.
- Existing gameplay, quantities, state, messages, save timing, rollback,
  visibility handling, and supported migrations retain their behavior.

Keep `SAVE_VERSION = 8`. Registries and execution context are transient and never
serialized. No production content is added.

Non-goals: scheduling, queued events, timestamps for jobs, offline/background
progress, simulation LOD, async/parallel execution, dependency sorting, numeric
priorities, generalized initialization, generic migrations, or Effect Dispatch
Round 2. Do not restructure ships, research, effects, displays, or storage.

## 2. Findings that determine the implementation

| Current code | Consequence |
| --- | --- |
| `runtime.advance()` calls `advanceGame`, `advanceJourneys`, then `reconcileContact`. | Preserve this exact order and the same candidate object throughout. |
| `advanceGame` increments `simulationTime` after updating power. | Keep that clock increment inside the delegated operation for this round. Do not increment time again in the runner/runtime. Journeys and contacts see the updated time. |
| Runtime saves for arrivals, contact closure, or five accumulated active seconds. | Steps must report a save request without saving themselves; the runtime still applies the save policy. |
| Runtime returns `{ previous, state, arrivals, closure }`; `app.js` presents these after commit. | Preserve those result fields, including empty `arrivals` and empty-string `closure`. A void-only runner would lose required behavior. |
| `applyAction()` also calls `reconcileContact`. | Supply that existing action reconciliation as a narrow callback; do not run the timed sequence during actions. |
| `validateState` interleaves location and NPC checks while iterating entities. | Preserve the combined instance-validation pass first. Splitting it into independent location/NPC passes could change which invalid record fails first. |
| Version-eight loading prevalidates entities, checks domain maps, then reconciles instances before dialogue/research. | Move the complete ordered preflight/instance-reconciliation operation into its hook. Do not perform full validation before content repair. |
| Versions one–seven pass through `stateV7.js`, then explicit identity migration, then current dialogue/research reconciliation and validation. | Preserve that routing. Current authored-instance reconciliation must remain version-eight-only. |
| Dialogue reconciliation can return a notice; research reconciliation already validates research internally. | Preserve notices and internal checks, including the subsequent final validation. Do not deduplicate behavior during extraction. |
| `state.js` supplies compatibility defaults; `worldCatalog.js` obtains worlds through bootstrap. | Keep current composition independent of bootstrap/default-world wrappers to avoid startup cycles. |
| Bootstrap already assembles reference collectors, including content references. | Pass the same explicitly composed collectors into lifecycle validation. Preserve direct-call collector overrides. |

## 3. Module boundaries

```text
bootstrap.js
  ├── default simulation adapters, ordered explicitly
  │      └── simulationRegistry.js (generic execution)
  ├── stateComposition.js (bound descriptors, ordered explicitly)
  │      ├── stateLifecycleRegistry.js (generic phases)
  │      └── existing domain functions / extracted state checks
  └── runtime construction inputs and bound state services

runtime.js
  └── generic simulation runner + supplied validation/action callback

stateCore.js
  ├── root/version checks, initial assembly, explicit migration routing
  └── composed current validate/reconcile operations
```

Generic runners must have no imports from gameplay domains, bootstrap, default
worlds, persistence, or UI. State composition must not import `stateCore.js`.
Extracted state-check helpers must also be independent of `stateCore.js`.

`stateCore.js` may retain existing initialization and historical identity-migration
imports. Removing domain knowledge from current validation/reconciliation does
not require inventing an initialization or migration registry.

## 4. Simulation contract

Use a descriptor with a stable, nonempty ID and a synchronous operation:

```js
{
  id: "journeys",
  advance(candidate, elapsedSeconds, context) {
    const arrivals = advanceJourneys(candidate, elapsedSeconds, world);
    return {
      saveRequested: arrivals.length > 0,
      output: { arrivals }
    };
  }
}
```

Domain adapters bind only their dependencies through closures. The optional
execution context is deliberately small; production steps need no whole-app
context because their catalogs are already bound. Every step receives elapsed
simulation **seconds**, not milliseconds, a frame timestamp, or total world time.

`advanceSimulation(candidate, elapsedSeconds, steps, context)` runs in array order
and returns `{ saveRequested, output }`:

- A step may return `undefined` when it has no result or save request.
- `saveRequested` is combined with logical OR. It is a request for the runtime
  to apply its existing validation/save policy, not a persistence operation.
- Optional `output` objects merge into a detached report. Default adapters own
  `arrivals` and `closure`; generic code never interprets those names.
- Reject duplicate report keys rather than silently overwrite another step.
  Reserve `previous` and `state` so reports cannot replace commit identities.
- Reject malformed returns and thenables with step attribution. No awaiting,
  compensation, or new rollback policy is introduced.
- Stop on the first error. Never clone, validate, save, render, publish messages,
  or replace runtime state in the runner.

Validate descriptor shape and duplicate IDs once during composition. Copy/freeze
the assembled list and descriptors so runtime order cannot change accidentally.
Do not deep-freeze state or catalogs, and do not freeze caller-owned arrays.

### Default ordered composition

Construct these thin adapters in `bootstrap.js`, using existing exports:

| ID | Delegated operation and captured dependencies | Result |
| --- | --- | --- |
| `power` | `advanceGame(candidate, elapsed, content, contextFor)` | No report; retains the existing time increment. |
| `journeys` | `advanceJourneys(candidate, elapsed, world)` | `{ arrivals }`; request save if nonempty. |
| `contacts` | `reconcileContact(candidate, people)` | `{ closure }`; request save if nonempty. |

Inline adapters are sufficient here; do not add three adapter files or modify
domain APIs just to rename existing functions.

Provide an explicit optional bootstrap composition callback:
`composeSimulationSteps(defaultSteps, systems)`. It returns the complete ordered
list and defaults to returning the defaults. It allows a fixture to insert a fake
step at a chosen position. It is a construction option, not registration at runtime.
Validate/snapshot its returned list before returning systems.

### Runtime integration

Runtime construction receives `simulationSteps`, optional `simulationContext`,
`validate`, and `reconcileAction`, in addition to `initialState` and `save`.
Bootstrap supplies `validate` as the bound state-service operation so root/version
checks accompany domain validation. It binds `reconcileAction` to the existing
contact operation. Runtime needs no lifecycle/catalog fallback of its own.

For Phase A, retain the existing supplied/default state validator until Phase B
provides the lifecycle service. The end state removes runtime's domain imports
and its catalog-specific validation fallback. Missing required capabilities fail
at construction with clear errors; do not silently run an empty production list
or install a no-op validator.

The advance transaction remains:

```text
paused / invalid or nonpositive elapsed → return null
clone committed state once
execute ordered simulation steps on candidate
shouldSave = report.saveRequested || accumulated seconds >= 5
if shouldSave: validate(candidate), then save(candidate)
replace state only after successful execution and any required save
reset or accumulate secondsSinceSave
return { previous, state, ...report.output }
on failure: pause and rethrow; leave committed state and timer unchanged
```

Actions retain clone → execute → supplied contact reconciliation → validate →
save → commit. Preserve message joining, pause recovery, and timer reset. Action
failure does not acquire the frame's pause-on-error policy. `flush()` continues
to save current state directly. Visibility/clock sampling remain in `app.js`.

## 5. State lifecycle contract

Descriptors expose only supported phases:

```js
{
  id: "research",
  validate(state, context) {
    validateResearchState(state.research, research, state);
  },
  reconcile(state, context) {
    reconcileResearchContent(state, research);
  }
}
```

`stateLifecycleRegistry.js` supplies a factory for an immutable ordered collection
with `validate(state, context)` and `reconcile(state, context)` operations. Skip
absent hooks; require at least one supported hook per descriptor. Validate IDs,
hook types, and duplicates during construction. Hooks are synchronous and must
not return thenables. Validators throw to reject a state and do not mutate it;
reconcilers mutate only the supplied load candidate.

The runner does not clone, version-route, initialize, seed, save, commit, or
publish. Reconciliation notices are appended to the caller-supplied `notices`
array by adapters in execution order; the runner needs no generic message bus
or elaborate return aggregation.

`stateComposition.js` exports `createStateDomains(dependencies)` and
`createStateLifecycle(dependencies, domains?)`. Bind catalogs and the selected
reference collectors through closures. Per-call reconciliation context contains
only `{ notices, reconcileCurrentInstances }`. The boolean is an explicit load
mode selected by `stateCore.js`, not a migration hook or a stored field.

### Preserve validation order

Keep root object/save-version and finite nonnegative simulation-time checks in
`stateCore.js`. Follow them with this ordered descriptor list:

| Order / ID | Validation responsibility |
| --- | --- |
| 1. `entities` | Existing `validateEntities(state)`. |
| 2. `authority` | Existing `validateAuthority(state)`. |
| 3. `entity-instances` | Existing location/NPC map checks; transient `runtimeWorld`; authored location then NPC identity checks; orphan/ownership checks; combined entity iteration, retained-state checks, definition/type checks, and delegated local/NPC validation. |
| 4. `ships` | Existing `validateShipStates`. |
| 5. `dialogue` | Existing `validateDialogueState`. |
| 6. `knowledge-flags` | Existing boolean-map and knowledge checks. |
| 7. `research` | Existing `validateResearchState`. |
| 8. `entity-references` | Existing `validateEntityReferences` using explicitly selected collectors. |
| 9. `crafting-selection` | Existing recipe/ingredient selection checks. |

Extract the combined instance validator, `validateTerminalState`, and current
`reconcileInstances` into `js/entityState.js`. This is a mechanical move of a
cross-domain invariant, not a redesign of entity type dispatch. Keeping the
existing loop preserves its order for authored, generated, inactive, and terminal
entities. Error attribution for this pass names `entity-instances` and preserves
the existing entity ID in the underlying error.

Move the short knowledge/flags and crafting-selection checks into local adapter
helpers in `stateComposition.js`; they currently have no dedicated root-state
validator. Do not expand the public crafting/knowledge APIs solely for this move.

### Preserve reconciliation order and version routing

The same descriptor list yields these reconciliation participants:

1. `entity-instances`: if `reconcileCurrentInstances` is true, run the existing
   `validateEntities` preflight, location/NPC record check with its current error,
   and current `reconcileInstances` in that order. Seed identities and add empty
   assets exactly as today. Preserve terminal-state skipping and orphan rejection.
2. `dialogue`: call `reconcilePeopleContent`; append a nonempty notice.
3. `research`: call `reconcileResearchContent`, retaining its internal validation.

Load routing stays in `stateCore.js`:

```text
saved version 1–7:
  clone legacy input and remove entity registry fields as today
  migrateV7 with existing notices/research/legacyStorage arguments
  existing explicit migrateIdentities
  lifecycle.reconcile(candidate, { notices, reconcileCurrentInstances: false })
  current root checks + lifecycle.validate(candidate)

saved version 8:
  clone saved input
  lifecycle.reconcile(candidate, { notices, reconcileCurrentInstances: true })
  current root checks + lifecycle.validate(candidate)
```

Keep the existing input-version guard and `validateSpawnIds` position. Do not
perform version-eight instance reconciliation for legacy saves after identity
migration: that would add work absent from the current successful path.

Keep `stateV7.js` and `storageMigration.js` unchanged. Historical reconciliation
inside `stateV7.js` is retained, even though current reconciliation follows it.
No rewards, random draws, starting grants, or lifecycle reactivation occur on
load. Existing notices keep their text and order. Source saves remain unmodified
when reconciliation or validation fails.

### Initialization and compatibility

Leave initial assembly in `createInitialState`: locations/NPCs, dialogue, crafting,
knowledge, flags, research seed, then entity seeding. Its final validation must
use the composed lifecycle. Do not add `initialize`, `seed`, or `migrate` phases.
A future subsystem requiring initial saved data may still need an explicit
initial-assembly change; that is outside the validation/reconciliation acceptance
condition.

Preserve existing positional exports, including custom collectors and legacy
storage metadata. Append an optional composed lifecycle argument:

```text
createInitialState(content, world, people, research, seed?, lifecycle?)
validateState(state, content, world, people, research, collectors?, lifecycle?)
migrateState(saved, content, world, people, notices?, research, legacyStorage?, lifecycle?)
```

If lifecycle is omitted, core obtains the default lifecycle from the separate
state-composition factory using supplied catalogs/collectors. It never constructs
a default world or imports bootstrap. This maintains direct `stateCore.js`
consumers without a second domain list. A supplied lifecycle is authoritative;
bind collector overrides when composing it rather than silently combining an
override with a stale bound lifecycle.

Forward the optional parameters through `state.js`, preserving its default-world
behavior. Bootstrap constructs a lifecycle once after reference collectors exist
and exposes bound `stateServices` for creation, migration, and validation. Update
`app.js` to use these services for both load/create and its extra startup
validation. Runtime uses the same lifecycle. This ensures custom domains are
present on startup, loading, actions, and save-triggering frames.

Provide `composeStateDomains(defaultDomains, systems)` as the optional bootstrap
construction callback, equivalent to simulation composition. Defaults are fully
ordered; the callback returns the complete chosen array. Dependencies supplied
to callbacks include compiled catalogs and reference collectors, not runtime,
DOM, or partially created lifecycle services.

## 6. Errors and isolation

Wrap runner failures with messages such as:

```text
Simulation step "journeys" failed: <existing message>
State validation failed in "research": <existing message>
State reconciliation failed in "dialogue": <existing message>
```

Preserve the original thrown value as `cause`, and expose participant ID and
phase as structured error properties. Do not alter the original error object.
Include the underlying message verbatim where available. Root/version errors
and frozen historical migration errors remain outside participant attribution.
Save failures remain save failures, not errors attributed to the last step.

Each composed game owns its own descriptor snapshots and bound catalog services.
No runtime may reuse another game's mutable candidate or captured catalogs.
The no-async contract requires hooks to finish all mutations synchronously;
rejecting a thenable is fail-fast detection, not cancellation of asynchronous work.

## 7. Implementation sequence and exit gates

### A1 — Record behavioral fixtures

- Retain the 188-test unit baseline; run the isolated browser suite before code
  edits if its existing Playwright/Chrome dependencies are available.
- Add characterization coverage for a fixture with power, a completing journey,
  and contact closure in one update. Assert complete resulting state, exact
  messages/results, and save-before-commit behavior.
- Capture representative current validation/reconciliation fixtures before moving
  checks. Include simultaneous invalid records to lock first-error order.

Gate: behavioral expectations are explicit; no runtime/state changes yet.

### A2 — Extract simulation execution and compose production steps

- Add `simulationRegistry.js`, including contract checks and error attribution.
- Assemble the three adapters and optional composition callback in bootstrap.
- Replace timed domain calls in runtime with the runner; merge generic reports.
- Inject action contact reconciliation. Keep all transaction and clock policies.
- Add fake-step insertion and failure tests through `buildGameSystems`.

Gate: power/journeys/contact order and outputs are identical; failed steps/saves
retain committed state, timer, and pause behavior. A fake step runs solely through
composition. Runtime contains no timed domain-name branches.

### B1 — Extract current-state adapters

- Add `entityState.js` by moving the existing instance/retained-state checks and
  current reconciliation without changing their loops or conditions.
- Add generic `stateLifecycleRegistry.js` and explicit `stateComposition.js`.
- Compose the nine descriptors and bind collectors after catalog construction.
- Replace current validation/reconciliation code in core with lifecycle calls;
  retain root checks, initial assembly, and explicit migration routing.

Gate: validation outcomes, first-error ordering, reconciliation state/notices,
and all version 1–8 fixtures remain correct. Historical modules are unchanged.

### B2 — Wire every production and compatibility entry point

- Add bootstrap's optional state-composition callback and bound state services.
- Use those services in app startup/load and the lifecycle validator in runtime.
- Extend compatibility wrappers to forward optional lifecycle/collector arguments.
- Update shared fixture helpers to use the composed services when testing custom
  participants; ordinary direct callers continue to exercise fallback composition.
- Update the collector-injection test in `entityLifecycle.test.mjs`: it currently
  replaces `referenceCollectors` and clears `validate` to rebuild runtime's old
  fallback. Explicitly recompose its lifecycle with those collectors, preserving
  its existing missing-reference and lifecycle-blocker assertions.

Gate: a fake persistent descriptor participates in fresh validation, reload
reconciliation/final validation, saved actions, and save-triggering frames. Two
games with different participants/collectors remain independent.

### C — Architectural verification and documentation

- Run focused registry/runtime/migration suites, the full unit suite, then the
  isolated browser suite. Fix failures without weakening behavioral assertions.
- Check static production imports for cycles and domain imports in generic
  runners; check that core current-validation code has no new domain branches.
- Update `ARCHITECTURE.md` ownership, dependency diagram, saved/time extension
  instructions, compatibility notes, and `README.md` module/verification guidance.
- Record actual results and any dependency limitations in this plan.

Gate: both extension demonstrations pass through production composition and all
required regression checks pass. Then take up Effect Dispatch Round 2 separately;
after that round, stop proactive infrastructure work and start content expansion.

## 8. Verification matrix

| Area | Required assertions | Location |
| --- | --- | --- |
| Simulation runner | Array order, exact same candidate/elapsed/context, deterministic execution, absent outputs, OR save request, report-key collisions, descriptor IDs/hooks, thenable rejection, cause/ID attribution, stop after failure. | New `tests/simulationRegistry.test.mjs` |
| Runtime equivalence | Power → journeys → contacts; time increments once; exact reports/state; quiet commits skip validation/save; arrivals/closure save immediately; five-second cadence; invalid elapsed; pause/action recovery; flush. | Extend `tests/refactor.test.mjs` |
| Runtime failure | Fake middle step mutates then throws; later steps never run; no save/commit; timer unchanged; paused. Validator/save failures likewise retain the prior state. No result is presented before commit. | Registry/runtime tests + existing browser failure coverage |
| Extensibility | Insert a fake timed step at a chosen position solely via bootstrap; add a fake persistent descriptor via bootstrap; exercise actual runtime and bound startup/load services. | New registry suites |
| State runner | Ordered optional phases; malformed/duplicate descriptors; no validation mutation; reconciliation-only/validation-only participants; thenable rejection; phase/ID/cause attribution; no later hooks after failure. | New `tests/stateLifecycle.test.mjs` |
| Current-state validation | Authored/generated/inactive/terminal instances; retained state; orphan/missing/reused IDs; authority; ship state; dialogue; knowledge/flags; research; references; crafting. Lock current first failure with multi-invalid fixtures. | Existing domain suites + state lifecycle characterization |
| Content reconciliation | New authored spawns; empty additions at existing sites; terminal instances never resurrect; dialogue content/contact closures and ordered notices; additive research contracts; incompatible contracts fail; RNG/history preserved. | State lifecycle + entity/dialogue/research suites |
| Legacy loading | Literal versions 1–6 from `tests/fixtures/storage-legacy-saves.json`; existing version-seven adapter fixtures; original input unchanged; quantity conversion once; identity migration once; notices/history/RNG retained; reload idempotent. Spy fake current hook runs only after migration reaches v8. | `storageMigration.test.mjs`, `entityMigration.test.mjs` |
| Current saves | Valid v8 reload deep-equals original; unchanged notices; no version bump; incompatibilities preserve source save. | Migration + state lifecycle tests |
| Isolation and collectors | Two independently composed sessions; direct collector override still works; runtime and lifecycle operations use explicitly recomposed collector lists. | Entity lifecycle + registry tests |
| Browser boundary | Fresh/reload startup; hidden-page clock reset; power/journeys pause when hidden; visibility/pagehide flush; arrivals/contact presentation; failed save pause and recovery. | Existing `tests/terminalTabs.browser.mjs` |

Do not keep a duplicate production implementation as an oracle. Use fixed
characterization expectations and existing integration tests. Fake participants
belong only to tests, require no production content, and do not introduce an
initialization hook to prove validation/reconciliation.

Commands for implementation verification:

```powershell
node --test tests/simulationRegistry.test.mjs tests/stateLifecycle.test.mjs tests/refactor.test.mjs tests/entityMigration.test.mjs tests/storageMigration.test.mjs
node --test tests/*.test.mjs
node --test tests/terminalTabs.browser.mjs
```

The browser suite creates a temporary server and isolated saves. Use the existing
Playwright/installed Chrome setup. If dependencies are missing, report that exact
limitation and resolve it before claiming browser verification passed.

## 9. Expected file scope

| Change | Files |
| --- | --- |
| New generic execution | `js/simulationRegistry.js`, `js/stateLifecycleRegistry.js` |
| New explicit state composition | `js/stateComposition.js` |
| Extract existing shared instance behavior | `js/entityState.js` |
| Composition/runtime/current lifecycle | `js/bootstrap.js`, `js/runtime.js`, `js/stateCore.js` |
| Startup and public compatibility plumbing | `js/app.js`, `js/state.js` |
| New focused tests | `tests/simulationRegistry.test.mjs`, `tests/stateLifecycle.test.mjs` |
| Existing fixtures/integration adjustments | `tests/refactor.test.mjs`, `tests/entityFixtures.mjs`, `tests/entityLifecycle.test.mjs`; other existing tests only where wiring requires it |
| Documentation | `ARCHITECTURE.md`, `README.md`, this plan |

Do not modify `stateV7.js` or `storageMigration.js`. Existing domain exports already
provide the required capabilities; domain modifications should be unnecessary.
Any additional file change must be justified by lifecycle plumbing or a concrete
regression, not by unrelated architectural cleanup.

## 10. Definition of done

- [x] Both generic runners execute explicitly composed, immutable ordered lists.
- [x] Runtime advances without importing or branching on timed domain names.
- [x] Runtime preserves transactions, saving, pause, and returned presentation data.
- [x] Core current validation/reconciliation delegates to composition without a
      domain list, while root/version checks and explicit migration routing remain.
- [x] Current and compatibility entry points use one default composition source.
- [x] Default state hook order and the combined entity pass match current behavior.
- [x] Version 8 remains unchanged; historical modules and legacy routing stay intact.
- [x] Fake timed and saved-state participants prove both extension conditions.
- [x] Errors identify their participant/phase and retain the original cause.
- [x] Full unit, isolated browser, and import-graph checks pass and are recorded.
- [x] Extension documentation describes the actual final contracts.


## 11. Implementation results

Completed both registries with the four approved refinements.

- Default state composition exists only in `createStateDomains` in
  `stateComposition.js`; bootstrap and direct-call compatibility reuse it.
- `entityState.js` contains runtime entity/state consistency and current
  authored-instance repair only. Its extracted validation, retained-state, and
  reconciliation bodies were compared to the original and are unchanged.
- Both optional composition hooks run once at construction. Ordered descriptors
  are copied/frozen; no registration/discovery API was added.
- Kept the per-load `reconcileCurrentInstances` boolean. Legacy conversion and
  identity migration remain explicit; the identity-migration body is unchanged.
- Runtime takes the bound `validate` capability rather than selecting a lifecycle
  fallback itself. This preserves root/version checks and removes catalog
  knowledge from runtime. Both runners attribute errors without changing causes.
- Production startup/load uses composed state services. Compatibility wrappers
  forward optional lifecycles and collector overrides. The custom collector
  integration test explicitly recomposes validation and retains its assertions.
- Save version remains 8; no production content, scheduling, async execution,
  offline progression, or Effect Dispatch Round 2 was introduced.

Verification completed:

- Baseline: **188 unit tests and 37 isolated browser checks passed**.
- Final: **206 unit tests passed**, including 18 new registry/architecture tests.
- Final: **37 isolated browser checks passed**, including hidden-page journeys,
  failed-save recovery, current-content reconciliation, legacy loading, and
  generated entity/contact behavior.
- Static production import graph is acyclic. Runtime imports only the simulation
  runner; both generic runners have no domain dependencies.
- SHA-256 verification confirms `stateV7.js` and `storageMigration.js` are
  byte-for-byte unchanged from the baseline.

The browser suite used the existing bundled Playwright dependency through a
process-local `NODE_PATH` pointing at the Codex runtime's Node packages. No
package installation or change to player saves was required. There is no Git
repository in this workspace, so these are local file changes rather than a
commit or pull request. Effect Dispatch Round 2 remains the next separate round.
