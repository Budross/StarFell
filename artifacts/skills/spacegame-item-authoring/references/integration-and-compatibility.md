# Integration, saved progress, and verification

Read sections relevant to the requested content. The behavior below is a 2026-09-20 baseline; use current project guides, handlers, and tests when it changes.

## Source routing

| Concern | Read in the active game workspace |
| --- | --- |
| Local acquisition and access | `LOCATION_AUTHORING.md`, `js/locationContent.js`, `js/locations.js` |
| Conditions and UI visibility | `js/conditions.js`, `js/itemActions.js`, `js/craftingDisplay.js` |
| Discovery grants/evidence | `RESEARCH_AUTHORING.md`, `js/research/researchContent.js`, research catalog/engine/state modules |
| Ship equipment or remote access | `SHIP_AUTHORING.md`, `js/ships.js` |
| Explicit dialogue integration | `DIALOGUE_AUTHORING.md`, dialogue content and handlers |
| Saved state and action execution | `js/state.js`, `js/app.js`, `js/playerActions.js` |
| Verification patterns | `tests/crafting.test.mjs`, `tests/locations.test.mjs`, `tests/research.test.mjs`, `tests/ships.test.mjs`, `tests/playerActions.test.mjs`, `tests/terminalTabs.browser.mjs` |

## Location and condition checks

- Gathering needs explicit assignment at the intended location and player ownership. A `conditions.locations` filter does not assign it. Include necessary supporting assignments for an authorized new item.
- Crafting/equipment collections expand generated actions at startup. Review inherited collections and `removeActions`; a shared type edit affects every location of that type. Prefer an instance edit when only one site should change.
- Inventory, capacities, installed equipment, and installation limits are local. Knowledge/global flags are shared. Crafting selections do not grant ownership; passenger access does not permit management of private assets.
- All recipes inherit `definitions.recipeCapabilities`, currently `fabrication`, in addition to their own requirements. An empty recipe-specific capability list does not remove the common requirement.
- Equipment/capability checks require enabled, nonempty, positive-health local groups. Facilities elsewhere do not count. Essential fabrication/research should not depend on equipment that requires its own locked output to construct.
- Recipe-list visibility deliberately removes top-level equipment/capability requirements, while execution still enforces them. Nesting those conditions can change visibility. Verify intended locked/hidden presentation rather than assuming all equivalent condition shapes display identically.
- Shared condition validation accepts some operators whose runtime needs additional context. Item calls do not supply dialogue completion callbacks or a current speaker; do not use `completed` or `npcFlags.speaker` merely because validation passes. Verify advanced conditions in the actual item caller. Explicit NPC/location flags can be suitable when their producers and references exist.
- Action IDs are globally unique. Labels, aliases, IDs, and shortcuts also conflict after normalization at an effective location. Visibility conditions alone do not excuse an assignment-level collision. Check the full action set, including location, ship, dialogue, and research actions. Preserve shortcuts 1-3.
- Verify travel as part of a remote-only acquisition path. At the baseline there is no production starter ship; a mapped destination is not evidence that the player can reach or manage it. Recheck current ship content rather than silently granting transport or ownership.

## Research and unlock checks

- Every discovery/flag condition needs a reachable producer. Search authored research, dialogue effects, inspections, and operations as applicable. Mentioning a discovery ID does not grant it, and composition may accept externally referenced IDs without proving a producer exists.
- Reuse an existing discovery when it matches the request. New research is supporting content when necessary for the requested item; clarify intended progression if unclear. Do not auto-grant knowledge to conceal a missing route.
- Essential unlocks need enough reachable baseline evidence without luck. Include repetition discounts, finite evidence budgets, method access, sample consumption, equipment requirements, and prerequisites. Structural catalog warnings cannot prove the complete route works.
- Detect circular routes: a locked component needed to research itself, an instrument requiring discoveries only that instrument can earn, and recovery requiring unavailable power. Preserve the opening's depleted-reserve recovery route.
- New tags can satisfy existing evidence and affinity rules. Review those effects alongside recipe role matches; tags can have broader consequences than their item description suggests.
- Stored products can be research samples despite being excluded from crafting ingredients. Installed equipment is not a sample. Do not promise immunity from research consumption via an unsupported field.
- If adding a discovery, follow `RESEARCH_AUTHORING.md` for rules, variants, hints, and compatibility. Keep optional narrative additions out of scope unless requested or needed by the chosen grant route.

## Existing-save checks

- Capture or construct a representative pre-change state before editing when compatibility is at issue. A state generated only from the new catalog cannot prove old-save reconciliation works.
- New item IDs and installed groups receive zero quantities at existing locations. Changes to starting grants do not refill existing sites. New locations receive their authored initial assets; do not confuse these cases.
- Preserve stable IDs and references. Inspect affected inventory, selected recipes/ingredients, installation groups, upgrades, discoveries, and relevant dialogue/research references before renaming, removing, changing category/roles, or reducing capacities.
- Assess whether old valid state becomes invalid or changes meaning; implement an explicit migration when required. Avoid reducing effective capacity below saved holdings without an agreed compatibility path.
- Used research discoveries store mechanical contracts. Changes to thresholds, eligibility, and evidence mechanics can require migration even if IDs remain stable. Additions and retirement must follow the research guide; a replacement contract string alone is not a valid migration.
- Never clear player progress or overwrite malformed saves to make new content load. Use isolated fixtures/browser contexts, not the user's live localStorage.

## Verification and completion

For implemented content, choose meaningful checks proportional to the actual change:

1. Validate authored item definitions and generated actions using existing code. Then validate affected world/action scopes, people/research composition, and state. Follow production composition in `js/app.js`/`js/state.js`; isolated item catalogs can miss assignment, command, and unlock problems.
2. Run the existing unit suite after final content edits: `node --test tests/*.test.mjs`. If needed, use the environment's available Node runtime. Separate pre-existing failures from regressions. Repeat only after fixes or when new evidence warrants it.
3. Exercise the intended player route using real local context and normal action availability/transaction checks. A direct call to a generated action's handler can skip ownership, location assignment, visibility, and saving. Do not treat that shortcut as proof of playability.
4. Cover meaningful new risks: role rounding/aggregated spending, independent unlocks, wrong location or private assets, disabled/damaged equipment, full output storage, installation limits, completion scope, or a new-game/no-luck research path. Reuse existing tests when sufficient; avoid tests that merely repeat authored field values.
5. Reconcile a pre-change save with new content when integration/compatibility is affected, preserving holdings, damage, progress, and valid selections. Distinguish additive behavior from migrations that intentionally change saved meaning.
6. Use isolated browser checks for new UI/command combinations, unusual conditions, long labels, and complex ingredient options. The documented suite is `node --test tests/terminalTabs.browser.mjs` when its dependencies are available. Respect environment permissions when obtaining dependencies. Report unavailable checks accurately.

Design-only requests do not need content mutation or game tests. Update authoring documentation for changed conventions or demonstrated inaccuracies, not to mirror every new item. Report delivered behavior, the player path, assumptions, supporting edits, validation results, and any remaining limitation.
