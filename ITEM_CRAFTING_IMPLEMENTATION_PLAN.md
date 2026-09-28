# Item and Crafting Foundation — Implementation Plan

Status: foundation implemented. See `CONTENT_AUTHORING.md` for the implemented schema and `README.md` for the current module boundaries and checks. The later revision consolidated authored item definitions into `content.js`, removed `habitatActions.js`, and kept crafting synchronous.

## 1. Objective and boundaries

Build a small, extensible gather → fabricate → assemble → operate loop around a solar panel and a radio antenna. Define each item in one authoritative catalog entry, including its acquisition, recipes, approved ingredient roles, and supported operating behavior. Derive inventory entries, recipe indexes, compatible ingredients, and player actions from that catalog.

Keep the existing vanilla JavaScript modules, synchronous action transactions, resource arithmetic, simulation loop, event bus, and localStorage persistence. The first version uses immediate crafting, matching the existing refining action. Timed jobs, queues, continuous material-consuming production, and full research experiments are later features.

### Agreed category rules

- Resources enter through gathering, extraction, scavenging, or trade. Recipes never output resources.
- Components include processed materials, parts, and assemblies. Their recipes consume resources and/or components.
- Products are assembled exclusively from components. Installed machines are products.
- Products can consume resources or components during operation. Consumable is a use, not an item category.
- Tools and installed machines can be requirements without being consumed ingredients.
- Research can unlock recipes, substitutions, efficiency changes, and explicitly defined improved products.
- Found items retain their category: finding a manufactured component does not make it a resource.
- Power is a utility, separate from these three item categories, even though its quantity continues to use the existing storage map.

## 2. One authoritative definition per item

Add one item-definition module. Adding an ordinary resource, component, or product means adding one entry there; no separate inventory entry, recipe registration, or UI registration is required.

Each entry supports these fields as appropriate:

| Field | Purpose |
| --- | --- |
| Stable ID | Save references and catalog lookup; independent of display name |
| Name, description, category | Player-facing identity and category validation |
| Capacity and initial quantity | Storage limits and automatic new-game defaults |
| Descriptive tags | Material properties and future research affinities |
| Ingredient roles | Approved crafting uses, contribution per unit, and optional discovery requirements |
| Acquisition methods | Location conditions, amount, cost, and player-facing action text |
| Recipes | Ways to produce this item, with stable local recipe IDs |
| Recipe contributions | Optional additional recipes producing another existing item |
| Installation | Where the product is installed and its supported installed behavior |
| Operations | Supported actions, consumable costs, effects, and conditions |
| Maintenance/upgrades | Component costs and supported changes to installed products |

Only identity, category, and storage metadata are universally required. Other fields have small, documented defaults or are omitted.

An output item's normal recipes live inside its definition. A future input item can declare a recipe contribution targeting an existing component or product. This allows a newly introduced material to add an alternate production method without also editing the old output item's entry. Contribution IDs are namespaced by their owning item, and their outputs must pass the same category checks as ordinary recipes.

Derived recipe and infrastructure indexes are generated at startup. They are never a second manually maintained source of definitions and are not saved with game progress.

## 3. How interactions are derived

### Ingredient roles

Separate descriptive tags from approved crafting roles. A descriptive `conductive` property alone does not establish compatibility. An approved conductor role means the item can be used as a conductor under its declared conditions.

Recipe slots can require an exact item or an ingredient role. Use exact items where a material matters and roles where substitutions make sense.

For every slot, the resolver checks:

1. The ingredient category is legal for the output category.
2. The ingredient matches the exact ID or required role.
3. Any declared required or excluded properties match.
4. Recipe and ingredient-use discovery requirements are satisfied.
5. Equipment and location requirements are satisfied.
6. The complete selection is affordable.

Start with one selected item type per slot. A role declaration supplies a positive integer contribution per unit, defaulting to one. A slot requiring four role units needs four ordinary components or two components contributing two units each. Round required item counts upward; never consume fractional physical components. Recipe-local overrides can express exceptional exchange ratios.

Aggregate all selected quantities before checking affordability. The same inventory unit cannot satisfy two different slots.

### Automatic substitution

A new component declaring an approved conductor role automatically appears in all compatible conductor slots. Discovery-gated uses appear only after their discovery is known. Existing recipe definitions do not need to be edited.

Compatibility does not automatically select or spend an item. Prefer a declared standard ingredient, then let the player choose an alternative. If that ingredient is unavailable, show the alternatives without silently spending a different component.

### Alternate recipes and improved outputs

Multiple recipes can produce the same item. Their ingredients, operating costs, equipment requirements, and discovery requirements can differ.

For the first version, use an explicitly defined recipe variant for an efficiency improvement. Improved products have their own item definitions and recipes. This avoids ambiguous quality inheritance, stacked efficiency calculations, and unique inventory entries for arbitrary ingredient combinations.

### Scope of automatic behavior

The catalog determines compatibility, quantities, visibility, supported actions, and supported effects. It does not invent manufacturing chemistry or infer arbitrary behavior from prose.

