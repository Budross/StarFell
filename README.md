# Habitat 05 — Operations Terminal

A vanilla JavaScript game with an industrial console, a shared content catalog,
and synchronous, saved player actions.

## Run

Run a static HTTP server from this directory and open its local address. If Python
is installed, double-click `start-game.cmd` or run `python -m http.server 8000`,
then open `http://localhost:8000/`. No build step or package installation is needed.

Progress is stored in browser localStorage for that address. Changing the port or
hostname uses a different browser save. Simulation advances only while the page
is visible; closing, reloading, or hiding the page grants no offline progress.
Version-one through version-eight saves migrate automatically to version nine. Older identity/storage migrations run first; v8 identities, counters, assets and history survive while Processing initializes empty. Excess cargo is preserved as overload. Older saves retain their previously available fabrication knowledge. An incompatible or malformed save stops
startup without replacing the stored save.

The [save-version policy](ARCHITECTURE.md#save-version-policy) treats versions as
migration boundaries: neutral additive defaults can reconcile within a version,
while changes to authoritative saved meanings require explicit migration. The
[Structured World Ledger implementation](WORLD_LEDGER_IMPLEMENTATION_PLAN.md) applies
this policy to persistent recent history. Existing v8 saves receive an empty ledger
when the field is absent; malformed present history still stops startup.

## Play

A new game opens with three narrative entries in Operations. The **Tour terminal**
button highlights each major tab and can be closed or replayed at any time;
the tour changes only the interface.

1. Inspect the damaged structural fitting in Operations and salvage 0.01 m³ of metal scrap with [1].
2. Open **Research**, select metal scrap, and run a bench experiment to discover structural fabrication. Basic experiments need no power.
3. Salvage another eight times (0.08 m³), refine twice with [2], and repair the starting solar array with [3].
4. Experiment with electronic salvage, metal, and minerals. Follow the Research hints or ask Mira for optional bench advice.
5. Discoveries make additional recipes available in **Workshop**. Select recipes in Fabrication & Assembly, review ingredients, and fabricate
   components or assemble a solar panel and radio antenna.
6. Install finished products using their generated directives. Panels increase
   power generation; the first antenna enables a one-time local signal scan.

Crafting is immediate. The complete final cargo must fit, accounting for space
freed by ingredients; existing overload may be reduced without first fitting.
Standard ingredients remain selected until the player chooses an
approved substitute. All three item categories appear in the storage display.

Type `look` or `observe` for a current narrative description. Equipment inspection appears among Available Directives when admitted current facts show damaged/disabled equipment, limited or blocked work, or finished output awaiting delivery. Click the choice or type its displayed name; the description appears in the narrative stream without changing or saving gameplay. Meaningful committed local Processing/resource transitions append short updates automatically without switching your tab; the Operations dot marks unread observations. Explicit observations can repeat and reveal the new receipt. Existing entries retain what was true when presented. See [Narrative authoring and integration](NARRATIVE_AUTHORING.md) for the read-only fact pipeline and deterministic wording.

Workshop also shows installed industrial machines at your occupied site or ship.
Assemble/install a mineral extractor or thermal processor after learning structural
fabrication and electrical conduction. The extractor obtains finite surface minerals;
photovoltaic fabrication unlocks a timed thermal batch producing two solar cells
from 0.04 m³ minerals and one electronic part. Existing immediate crafting remains.
Review the loaded-material commitment before starting. A finished batch stays in
the machine's output buffer until cargo has room, keeping the machine occupied.
Abort loses the loaded or finished batch. Your own run requires current facility
access to abort; equipment managers can abort any host run. See
[Processing authoring](PROCESSING_AUTHORING.md) for quantities and integration.

Workshop shows shared cargo use in m³. Raw materials use volume; components and
stored products use whole counts with packed volumes. Power has its own capacity.
Transfers accept m³ for raw resources. To remove unwanted cargo, choose an item
and amount under **Discard cargo**, review the removal, then explicitly confirm.
Discard is permanent and removes nothing automatically from an overloaded save.

The command line accepts action names, IDs, aliases, and fixed shortcuts. `craft`
executes the selected recipe. Shortcuts 1–3 are stable even after repair disappears.
Type `research` or use the Research tab to select one to three distinct samples. Informative experiments always advance research; chance can add insight. Equivalent experiments share diminishing returns, and exhausted setups spend nothing. The journal retains the newest 100 attempts; earned knowledge and evidence credits persist independently.

The **Shipyard** tab builds modular crewed ships and autonomous prospectors from
fabricated or recovered module Products on a 1 m grid. Place a core and connected
attachments; the preview shows dimensions, dry mass, storage, power, warnings and
the final stock bill. Assembly consumes one Structural Frame per module and two
power, creates an empty privately owned ship at Habitat's berth, and records one
construction event. Load fuel cartridges, allow the reserve to charge, then use
**Locations → Drones** for drone navigation, one mining batch, tank
service and exact-berth cargo transfer. Local commands work at the same berth;
remote commands require operational radio at both ends. The new off-site mineral
deposits lead to improved modules and a crewed core. See
[Modular vessel authoring](VESSEL_AUTHORING.md) and the
[implementation plan](MODULAR_VESSEL_SHIPYARD_IMPLEMENTATION_PLAN.md).

Open **Locations** to browse the area network. Legacy travel requires a ship: board at
its docking site, undock, travel to an adjacent area if needed, approach and dock,
then disembark. Journeys consume ship power and take visible play time based on
distance and propulsion. Browsing never moves the player. Reload preserves saved
journey progress, with no offline advancement. Areas connect by 2D distance.

Permitted boarding of unowned ships is free and allows passenger navigation;
inventory, equipment, crafting, and transfers require their specific permissions;
ownership supplies the default controller when none is appointed. The Shipyard
provides the production construction route. Local habitat play and same-area
transfers with the owned supply platform remain available. See
[SHIP_AUTHORING.md](SHIP_AUTHORING.md) for legacy authored ships.

Open **People** (or type `talk` / `people`) to inspect and talk to NPCs at your
occupied site or ship. Mira and Oren begin at Habitat 05. Oren's request can be
completed by inspecting the unfinished collectors in Operations; Mira's relay
investigation requires travel after building a crewed ship. Choices have saved
consequences. Conversations survive tab changes and can be resumed after reload;
ship arrivals do not interrupt them. NPC cargo remains private and item exchanges
are not implemented.

The CRT opens on **Operations**, containing the session log and available directives.
**Workshop** contains Material Storage and Fabrication & Assembly. The command line
and latest result remain available across tabs; power instruments stay in the bay.
Click a tab or use Left/Right and Home/End while a tab button is focused. Switching
preserves selections and scroll position, and simulation continues across tabs.
Reloading returns to Operations without changing your saved crafting selection.

## Add content

**Add an entry to `definitions.items` in `js/content.js`.** That entry can contain
acquisition methods, recipes, ingredient-role approvals, installation, operations,
and upgrades. Supported interactions, storage, actions, and UI entries are derived.
See [CONTENT_AUTHORING.md](CONTENT_AUTHORING.md) for item fields and examples.
Add locations in one entry in `js/locationContent.js`; see
[LOCATION_AUTHORING.md](LOCATION_AUTHORING.md) for templates, positions, local assets,
and action assignments. Ships use the same catalog and add docking, propulsion,
and journey settings; see [SHIP_AUTHORING.md](SHIP_AUTHORING.md).
Add NPCs in `js/npcContent.js` and groups/conversations in `js/dialogueContent.js`.
See [NPC_AUTHORING.md](NPC_AUTHORING.md) and [DIALOGUE_AUTHORING.md](DIALOGUE_AUTHORING.md)
for examples, conditions, effects, and save-compatible editing rules.
Add research discoveries, evidence routes, hints, and methods in `js/research/researchContent.js`.
See [RESEARCH_AUTHORING.md](RESEARCH_AUTHORING.md) for a copyable shielding example, the opening route table, and save-compatible editing rules.

The existing `iron` ID now displays as iron structural parts, preserving old saves.
Power remains a utility. Resources cannot be recipe outputs; components use
resources/components; products use components only.

## Module boundaries

- `content.js`: the authored item catalog, utility definitions, and starting equipment.
- `itemCatalog.js`: catalog validation, derived storage/recipe/infrastructure indexes,
  ingredient matching, and a compatibility export for shared condition checks.
- `resources.js`: checked, atomic inventory exchanges and transfers; separate clamped utility production.
- `quantities.js` / `storage.js`: exact bulk conversion, unit formatting, shared cargo volume and admission.
- `cargoActions.js` / `cargoDisplay.js`: explicit current-store discard with review and confirmation.
- `storageMigration.js`: frozen legacy capacities and quantity conversions.
- `equipment.js`: installed-state mutations, operating power/propulsion, capabilities, and passive capacity.
- `crafting.js`: ingredient options, shared recipe visibility, exact previews, execution, and saved selection.
- `itemActions.js`: generates ordinary action definitions from the catalog.
- `playerActions.js`: explicitly created action registries, command resolution, live requirements,
  and execution entry point. `getActions(group)` optionally filters display groups.
- `locationContent.js`: authored location types, areas, sites, actions, and starting assets.
- `locations.js`: catalog validation, local contexts, distance links, scenes, and transfers.
- `ships.js`: boarding, docking, timed navigation, journey validation, and ship map views.
- `locationDisplay.js`: canvas navigation, destination details, and transfer controls.
- `bootstrap.js`: explicit system composition and complete action linking.
- `simulationRegistry.js`: generic synchronous execution of explicitly ordered simulation steps.
- `stateComposition.js` / `stateLifecycleRegistry.js`: one default current-state manifest and generic fresh-slice initialization, validation, and reconciliation.
- `worldLedger.js` / `worldLedgerTypes.js`: bounded structured history, strict append validation, tolerant historical content IDs, and detached queries.
- `worldOperations.js`: semantic gameplay creation, lifecycle, relocation, and resource transfers with one recording owner.
- `worldLedgerSimulation.js`: automatic save requests for composed steps that append history.
- `entityState.js`: runtime entity/state consistency and current authored-instance repair.
- `worldCatalog.js`: default-world compatibility construction for standalone consumers.
- `stateCore.js` / `stateV7.js`: initial assembly, root/version checks, composed current validation/reconciliation, and frozen historical migration.
- `entities.js`, `entityQueries.js`, `entityCreation.js`, `entityLifecycle.js`: persistent identity, runtime instances, and safe lifecycle transitions.
- `authority.js`: title ownership, operational control, and named permissions.
- `entityReferences.js` / `entityComposition.js`: typed references collected by their owning domains.
- `state.js`: default-argument compatibility for standalone callers.
- `conditions.js`: independent condition syntax, validation, and read-only evaluation.
- `conditionContext.js`: explicit runtime equipment/capability query adapter; missing dependencies throw.
- `conditionReferences.js`: traversal of condition-owned entity/discovery references.
- `effects.js`: eight immutable descriptors for flags, discovery, relocation, grants, spawning, and lifecycle transitions;
  item/dialogue/research/inspection effects execute in authored order through narrowly composed services.
- `entityCreationSpec.js`: pure creation-spec validation shared by content compilation and trusted runtime creation.
- `npcs.js` / `npcContent.js`: NPC definitions, presence, inventory, and relocation.
- `dialogue.js` / `dialogueContent.js`: groups, topics, branches, effects, history, and session recovery.
- `peopleSystem.js`: composes NPC/dialogue catalogs with explicit location context.
- `knowledge.js` / `flags.js`: shared idempotent discovery grants and explicit scoped flag writes.
- `research/`: authored research, catalog validation, detached context, pure seeded resolution, saved evidence/journal state, managed actions, and the Research tab.
- `dialogueActions.js` / `dialogueDisplay.js`: saved interactions and the responsive People tab.
- `game.js`: visible-time production at all locations and the current local power view.
- `save.js`: synchronous localStorage persistence.
- `playerActionsDisplay.js`: directive buttons and command help.
- `craftingDisplay.js`: inventory, recipe selection, ingredients, and crafting controls.
- `terminalTabs.js`: tab registration, visibility, keyboard navigation, and focus.
- `runtime.js`: action/frame transactions and simulation save/pause policy, using supplied simulation/validation capabilities.
- `app.js`: initialization, browser clock/visibility, DOM wiring, rendering, and committed result presentation.
- `eventBus.js` / `consoleDisplay.js`: terminal messages and the session log.

`habitatActions.js` has been removed; its definitions now live in the catalog.
The power-flow widget remains in `widgetDEMO/power-flow-widget.js` and samples the
existing simulation clock. The terminal session log and graph are not persisted.

Shared effect dispatch supports item operations, dialogue choices, first experimental
research completion, and one-time location/scene inspections. Completion remains
independent of rewards. Spawn descriptors use reusable definitions and the existing
persistent identity allocator; activation preserves assets and checks lifecycle
blockers. Any effect failure rolls back the entire action, including costs, RNG,
new IDs, and completion. Version-eight saves remain compatible; legacy empty
research reward contracts normalize safely. Changes to rewards on used research
progress require an explicit migration. Generic discovery, reload, and reconciliation
never replay experimental rewards. Result bindings and automatic event hooks remain deferred.

The world ledger stores facts about journeys, direct transfers, entity transitions,
NPC relocation, research completion, and equipment repairs. It retains the newest
200 records provisionally, using stable entity IDs and canonical quantities rather
than generated prose. Historical content IDs may survive catalog changes; retained
entity references remain valid through retirement or destruction. All facts belong
to the same action/frame candidate and roll back with failed validation or saving.
Power and progress ticks produce no history. The terminal bus remains independent.
See [the architecture guide](ARCHITECTURE.md#structured-world-ledger) for mutation
ownership, silent physical movements, queries, and future system integration.

## Add a terminal tab

Create a panel directly inside `#terminal-panels` (initially `hidden`), initialize
its feature display once, and register it with the `tabs` controller in `app.js`:

```js
tabs.registerTab({
  id: "research",
  label: "Research",
  panel: document.querySelector("#research-panel")
});
```

This is the pattern used by the implemented Research tab. For another tab, use a unique lowercase
ID containing letters, numbers, or hyphens, starting with a letter. Tabs appear in
registration order. The controller creates the linked tab button and accessibility
attributes. Keep panels mounted and let their feature display manage content and
game-state rendering through the normal render loop.

Optional `onDeactivate` and `onActivate` callbacks run before hiding and after
showing a panel, respectively, for presentation tasks such as log scroll handling.
Use `tabs.activateTab(id)` for navigation and `tabs.getActiveTabId()` to inspect the
selection. Navigation does not execute an action or save game state. No changes to
`terminalTabs.js` or `craftingDisplay.js` are needed to add a system's panel.

## Custom actions and mechanics

Production feature modules supply actions in `bootstrap.js`; `buildGameSystems({ createAdditionalActions })` also supports custom compositions. The app registers the complete batch on its own action registry. The standalone `registerAction` API remains for compatibility. Definitions require a stable `id`,
`name`, and synchronous `execute(state, context, payload)`. Optional fields are `description`,
`aliases`, `shortcut`, `order`, `group`, `visible(state, context)`, and `requirement(state, context, payload)`.
Local actions must be assigned through location content; intentionally global
actions declare `scope: "global"`. See the location guide for access policies.
Visibility checks return booleans; requirements return an unmet-requirement string
or an empty string. Both must be read-only.

`runtime.js` copies state, runs the action, reconciles contact, validates and saves the copy, then replaces
current state. Failed execution, validation, or saving leaves current state intact.
Keep effects in the supplied candidate; use `context.store` for local resource operations and owner functions for equipment, flags, knowledge and crafting selection. Treat `context.actionState` as a read/legacy projection; replacing its properties does not replace root state. External effects cannot be rolled back.
The registry is independent of the event bus. Selection actions use the same
transaction but are omitted from the terminal log and main directive list.

New items using existing behavior need catalog changes only. A new kind of game
mechanic needs a reusable handler and validation before items can configure it.
Timed crafting, continuous material-processing machines, trade, and timed research jobs
remain future systems, not implied by tags or unused metadata.

See [ENTITY_AUTHORING.md](ENTITY_AUTHORING.md) for runtime creation, lifecycle, authority, and definition/instance boundaries. The implementation scope is recorded in [ENTITY_REGISTRY_IMPLEMENTATION_PLAN.md](ENTITY_REGISTRY_IMPLEMENTATION_PLAN.md).

See [ARCHITECTURE.md](ARCHITECTURE.md) for system ownership, new action collections, runtime integration, and the boundary for future volumetric storage. The completed migration plan is [ARCHITECTURE_REFACTOR_PLAN.md](ARCHITECTURE_REFACTOR_PLAN.md).

Timed systems join the ordered composition in bootstrap; persistent validation
and reconciliation join the single default manifest in `stateComposition.js`.
Optional `composeSimulationSteps`/`composeStateDomains` hooks run only during game
construction and return complete ordered lists. Use the composed `stateServices`
for custom startup/load/validation; no dynamic registration or save-version
change is introduced. See [the registry implementation plan](SIMULATION_STATE_REGISTRIES_IMPLEMENTATION_PLAN.md).

## Verification

Run `node --test tests/*.test.mjs`.

The tests cover local ownership, distance-based area routes, timed ship journeys,
passenger access, docking, independent assets,
transfers, per-location completion, migration, and category rules, substitutions, ratios, recipe contributions,
product operations and upgrades, storage limits, save migration, transaction
rollback, stable commands, and the complete production loop. Test-only catalog
entries prove new supported content needs no engine or UI registration changes.

With Playwright available to Node, run `node --test tests/terminalTabs.browser.mjs`
for the browser checks. On Windows this uses installed Chrome; elsewhere it uses
Playwright's Chromium. These checks launch a temporary local server and isolated
browser contexts, leaving player saves untouched. They cover keyboard/focus behavior,
crafting across tab switches, log scroll restoration, a third registered panel,
responsive layouts, and malformed-save feedback. They also cover map browsing,
zoom transitions, touch and keyboard alternatives, local travel, transfers, saved
location restoration, hidden-page journey pausing, private passenger asset views,
and failed-departure/arrival presentation. Ship tests inject test-only content;
they do not add a production starter ship. Set `TERMINAL_SCREENSHOTS` to an
output directory to capture desktop and mobile screenshots during the checks.
NPC/dialogue checks cover shared-group history, requests, flag scopes, atomic
effects, stale replies, presence, relocation farewells, content updates,
mobile/keyboard interaction, save failures, long text, and ship arrivals during
conversation. These tests also use isolated saves.

Research checks cover seeded chance, guaranteed baseline routes, simultaneous insight,
equivalent-material repetition, equipment variants, private local assets, failed-save
rollback, old-save migration, additive content updates, and bounded journal history.
Browser checks also cover the Research tab, costs, hidden discovery information,
optional dialogue clues, mobile controls, and long-journal scrolling. The suites also cover generated instances, authority grants, lifecycle blockers, retained history, save migration, runtime rollback, and browser integration.
