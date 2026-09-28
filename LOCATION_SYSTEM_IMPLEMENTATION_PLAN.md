# Location system — implementation plan

Status: implemented, including section 18 UI revisions and the confirmed
connection rules in section 19. See LOCATION_AUTHORING.md for the implemented schema.

Ship update: direct player travel and occupiable areas described below are now
superseded by [SHIP_SYSTEM_IMPLEMENTATION_PLAN.md](SHIP_SYSTEM_IMPLEMENTATION_PLAN.md).
Use [SHIP_AUTHORING.md](SHIP_AUTHORING.md) for implemented timed ship travel,
docking, passenger access, and version-four saves. The original location plan is
retained below as historical context.

This plan consolidates the location, ownership, local assets, scene, and future ship-system discussion. Infrastructure transfer is explicitly deferred. Recommended defaults that were not individually settled in the discussion are identified in section 3.

## 1. Goal and world framing

Create a simple, extensible location system whose content is authored as objects, following the approach used by `js/content.js`. Locations supply information, scenes, and references to reusable player actions. Types select templates to reduce repeated definitions.

The player starts in an owned habitat within a partially constructed, decaying Dyson swarm around a star. The habitat is one installation among many. Exploration and discoveries will gradually reveal what happened to the swarm. This is the setting for authored content, not a requirement to implement orbital mechanics or a complete world simulation.

The system presents each location in two ways:

1. **Viewed from elsewhere:** show the location's known information and whether it can be reached or entered.
2. **Occupied by the player:** show its local scene and the actions supplied by that location, subject to live requirements and access rules.

Viewing information does not move the player. Travel is an ordinary saved player action. Transfers, inspections, crafting, and future NPC interactions continue through the existing player-action execution path.

## 2. Agreed requirements

- Define locations and types using straightforward authored objects.
- Define an action once and assign it to multiple locations by stable ID.
- Preserve the current action model: descriptions, visibility, requirements, buttons, names, aliases, shortcuts, and synchronous execution.
- Give each location its own inventory, infrastructure, stored power, capacities, and local progress.
- Make crafting depend on accessible, operational infrastructure at the player's current location.
- Track ownership separately from player presence and spatial position.
- Start with the habitat owned by the player.
- Support item and stored-power transfers between eligible player-owned locations.
- Support transfers between owned ships in the same overall area.
- Allow scene entries to reference visitable stations, asteroids, habitats, and ships, as well as ordinary descriptive objects.
- Prepare the shared location model for a later ship subsystem and future NPC and Event systems.
- Keep changes to existing systems limited to the changes necessary for these requirements.

### Explicitly outside this implementation

- Infrastructure transfer, splitting equipment groups, and merging installed equipment.
- Ship propulsion, piloting, docking simulation, fuel consumption, or ship construction.
- Timed travel, orbital mechanics, procedural generation, and a galaxy map.
- NPC behavior, dialogue, factions, and a gameplay Event engine.
- Ownership acquisition, conquest, trade, and diplomatic permissions.
- Automatic pooling of inventories or power networks.
- Player-carried inventory, expedition cargo routing, and automatic looting into nearby ships.
- Offline simulation, timed crafting, and a replacement for the current save transaction.

Ownership fields and location references provide extension points; omitted systems do not need placeholder engines or unused callback frameworks.

## 3. Recommended initial defaults

These defaults make the first implementation concrete. They are planning assumptions rather than separately confirmed gameplay decisions.

| Question | Recommended first-version behavior |
| --- | --- |
| Transfer range | Both locations must share the same immediate area. Apply this to habitat-to-ship and ship-to-ship transfers alike. |
| Transfer access | The player's current location must be one endpoint; the other endpoint must be another eligible owned location. Support sending and receiving. |
| Transfer cost and timing | Immediate, lossless item and stored-power transfers, with no additional energy fee or transport simulation. |
| Travel timing | Immediate travel along explicitly authored connections. |
| Remote simulation | All initialized locations advance power during visible-page simulation, using the same elapsed time. Preserve the existing no-offline-progress rule. |
| Unowned facilities | Presence alone does not grant inventory management, installation, crafting, or transfers. Explicit exploration actions can still be available. |
| Unowned gathering rewards | Do not invent a cargo destination. Initial unowned examples offer inspection/discovery interactions; reward-bearing expedition gathering is deferred until its destination rule is designed. |
| Crafting selection | Keep the current player-level recipe/ingredient selection; recheck it against the current location after travel. It does not reserve or move materials. |

