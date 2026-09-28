# Incremental architecture refactor

Scope: preserve version-six saves, gameplay, quantities, content IDs, messages,
UI behavior and visible-time simulation. Volumetric storage is a separate feature.
No new production content, offline progress, asynchronous actions or event-driven
gameplay mutations are introduced.

## Execution order

1. **Resource and equipment ownership.** Centralize exact cost/reward exchanges,
   cross-store arithmetic, installation/repair/upgrades, operating output and
   passive capacity. Preserve existing formulas and error messages. Verify with
   crafting, storage, ship and location tests.
2. **Explicit local writes and shared queries.** Give local contexts a narrow
   store; use root state explicitly for crafting selection and scoped flags.
   Keep the old actionState shape as a read/legacy compatibility adapter, not a
   production mutation path. Share recipe visibility, transfer eligibility and
   research presentation inputs between mechanics and displays.
3. **Composition and action linking.** Compile locations before linking the full
   action list. Move production world construction out of state validation.
   Support an ordinary additional action family/collection without editing
   location mechanics. Preserve action order and collision checks.
4. **Application runtime and registry lifetime.** Extract the actual action and
   frame transactions, retaining their different save policies. Use an explicit
   action registry instance in the app and inject query APIs into displays.
   Keep compatibility exports for existing consumers. Verify production runtime
   rollback, arrivals, reconciliation, pause/resume and independent registries.
5. **Content integration.** Replace research's untyped recursive discovery scan
   with explicit condition/effect reference summaries. Keep legacy external IDs
   accepted; distinguish required IDs from external grant routes. Move opening
   messages to authored location data without changing text or startup order.
6. **Verification and documentation.** Run unit and isolated browser suites,
   check the import graph, document extension points and remaining compatibility
   adapters, and update this plan with results.

## Compatibility gates

- Baseline: 96 unit tests pass before edits.
- Full-output rejection spends nothing; passive power still clips independently.
- Storage bonuses depend on installed count, not health/enabled state.
- Installation preserves weighted health; propulsion is snapshotted at departure.
- Action execution clones, rechecks, reconciles, validates, saves, then commits.
- Ordinary frames need not save; arrivals/contact closure save immediately and
  other frames save after five active seconds. Failed saves pause simulation.
- Hidden time, opening progression, command echo/result order, focus, selection,
  transcript, privacy and tab behavior remain unchanged.
- Migration keeps its explicit historical mappings and all supported versions.

## Deliberately separate work

Storage quantities/capacities/version seven, strict new discovery-reference
rejection, generalized effect handlers, timed jobs/reservations, new gameplay
systems, and removal of public compatibility APIs are not part of this refactor.

## Results

Completed all six stages. No save-version or quantity conversion was made.

- Centralized resource exchanges/cross-store arithmetic and equipment behavior.
- Production writes use explicit stores and root owner operations; retained the
  documented read/legacy actionState adapter.
- Added complete action linking and explicit application composition.
- Extracted the actual production action/frame runtime and instance registries.
- Shared recipe/transfer/research presentation queries, compiler discovery
  summaries, and authored opening notices.
- Added ARCHITECTURE.md and updated README.md with extension guidance.

Verification: 109 unit tests (96 existing plus 13 new integration tests) and all
30 isolated browser checks pass. Static production imports have no cycles.
The added browser check loads a new collection from production location content
before startup validation. State operations live in stateCore.js so app startup
does not eagerly evaluate legacy defaults; those defaults reuse bootstrap.
The browser test that called the former singleton now calls app.executeAction
and verifies the actual exhausted-research rejection rather than swallowing any
error. Existing behavioral assertions remain intact.

Retained by design: public compatibility exports, the terminal-only message bus,
read-only condition projections, and the solar instrument's presentation query.
Strict discovery-reference rejection is not enabled; prerequisite diagnostics
now distinguish references from external grants.