New content using existing roles and behavior types requires definitions only. A new behavior, such as a future autonomous mining simulation, requires a bounded behavior handler and then becomes reusable by other item definitions. Unknown behavior types fail catalog validation rather than silently doing nothing.

## 4. Small starting catalog

These quantities are initial tuning values, not claims about real manufacturing yields. Fabrication abstracts preparation and manufacturing into a single action.

| Item | Category | Initial source or recipe | Approved role |
| --- | --- | --- | --- |
| Metal scrap | Resource | Existing salvage action | None initially |
| Electronic salvage | Resource | Gather from local equipment debris | None initially |
| Silicon-bearing minerals | Resource | Gather from deposits near the habitat | None initially |
| Structural parts | Component | 4 metal scrap → 1 structural part | Structure |
| Conductive parts | Component | 2 metal scrap + 1 electronic salvage → 1 conductive part | Conductor |
| Electronic parts | Component | 2 electronic salvage → 1 electronic part | Electronics |
| Solar cells | Component | 2 silicon-bearing minerals + 1 electronic part → 1 solar cell | Photovoltaic |
| Solar panel | Product | 2 structure + 1 conductor + 2 photovoltaic → 1 panel | None initially |
| Radio antenna | Product | 1 structure + 1 conductor + 1 electronics → 1 antenna | None initially |

Retain `scrap` as the metal-scrap ID. Reuse `iron` for the existing refined inventory entry, displaying it as iron structural parts. This preserves existing quantities and the four-scrap refining conversion while giving that output a component role. New refined materials can be added later as separate components.

Use local gathering actions at the current habitat location for the first slice. Their definitions identify their sources; they can later be gated by additional location IDs and discoveries when exploration exists. Do not introduce a location-management subsystem solely for these examples.

Basic gathering and structural-part fabrication require no power or newly constructed machine. The player must be able to recover from depleted power and repair the starting array.

### Product use

- Installing a solar panel consumes one inventory product and creates or increases a healthy installed-panel group. Each healthy panel initially contributes 0.5 power per active second under the habitat's existing constant-sunlight assumption.
- Keep crafted panels in a separate infrastructure group from the damaged starting array. The current infrastructure model has one shared health value per group; combining them would incorrectly apply old damage to newly built panels.
- Installing the first radio antenna consumes one inventory product and enables a basic scan action. Scanning initially costs one power and records a persistent local signal observation with terminal feedback. This is a small demonstrable operation, not a complete communications or exploration system. Hide the completed one-time scan until additional scan content is defined.
- Limit antenna installation to one in the first slice. Additional inventory antennas can remain stored for later trade or upgrades.
- Repairing the existing solar array consumes two structural parts instead of eight raw scrap. The original eight-scrap material requirement is preserved through fabrication, and the repair now respects the component-only maintenance rule.

## 5. Crafting and operating flow

The initial interaction is synchronous:

1. Select a visible recipe.
2. Review its slots and choose substitutions when available.
3. Preview exact input quantities, utility costs, and output.
4. Execute through the existing action transaction.
5. Re-resolve and validate against current state, consume inputs, grant outputs, and save atomically.

Check output storage against the projected inventory after input consumption. If the complete output does not fit, block the operation before spending anything and explain the missing space. The existing `receive` helper clips overflow; crafted output must not be lost through that behavior.

Preview and execution use the same resolution function. Previewing is read-only and consumes neither inventory nor randomness. A failed execution, validation, or save leaves live inventory unchanged.

For ingredient selection, retain the registry's state-only action interface. Store recipe and ingredient IDs in a small crafting draft. Generate stable recipe-selection and slot-selection actions from the catalog; those actions update the draft through the existing transaction. A fixed craft action resolves and executes that draft. The crafting panel only displays selection actions relevant to the selected recipe.

Installation, repair, and operation also use the existing action transaction. Installed products remain in infrastructure state; they are not consumed as ingredients during an upgrade.

## 6. Integration with existing modules

| Module | Planned responsibility or change |
| --- | --- |
| `content.js` | The single authored item catalog, including recipes and interactions, plus utilities and starting infrastructure |
| New `itemCatalog.js` | Validate definitions and derive recipe, role, action-description, and infrastructure indexes |
| `resources.js` | Continue handling quantity, capacity, payment, and receipt; crafting supplies validated, aggregated costs |
| New `crafting.js` | Pure recipe resolution and previews, plus synchronous fabrication/assembly execution |
| New `itemActions.js` | Generate gathering, selection, crafting, installation, maintenance, and operation actions using existing `registerAction` |
| New `craftingDisplay.js` | Catalog-driven inventory and crafting display; use item names, categories, slots, and live availability |
| `state.js` | Catalog-derived inventory defaults, optional installed groups, crafting draft, discovery defaults, validation, and migration |
| `habitatActions.js` | Removed; generated actions preserve the existing command IDs and shortcuts |
| `game.js` | Sum enabled infrastructure power rates, including declared product generation, and expose inventory/crafting view data |
| `app.js` | Import the feature, wire its display into rendering, and normalize/migrate saves before validation |
| `save.js` | Retain synchronous localStorage persistence; support the migration/error-handling lifecycle |
| `index.html` / `style.css` | Add a compact crafting area and generated inventory list inside the current console layout |