The user can revise these defaults before implementation without changing the core ownership or location architecture.

## 4. World structure and identity

### Areas and local locations

Use one location catalog for both areas and individual sites. A type identifies the role of a definition; there is no separate area engine.

- The world setting is the Dyson swarm.
- An area, such as the Habitat 05 vicinity, groups nearby sites.
- A site, such as the habitat, an asteroid, a platform, or a ship, belongs to one immediate area.
- A site may contain ordinary scene objects in addition to references to other locations.

For the first version, use a shallow area/site structure. Avoid arbitrary recursive containment, rooms with inherited inventories, and nested access rules until required.

Three values must remain independent:

| Value | Meaning |
| --- | --- |
| Location ID | Persistent identity of a habitat, area, ship, or other site |
| Current player location ID | Where the player is presently acting |
| Site's area ID | Which area contains the site |

Ownership is a fourth independent value. A ship moving later changes its area, not its identity, owner, equipment, or inventory. A player aboard it can remain at the same location ID throughout that movement.

### Scene references and travel connections

Scene entries reference location IDs rather than embedding duplicate location definitions. The referred location provides its remote name and description. Decorative or inspectable objects use IDs local to their owning location.

Containment, visibility, and reachability are separate:

- Area membership establishes proximity.
- Scene/discovery conditions determine what information is shown.
- Explicit connections determine initial travel routes.
- Travel requirements determine whether a visible route can currently be used.

Do not allow travel to every catalog entry or infer permission merely because a location appears in a scene. Validate referenced locations and route targets at startup. A scene reference must not show a ship as present in an area that differs from its saved position.

The first examples should have an obvious return route. Instant travel does not require a third, in-transit player state.

## 5. Authored definitions and template rules

Add `js/locationContent.js` as the authoritative source for location types and location definitions. Keep item definitions and recipes in `js/content.js`.

### Location fields

| Field | Responsibility |
| --- | --- |
| Stable ID | Object key; used by saves and cross-references |
| `name` | Player-facing identity |
| `type` | Selects a single template |
| `remoteDescription` | Information available while elsewhere |
| `description` | Scene description at the location |
| `areaId` | Initial containing area for a site |
| `initialOwnerId` | Starting owner; player or no player ownership |
| `actions` | References to reusable action IDs |
| `actionSets` | Optional references to a small number of predefined action collections |
| `sceneObjects` | Local descriptive objects and references to other locations |
| `connections` | Explicit outgoing travel destinations and supported requirements |
| `conditions` | Supported discovery/access conditions, with visibility separate from travel eligibility |
| `initialResources` | Initial local item quantities and stored power |
| `initialInfrastructure` | Initial installed quantities, condition, enabled state, and upgrades |
| `capacities` | Optional local overrides of catalog storage defaults, including power capacity |

Exact exported identifiers may be adjusted during implementation; the responsibilities and boundaries above are the contract.

### Template composition

- One template per location; no template inheritance chains.
- Scalar fields from the location override template defaults.
- Resource and capacity maps combine by ID; explicit zero is meaningful.
- Initial infrastructure entries combine by group ID, with documented field defaults.
- Action IDs and expanded action-set IDs form an ordered union without duplicates.
- Scene entries combine by stable local ID; a location entry replaces a template entry with that ID.
- Provide explicit removal lists for inherited actions and scene entries; do not give `null`, empty lists, or missing fields ambiguous removal semantics.
- Connections should be explicit per location and default to empty; templates should not silently create routes to named sites.
- Instantiate independent saved state for each location. Never share mutable template inventories or equipment objects.

### Action collections without another action engine

Individual action references are the default. Two bounded collections, such as `crafting` and `equipment`, may expand the existing generated action definitions so adding a supported product does not require manually listing its installation action in every owned-location template.

The item-action generator identifies collection members from behavior it already generates. Collections only expand to ordinary action IDs at startup; they do not execute anything or bypass local checks. Gathering actions remain explicitly assigned because their presence describes the location's available resources.

Do not introduce a general query language, dynamic plugin registration, or arbitrary template scripts.

## 6. New location module and supporting files

The feature consists of one gameplay module and two small supporting modules. Do not split the first version into separate ownership, transfer, travel, scene, and location-state engines.

### `js/locations.js` — core location module

Owns:

- Building and validating the location catalog from templates and definitions.
- Resolving current and explicitly named locations.
- Constructing independent initial local state.
- Resolving effective action assignments, including collection expansion.
- Producing read-only local and remote location views.
- Checking player ownership and same-area relationships.
- Checking travel and transfer requirements.
- Applying travel and item/power transfers to the transaction's candidate state.
- Returning ordinary action definitions for travel, scene inspection, and transfer controls.

Suggested interface responsibilities:

| Operation | Contract |
| --- | --- |
| Build catalog | Accept authored definitions and known content/action references; return normalized definitions or descriptive errors |
| Create location states | Instantiate initial values without copying habitat assets into every site |
| Get location context | Return definition, saved local state, location ID, and access information for a specified location |
| Get current context | Resolve context using the player's saved current location |
| Get assigned action IDs | Return effective, deduplicated action IDs for a location |
| Get scene/destination views | Return display data without mutating game state |
| Check travel | Return an unmet-requirement reason or success for a specific route |
| Apply travel | Recheck the route, change current location, and return result text |
| Check transfer | Validate source, destination, asset, quantity, ownership, proximity, and capacity |
| Apply transfer | Recheck and move the full requested quantity inside one transaction |
| Create location actions | Return definitions compatible with the existing player-action registry |

This module must not import the DOM, call localStorage, own a timer, publish game-state effects through the message bus, or directly replace the current state. It receives its dependencies and acts on supplied state.

Resource helpers should continue accepting an object with a `resources` map. Pass the selected location's local state to them rather than making resource arithmetic discover the player's current location implicitly.

### `js/locationContent.js` — authored content

Owns type templates, initial locations, their action assignments, scenes, connections, starting ownership, and starting assets. It contains no DOM or save logic.

Location action behaviors that are unique to the feature can initially live with the action builders in `locations.js`. Existing item behaviors remain with `itemActions.js`; do not copy them into location content.

### `js/locationDisplay.js` — presentation

Owns:

- The current location's identity, ownership indication, and local scene.
- Browsing known destinations and displaying remote information.
- Controls that invoke registered travel/inspection actions.
- An owned-location transfer form with endpoint, item/power, amount, and validation feedback.
- Display-only browsing and draft selections that are not world state.

Reuse the existing terminal layout. Add a compact current-location/scene section to Operations and register a Locations panel for destination browsing and transfers. Keep the current directives renderer and Workshop panel.

Presentation only chooses actions and renders results. It must never debit inventory, alter ownership, or move the player directly.

## 7. Saved state and migration

Retain one root game state and one localStorage save. Increment the save version from 2 to 3.

### Root state

- Save version and simulation clock.
- Current player location ID.
- Player knowledge/discoveries and global story flags.
- Existing crafting selection.
- A map of location states keyed by stable location ID.

### Each saved location

- Owner ID.
- Current area ID for sites.
- Local `resources` map, including stored power.
- Local `infrastructure` map using the existing aggregate equipment-group representation.
- Local flags for persistent scene/action progress.

Effective capacities are derived from item/utility defaults plus the location definition's overrides. Do not save copies of static descriptions, actions, templates, or derived power rates. Future capacity upgrades can add saved modifiers when that feature exists.

An area without managed assets can use zero capacities and zero equipment. It must never receive a working solar array or habitat life support merely because those are currently global defaults.

### Migration requirements

1. Accept supported version-one and version-two saves through explicit migration.
2. Preserve resources, infrastructure, equipment damage/upgrades, stored power, simulation time, global flags, discoveries, and crafting selections.
3. Move existing assets into the player-owned habitat exactly once.
4. Preserve the current location when it maps to a defined location. Reject unknown legacy IDs with a clear error unless a specific migration mapping is supplied; do not silently teleport corrupted saves.
5. Initialize additional locations from their own definitions.
6. Introduce only the explicitly required starting fabrication facility so migrated players retain their existing crafting access.
7. Validate the entire result before saving it.

On later content additions, initialize missing location records only. Do not overwrite existing ownership, position, quantities, or equipment with changed starting defaults. Malformed existing records must fail rather than receive a silent reset.

Removing saved locations, renaming IDs, or lowering capacities below saved holdings requires an explicit migration decision. Preserve incompatible saves, following the current startup behavior.

## 8. Reusable player actions and command handling