Keep `state.resources` as the quantity map for resources, components, products, and power. Generate `content.resources` storage entries from the item catalog so existing resource helpers continue working. The internal name does not need to match the new player-facing category terminology.

Replace only the fixed scrap/iron inventory rows with catalog-driven rows. Preserve power instruments, the console, and fixed shortcuts 1–3. Generated crafting selection controls belong in their own panel; they should not flood the main directive list. Extend action display metadata with a small group field if needed, defaulting old actions to the existing directive group.

Generalize `powerRate` from its current two hard-coded machines to a sum over enabled installed groups using their definition, quantity, and health. This is a local function change using the existing infrastructure shape, not a new production engine.

## 7. Persistence and validation

Introduce an explicit migration from save version 1 to the foundation's version 2 before validating loaded saves.

- Preserve resource quantities, simulation time, location, solar health, and habitat condition.
- Populate new inventory IDs with their defaults; repeat this normalization when later catalog additions introduce new items.
- Add empty crafting and discovery state when absent.
- Allow defined but unbuilt infrastructure groups to have quantity zero. Preserve the starting array and habitat quantities.
- Do not apply an item rename by changing its stable ID.
- Reject malformed values rather than silently replacing them with defaults.
- Preserve the original stored save if migration or loading fails. The current fallback to a new game followed by a startup save must not overwrite an incompatible save automatically.

Do not save derived compatibility indexes or static definitions. Save owned quantities, installed conditions, known discoveries, operation observations, and current selection IDs only.

Catalog validation must check duplicate item/recipe/action IDs, invalid categories, unknown references, capacities, positive quantities/contributions, unsupported behaviors, and recipe output legality. All ingredients that can fill product slots must be components. Recipe contributions obey the same rules as recipes owned by their output item.

Validate catalog structure at startup and saveable facts during actions. Avoid recomputing the full catalog on each render or action.

## 8. Implementation sequence

1. **Catalog and compatibility:** introduce authoritative definitions, derived indexes, role matching, and definition validation. Verify the nine-item catalog and alternative-input resolution independently of the DOM.
2. **State and compatibility with existing play:** migrate saves, derive defaults, retain the existing action IDs, and route refining/repair through declared rules. Confirm the habitat can still be stabilized from a new game with no power reserve.
3. **Fabricate and assemble:** implement exact previews, ingredient selection, synchronous execution, complete output-capacity checks, and the compact catalog-driven display.
4. **Install and operate:** install panels and an antenna, add panel generation to existing power accounting, and expose the one-time radio scan.
5. **Prove extensibility:** use test-only catalog additions to introduce a new raw material, a substitute conductor, an alternate recipe contributed by the new item, and a product using existing operating behavior. No per-item engine or UI changes should be necessary.
6. **Prepare research integration:** verify discovery-gated recipes and role approvals using test states. Research will later grant these IDs; implementing experiments is outside this foundation.

## 9. Acceptance checks

- A resource cannot be produced by a recipe, and a product cannot consume raw resources as assembly ingredients.
- The same component can feed multiple component or product recipes.
- A newly defined approved substitute appears in compatible existing slots automatically; an ordinary descriptive tag alone does not enable it.
- Discovery requirements gate recipes and individual approved uses independently.
- Exact-item recipes retain their restrictions when new role-compatible items are introduced.
- Contribution ratios round safely and shared ingredients cannot be double-spent.
- Preview and execution agree, with requirements rechecked at execution time.
- Insufficient inventory, full output storage, invalid execution, and save failure cause no partial item transfers.
- Existing shortcuts resolve once, without duplicate generated registrations.
- Old saves retain progress and gain defaults; failed migrations retain the stored source save.
- Installing a product removes it from inventory exactly once, and existing solar damage does not affect newly installed panels.
- Power output remains correct for existing machines and new panels, with no hidden-tab or offline progress.
- The first antenna enables its declared operation and records its result persistently.
- Starting resources and recipes can reach both products without circular prerequisites or a research unlock.
- Adding a supported item and its interactions requires one authoritative definition, not edits to inventory, action lists, and recipes in separate files.

Use the existing Node test approach for catalog rules, resolution, transactions, migration, and power behavior. Perform one browser check of inventory display, ingredient selection, crafting, installation, and reload. Extend testing when changes introduce new behavior rather than building a broad framework up front.

## 10. Later expansion

The foundation leaves room for timed crafting, equipment-dependent fabrication, additional locations, trade, research experiments, named product variants, and continuously operating machines. Add these when gameplay needs them. In particular, timed crafting should record a resolved job in state and advance it through the existing visible-page loop; the first version does not need that machinery.

The key extension contract is: new items, substitutions, and alternate recipes using supported mechanics are catalog additions; new mechanics receive small reusable handlers.