### One definition, many assignments

Register each action ID once. Assign that ID to multiple locations or templates. Reusing an action does not require repeated registration or namespaced copies of its behavior.

Action inspection and execution receive the current location context in addition to the root state. Extend the existing callbacks with an additive context argument rather than replacing their basic contract. Existing callbacks that only need root state can continue to ignore the additional argument.

Location-aware callbacks use the local inventory and infrastructure. Global discovery checks continue to use root knowledge. Rendering and execution resolve context afresh; do not close over local-state objects that become stale when `app.js` commits a replacement state.

### Availability and access

For ordinary local actions, require all of the following:

1. The current location supplies the action.
2. The action's visibility condition passes.
3. Its ownership/access requirement passes.
4. Its live equipment, resource, capacity, and progression requirements pass.

Keep system/selection actions explicitly distinguished from player-facing local directives. Selecting a recipe does not grant permission to craft it; the craft action always repeats local access and facility checks.

Use a small access policy: managed-asset actions require player ownership; explicitly public scene/exploration actions require presence and their authored conditions. Do not implement a permissions matrix for hypothetical factions.

### Commands

- Action IDs remain globally unique.
- A shared action keeps its name, aliases, and shortcut wherever assigned.
- Different actions may reuse a label or shortcut only where their applicable scopes do not conflict.
- Resolve commands against current assignments plus explicitly global/system actions.
- Reject ambiguity; never execute the first arbitrary match.
- Detect conflicts in effective location action sets at startup where possible, with a runtime ambiguity guard for conditional availability.
- Direct execution by ID repeats assignment/access checks, so a hidden or previously available command cannot act remotely.
- Preserve shortcuts 1–3 for the existing habitat directives. Do not renumber shortcuts when actions become unavailable.

The generated-action batch validator currently also rejects duplicate command strings. Adjust that validation together with the registry so it does not contradict the new scope rules.

### Per-location completion

Keep existing `flags` conditions and the existing radio-signal story outcome global for compatibility. Add an explicit local-flag condition/effect scope for repeatable action definitions with independent completion at different locations.

An action that marks a local console examined must read and write the current location's local flag. It must not disappear at every other location. Existing global discoveries retain their intended world-wide meaning.

## 9. Crafting and local equipment

Retain the current recipe, ingredient-role, substitution, and immediate-crafting models.

- Give recipes an operational facility requirement using the existing equipment/capability condition mechanism.
- Add a defined starting fabrication facility at the habitat and map current recipes to its supported capabilities.
- A ship or other owned site can later gain the same capabilities from its own equipment.
- Check ingredient quantities, utility costs, and complete output capacity against the current location only.
- Installation consumes a locally stored product and updates local infrastructure.
- Repairs and upgrades consume local components and affect local equipment.
- A nearby or remotely owned facility does not satisfy the current location's recipe requirements.
- Check ownership and infrastructure in previews, direct recipe directives, and the generic `craft` command, not just the Workshop button.

The Workshop remains a usable inventory view even where crafting is unavailable. Show the reason for blocked fabrication clearly. Revalidate a retained recipe selection after every location change.

Infrastructure remains aggregate groups with the current health and upgrade semantics. No installed-equipment movement is exposed in this version. An uninstalled product remains an inventory item and can be transferred like other stored items; that is not infrastructure transfer.

## 10. Item and power transfers

The player chooses a source, destination, asset ID, and quantity through a transfer form. One endpoint must be the current location under the initial policy.

Before changing either endpoint, validate:

- Both IDs refer to distinct valid sites.
- The player owns both sites.
- They share a non-null immediate area ID.
- The current location is one endpoint.
- The asset is an allowed stored item or the power utility.
- Quantity is finite and positive; item quantities are whole units, power may be fractional.
- The source has the full requested quantity.
- The destination has capacity for the full requested quantity.

No partial transfer, overflow disposal, automatic capacity increase, or automatic fallback endpoint. Display an explanatory reason when the full request cannot succeed.

Use a small validated payload extension to the existing action execution entry point for transfer submissions. Pass that payload through the same candidate-state transaction. Do not register a new action for every amount, encode quantities into action IDs, mutate world state merely to store a form draft, or create a second save path.

The shared transfer action revalidates its payload on execution. Existing fixed-argument actions can ignore the optional payload. A command without the required transfer selection should show an actionable requirement message; a new free-form command grammar is not needed.

Stored-power transfers conserve energy across the two reserves. Power capacity and generating equipment stay in place. Inventory transfers conserve the total quantity of the selected item. The existing crafting `transfer` helper represents cost/reward exchange within one store; do not confuse it with moving assets between locations. Use a clearly named location-transfer operation.

## 11. Simulation, UI, and transaction integration

### Simulation

Keep the current single visible-page clock. For each frame's elapsed time, advance each initialized location's power using its own equipment and reserve capacity. Increment the world clock once, not once per location.

Do not add timers, background tasks, or offline catch-up. Preserve the existing generation/consumption arithmetic; demand prioritization and automatic machine shutdown are separate features.

### Display behavior

- The instrument bay and Workshop identify and show the current location's assets.
- Replace hardcoded assumptions that every location has the habitat's starting solar array. Hide or adapt the solar-health display when that equipment is absent.
- Label or reset the existing power graph when location changes so samples from different reserves are not presented as one continuous local history.
- Startup narrative describes the saved current location; loading aboard another site must not announce arrival at the habitat.
- Destination browsing never switches the active inventory, changes `locationId`, or saves a journey.
- Travel immediately refreshes directives, equipment, storage, crafting reasons, scene text, and transfer endpoints.
- Use read-only views for unowned local assets; inspection does not expose management controls.
- Preserve focus, keyboard commands, terminal tab behavior, and feedback announcements.

### Transactions

`app.js` remains the single owner of copy → execute → validate → save → commit. Travel and two-location transfers use that exact path. No externally published gameplay effect should occur before a transaction successfully commits.

The existing event bus remains the message/log bus. It is not the future gameplay Event system, and this feature does not turn it into one.

## 12. Necessary changes to existing files

| Existing file | Necessary change | Keep intact |
| --- | --- | --- |
| `js/content.js` | Add starting fabrication equipment/capabilities and recipe facility requirements. Remove habitat-only restrictions from interactions now assigned through locations. Make habitat-specific starting grants explicit in location content rather than universal defaults. | Item identities, categories, recipes, ingredients, and authored item behavior |
| `js/itemCatalog.js` | Evaluate equipment/capability conditions against supplied local context; support explicitly local flags. Continue validating item definitions. Location module validates location references after both catalogs are available. | Catalog compilation, ingredient matching, category and cost rules |
| `js/resources.js` | Accept local state in existing arithmetic; add effective local-capacity lookup where required. | Quantity/payment/receipt algorithms and signatures where practical |
| `js/crafting.js` | Pass current local context into requirements and arithmetic; enforce managed-facility access and use effective capacities rather than direct global defaults. | Preview, ingredient selection, substitution, and atomic cost/output logic |
| `js/itemActions.js` | Operate on supplied local context; declare access requirements and optional collection membership; preserve explicit global outcomes; update command-collision validation. | Existing behavior generators and stable IDs |
| `js/playerActions.js` | Add location eligibility/context to inspection and execution, scoped command resolution, and optional validated action payload forwarding. | Registry, synchronous execution, status shape, and transaction delegation |
| `js/state.js` | Introduce location records, version-three migration, and validation of ownership, positions, capacities, local assets, and references. | Root clock, knowledge, global flags, and fail-without-overwrite behavior |
| `js/game.js` | Advance local power across initialized locations and create views for the current one without assuming a solar array. | Single elapsed-time model and existing power arithmetic |
| `js/app.js` | Assemble catalogs and actions, provide fresh location context, initialize the location display/panel, forward payloads, and refresh local views/narrative. | Main loop, save lifecycle, action rollback, command UI, and tab controller usage |
| `js/craftingDisplay.js` | Render current local inventory/capacities/equipment and access-aware recipe previews. | Existing Workshop controls and stable DOM updates |
| `index.html` | Add current-location scene markup and a Locations panel with transfer controls; make instrument labels adaptable. | Existing console shell, log, command form, and Workshop placement |
| `style.css` | Style the small scene and destination/transfer controls; maintain responsive and focus behavior. | Existing visual direction and layout foundations |
| `tests/playerActions.test.mjs`, `tests/crafting.test.mjs` | Update fixtures/state access and preserve existing behavioral assertions under local ownership. | Production-loop, substitution, rollback, and stable-command coverage |
| `tests/terminalTabs.browser.mjs` | Adjust expected tab count and relevant local-state assumptions; retain tab/focus checks. | Existing browser test setup and save isolation |
| `README.md`, `CONTENT_AUTHORING.md` | Document location-aware behavior, module boundaries, facility rules, migration, and links to location authoring guidance. | Existing item-authoring reference where unchanged |

### Files expected to need no functional change

- `js/save.js`: it already saves one supplied root state as JSON.
- `js/eventBus.js` and `js/consoleDisplay.js`: existing terminal messaging remains sufficient.
- `js/terminalTabs.js`: register the additional panel through its existing API.
- `js/playerActionsDisplay.js`: it already renders registry statuses; central scope checks should make it work unchanged.
- `js/CircularProgress.js` and `widgetDEMO/power-flow-widget.js`: handle location selection/reset at integration level if existing APIs permit; avoid widget redesign.
- Launch scripts and archived/demo-only files unrelated to integration.

Do not refactor these modules for style or introduce a framework, entity-component system, generic rules interpreter, or new persistence service.

## 13. Startup order and dependency boundaries

Use an explicit, acyclic startup sequence:

1. Compile the existing item catalog.
2. Generate the existing item action definitions without registering duplicates.
3. Build location definitions and templates, resolve action collections, and validate cross-references.
4. Build location-owned travel/inspection/transfer action definitions and validate final effective action sets.
5. Load or create state, migrate, and validate against both catalogs.
6. Register all action definitions once and connect the registry to fresh state/context access and `applyAction`.
7. Initialize displays, register panels, render, and start the existing loop.

Pass catalogs into helpers instead of having item content and location content import each other. Resource arithmetic must not import the location runtime. The location core must not import `app.js` or the display modules.

## 14. Implementation phases

### Phase 1 — Definitions and state

- Add location content, the core module, template composition, validation, and state creation.
- Define the starting area and player-owned habitat.
- Implement migration and local-state validation.
- Verify that all existing habitat assets and progress survive migration.

### Phase 2 — Localize existing behavior

- Route resource helpers, item actions, crafting, and conditions through location context.
- Add the starting fabrication facility and recipe requirements.
- Localize power simulation and displays.
- Keep the existing habitat production loop working before adding travel.

### Phase 3 — Reusable assignments and scenes

- Add action assignment checks, command scoping, collection expansion, and local completion flags.
- Add remote/local scene views and explicit travel routes.
- Add the Locations panel while reusing existing tab and directive rendering.

### Phase 4 — Ownership and transfers

- Enforce ownership on asset management and crafting.
- Add item and stored-power transfer checks, payload forwarding, and UI.
- Verify atomic updates to two locations and local eligibility after travel.
- Do not add infrastructure transfer controls or handlers.

### Phase 5 — Examples and verification

- Add representative fixtures/content: habitat, surrounding area, an unowned derelict, and a minimal owned ship-like site.
- The ship-like site proves shared location behavior; it has no propulsion or ship subsystem yet. It can remain test-only until its role in starting gameplay is chosen.
- Test a second owned site in another area to prove transfers cannot cross areas.
- Complete browser checks and authoring documentation.

## 15. Acceptance criteria and tests

### Content and templates

- A second site using supported behavior can be added through definitions alone.
- Two sites can reference the same action without duplicate registration or behavior code.
- Template composition is deterministic, explicit removals work, and local inventories do not share object references.
- Unknown location/type/action/item/equipment references and conflicting effective commands fail clearly.

### Local assets and crafting

- Gathering at two eligible owned locations changes only their respective inventories.
- Installation, repairs, upgrades, and power costs affect only the intended location.
- Stored power and production are independent; the world clock advances only once per tick.
- A powered fabrication facility at another owned site does not enable local crafting.
- Direct crafting commands cannot bypass ownership, facility, material, or capacity checks.
- A location without the starting solar array renders correctly.

### Scene and actions

- Viewing a destination does not travel, spend resources, or change the active store.
- Travel activates the destination scene/actions and deactivates the previous local actions.
- Typing an old action ID, alias, or shortcut cannot execute at an ineligible location.
- Local one-time progress at one site does not complete the same action at another.
- Global discoveries and the existing radio observation retain global semantics.
- Merely entering an unowned location grants no management access.

### Transfers

- Item and power transfers succeed between eligible owned sites in one area.
- Transfers fail for unowned endpoints, different areas, the same source/destination, invalid amounts, insufficient stock, and insufficient receiving capacity.
- Item transfers reject fractional units; power accepts valid fractional amounts.
- Both ownership and proximity are rechecked when executing, not only when displaying choices.
- Total item quantity or energy is conserved across the endpoints.
- Save failure leaves both endpoints and current state unchanged.
- Installed equipment cannot be transferred; uninstalled product inventory remains transferable.

### Saves and UI

- Version-one and version-two saves preserve progress and become a player-owned habitat in version three.
- Adding a new location does not reset existing location state.
- Malformed and unsupported saves remain preserved.
- Reload at another location restores that location and its scene/assets.
- Keyboard focus, commands, tab switching, recipe selection, and responsive layout continue to work.
- Power graph presentation does not silently combine different locations' history.

Add `tests/locations.test.mjs` for core behavior and focused location browser coverage using the existing browser-test approach. Run the existing core suite, the new location suite, and the relevant browser checks. Use isolated browser saves, not the player's live progress.

## 16. Extension boundaries after this implementation

### Ship subsystem

Build ships on location identity, owner, area, inventory, infrastructure, power, and action assignment. Later ship movement changes area membership while occupants remain aboard the same location. Navigation can derive nearby scene entries from current area membership. Add ship-specific requirements and actions without duplicating storage or crafting.

### Infrastructure transfer

Deferred entirely. Before implementing it, decide how aggregate equipment groups preserve health, upgrades, quantity, installation limits, and compatibility when moved or combined. This plan preserves existing equipment state so that later work has a reliable foundation.

### NPCs and Events

Future NPCs can reference a location and supply ordinary actions through an explicit integration. Events can inspect or change local state, reveal destinations, or change ownership through the same validated transaction boundaries. Arrival/departure provide natural points for later event evaluation, but no event scheduling or lifecycle-hook framework is required now.

### Later access and exploration mechanics

Ownership changes, shared facilities, expedition cargo, docking requirements, transfer costs, and salvage permissions can extend the centralized eligibility rules. Keep location identity, ownership, and position separate so those additions do not require rewriting the basic state model.

## 17. Completion definition

The first location implementation is complete when the player can view and visit authored locations, receive their reusable local actions, use only eligible local assets and facilities, and transfer inventory items or stored power between eligible owned sites. Existing habitat progress must migrate safely, the current production loop must remain playable, and the ship subsystem must be able to reuse the location model without a second asset system.

Infrastructure transfer and full ship gameplay are later work, not requirements for completing this phase.


Add this as a new section. It explicitly replaces the earlier proposal for a scene section above the Operations log.

## 18. Revised location UI design

This section supersedes conflicting UI guidance in sections 6, 11, and 12. In particular, do not add a separate current-location scene section above the Operations log. These requirements also apply to the implementation phases and acceptance criteria.

### Current-location identity and appearance

- Replace the static “Habitat 05” header identity with the player’s current location name.
- Update the header only when the player’s actual location changes. Selecting or browsing map nodes must not change it.
- Location types may define a presentation color used to tint the webpage background.
- Keep these colors close to the existing dark background: use slight hue shifts that preserve the industrial console appearance and readable contrast.
- Transition the background subtly on travel, respecting reduced-motion preferences. Preserve the established CRT and instrument styling.
- Treat the color as authored presentation metadata, not saved world state.

### Operations and narrative

Operations remains the sole home for narrative text, including arrival descriptions, exploration text, and narrative action results. Use the existing session log; do not add a separate scene panel.

After a successful travel transaction:

1. Refresh the current-location header and background tint.
2. Refresh local directives, inventory, equipment, power displays, crafting availability, and transfer eligibility.
3. Switch to Operations.
4. Present the destination’s arrival narrative in the session log.

Perform these effects only after the travel transaction successfully commits. Failed travel leaves the player’s location and active tab unchanged and displays the failure through the existing feedback system.

Startup narrative must describe the saved current location. Preserve the existing shared command line and compact action feedback.

### Locations tab and canvas

Register a dedicated Locations tab through the existing tab controller. Its panel contains:

- A canvas displaying a simple node-and-link graph.
- A collapsible left sidebar providing details and action controls for the selected node.
- Compact navigation controls and an indication of the current graph view.

The sidebar belongs entirely inside Locations and is never visible in Operations or Workshop. It supplements the graphic with concise reference information rather than duplicating narrative descriptions.

The graph has two main views:

| View | Contents |
| --- | --- |
| Area network | Known area locations and their authored connections |
| Local area | Habitats, ships, asteroids, and other authored locations or scene objects associated with the displayed area |

Both views use the same general visual language. This phase does not add a third view for interiors, orbital simulation, or procedural galaxy generation.

Graph visibility follows discovery rules. A displayed connection must not imply a travel route unless that route exists in the authored location model. Mobile sites must appear in their current saved area.

### Selection and sidebar behavior

Clicking a node selects it, highlights a circle around it, and opens the sidebar. Clicking another node changes the selection and sidebar contents. Provide an explicit sidebar collapse control.

Distinguish the selected node from the player’s actual location with separate visual markers. Selecting a node never moves the player or changes the assets shown in Workshop and the instrument bay.

The sidebar shows relevant known information and an explicit Travel or Enter action for visitable destinations. Show a clear reason when travel is blocked; descriptive objects without routes must not offer travel.

Use the existing registered-action system for sidebar controls. Future inspecting, scanning, trading, and similar actions can extend this presentation, but do not implement those systems or add nonfunctional placeholder buttons now.

Retain the planned item and stored-power transfer interface within Locations, with its existing ownership, proximity, capacity, and current-endpoint restrictions.

### Zoom navigation

Mousewheel input over the canvas controls zoom.

From the area network:

- If an area node is selected, zooming in targets that node and transitions into its local-area view.
- If no node is selected, zooming in initially enlarges the network.
- When one area node becomes predominantly visible near the canvas center, further zooming transitions into that area’s local view.
- If there is no clear dominant node, remain in the area network until the target becomes clear or the player selects one.

Zooming out from the local view returns to the area network. Preserve enough parent-view context to make the transition understandable.

Use separated entry and exit thresholds to prevent small wheel movements from repeatedly switching views. Exact scale and dominance thresholds should be tuned during visual verification.

Zooming, switching graph views, and selecting nodes are presentation-only operations. None executes travel or changes saved world state. Local-view zoom remains bounded; it does not open an interior view.

### Integration and verification

Keep location browsing, selection, sidebar state, and viewport state in `locationDisplay.js` or its presentation helpers. The location core continues supplying read-only views and validating gameplay actions.

Provide keyboard and touch alternatives for node selection, opening details, zooming, and returning to the area network. Canvas graphics must have an accessible equivalent for selecting destinations and reaching their actions.

Preserve focus during graph updates and tab changes. On narrow screens, the sidebar may overlay the canvas within Locations, with a reachable close control.

Verify that:

- Browsing and zooming never move the player or switch active inventories.
- Selection rings and current-location markers remain distinguishable.
- Selected-node and unselected-node zoom transitions behave as specified.
- The sidebar remains confined to Locations.
- Successful travel switches to Operations and updates all local displays.
- Failed travel does not trigger arrival narrative, background changes, or tab switching.
- Header identity and background tint restore correctly when loading a save.
- Power history does not combine different locations into one continuous local graph.
- Mouse, keyboard, touch, reduced-motion behavior, and narrow layouts remain usable.
## 19. Confirmed connection rules and implementation notes

The user confirmed the section 3 defaults, with the following travel-model
changes. These supersede earlier references to explicit authored connections:

- Use 2D positions for area locations, measured from a shared starting origin.
- Derive bidirectional area connections from a configurable distance threshold.
  The threshold is inclusive and distance is Euclidean.
- All known local sites within one area are reachable without individual routes.
- From a site, travel to a connected neighboring area before entering its sites.
- Discovery and access requirements still apply; graph browsing never travels.
- Site graph layout is presentation-only. Area coordinates determine travel links.
- Ship gameplay is deferred. Test-only ship-like sites verify shared identity,
  ownership, saved area membership, storage, power, crafting, and transfers.

The playable examples are Habitat 05, its vicinity, an owned supply platform,
the outer collector reach, and an unowned derelict relay. The supply platform
makes local transfers usable without introducing a ship subsystem.

New supported locations require one definition in `js/locationContent.js`.
Neighbors, travel actions, local state, map nodes, and inspection controls are
derived. The implementation retains one save, one visible-time simulation loop,
and the existing player-action transaction. The authoring contract and examples
are documented in `LOCATION_AUTHORING.md`.
