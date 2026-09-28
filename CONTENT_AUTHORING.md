# Adding resources, components, and products

Timed extraction/refining uses the separate [Processing catalog](PROCESSING_AUTHORING.md).
Machine products still use normal recipes and installation capabilities here;
Processing batches accept resources/components, while products remain Crafting outputs.
Modular vessel Products use this catalog too. Their `vesselModule` metadata and
Shipyard assembly rules are in [VESSEL_AUTHORING.md](VESSEL_AUTHORING.md).

Add entries inside `definitions.items` in `js/content.js`. This is the only authored
item catalog. The game derives inventory, recipe choices, compatible ingredient
options, actions, and installed equipment definitions from it at startup.

Restart/reload after editing content. No dynamic registration or asset build is required.
Run `node --test tests/*.test.mjs` to check the existing behavior after changes.

## Quantity and storage contract

Raw resources are authored in m³ and require `researchSampleM3`. Components and
products use whole counts and require positive packed `unitVolumeM3`. Volumes must
be exact multiples of 0.000001 m³. This applies to acquisition, exact ingredient
slots, starting inventory, and operating costs as well as the explicit volume
fields. Physical `baseCapacity` is rejected: every site/ship has one shared hold.
`baseCapacity` and location `capacities` now apply only to utilities such as power.

Catalog compilation converts bulk quantities to integer cubic centimetres. Saved
inventories and action payloads use those integers; one authored `0.01` m³ becomes
`10000`. Counted quantities and power retain their own units. Use `parseQuantity`
for player input, `compileQuantity` for authoring, and `formatQuantity` for display.
Never multiply already compiled values again or format internal bulk values as counts.

Crafting checks the entire final load, including space freed by all inputs.
Overloaded existing stores can consume or exchange cargo without increasing
occupied volume, and can recover with deliberate confirmed discard. Fresh authored
starting inventories must fit. Recipe occupied volumes need not balance: packing
volume is not a mass-conservation model.

Installed `storageBonusM3` adds usable cargo capacity per installed unit, independent
of health/enabled state. Carrying that product only uses cargo space. Its installation
removes one counted product and adds the capacity within the same saved transaction.
Installed batteries continue to add power capacity through `capacityBonus: { power: 10 }`.

Version-seven migration factors are frozen in `storageMigration.js`; changing current
gathering yields or sample sizes must not change them. Custom pre-v7 content needs an
explicit historical migration descriptor. Renames, category changes, and changes to
the volume quantum require explicit compatibility work.

## Common fields

The object key is the stable item ID. Use a letter followed by letters, digits,
underscores, or hyphens. Keep IDs stable after release: names can change without
changing saved inventory. IDs must not collide with utilities such as `power`.

| Field | Meaning |
| --- | --- |
| `name` | Required player-facing name |
| `category` | Required: `resource`, `component`, or `product` |
| `researchSampleM3` | Required positive sample volume for a raw resource |
| `unitVolumeM3` | Required positive packed volume per component/product |
| `description` | Optional inventory tooltip |
| `initialQuantity` | Catalog metadata; location starting grants belong in `initialResources` |
| `tags` | Optional descriptive property strings; they do not authorize substitutions by themselves |
| `roles` | Approved ingredient roles, described below |
| `acquisition` | Gathering/recovery action definitions |
| `recipes` | Recipes producing this item |
| `recipeContributions` | Recipes producing another existing component/product |
| `installation` | Product installation and power/capability settings |
| `operations` | Actions performed by an installed product |
| `maintenance` | Component-based repairs to an installed group |
| `upgrades` | One-time component-based power/speed upgrades to this product's installed group |
| `vesselModule` | Product-only Shipyard module; its one `unitVolumeM3` is the rigid envelope |

Only use optional fields whose behavior is documented here. Extra metadata is not
a new mechanic. Trade pricing is not implemented. Research affinities are authored
separately in `js/research/researchContent.js`, using ordinary item tags.

## Add a resource and an alternate recipe in one entry

This example adds an acquisition action and a new way to make existing structural
parts. The source material remains non-craftable.

```js
recoveredMetal: {
  name: "Recovered metal",
  description: "Clean metal recovered from a sheltered deposit.",
  category: "resource",
  researchSampleM3: 0.01,
  tags: ["metal"],
  acquisition: [{
    id: "gatherRecoveredMetal",
    name: "Recover clean metal",
    amount: 0.01,
    conditions: { locations: ["habitat"] }
  }],
  recipeContributions: [{
    id: "formStructure",
    name: "Form recovered metal",
    output: "iron",
    inputs: [{ id: "material", item: "recoveredMetal", quantity: 0.02 }]
  }]
}
```

An acquisition action needs a globally unique `id`, unique `name`, and positive
`amount`: m³ for a resource, whole counts for components/products. Optional `cost` is an item/utility quantity map. Optional action
metadata includes `aliases`, `shortcut` (one digit 1–9), and numeric `order`.
Reserve shortcuts 1–3 for the existing directives. Gathering checks location and
other conditions, affordability, and complete output storage.

Acquisition represents finding something, so it can also recover a component or
product. A found manufactured object retains its category.

## Add a substitute component

```js
reclaimedConductor: {
  name: "Reclaimed conductor",
  category: "component",
  unitVolumeM3: 0.002,
  tags: ["conductive"],
  roles: {
    conductor: {
      units: 1,
      conditions: { discoveries: ["reclaimedConductorUse"] }
    }
  },
  recipes: [{
    id: "recover",
    name: "Prepare reclaimed conductor",
    inputs: [{ id: "salvage", item: "electronicSalvage", quantity: 0.01 }]
  }]
}
```

The new conductor automatically becomes a choice in the existing solar-panel and
antenna conductor slots. Its approved use remains locked until
`state.knowledge.discoveries.reclaimedConductorUse` is true. Omitting the role's
conditions makes its use available immediately. Recipe conditions separately
control whether the component itself can be fabricated.

Add an authored research discovery with the same ID to grant this knowledge through experiments; see
[RESEARCH_AUTHORING.md](RESEARCH_AUTHORING.md). This example's `reclaimedConductorUse` is not a shipped discovery.
Do not gate the only route to essential starting equipment behind an unavailable discovery.

Role `units` defaults to one and must be a positive integer. A slot requiring
three units consumes three ordinary components or two components contributing two
units each. The game rounds upward. One item type fills each slot, and the costs
of all slots are combined before affordability is checked. Raw resources instead require explicit `unitsPerM3` (no `units` default); their requirements round upward to one cubic centimetre. Role contribution and occupied volume are independent.

An approval can optionally include `recipes: ["radioAntenna:assemble"]` to limit
that item's role to named recipes. Omitting it permits all otherwise compatible
slots. This lets a newly added item restrict its own applications without editing
existing products.

## Recipe fields and matching

| Field | Meaning |
| --- | --- |
| `id` | Stable ID local to the owning item; compiled as `ownerId:recipeId` |
| `name` | Recipe label |
| `inputs` | Nonempty list of ingredient slots |
| `amount` | Output quantity, default one |
| `cost` | Optional utility-only operating cost, such as `{ power: 1 }` |
| `conditions` | Optional recipe availability requirements |
| `directive` | Optional direct action metadata for a standard recipe shortcut |
| `output` | Required only in `recipeContributions`; names the output item |

A slot has a stable local `id`, positive `quantity` (m³ for an exact resource input, whole counts for exact components, or whole role units), and exactly one of
`item` or `role`. Role slots may specify `defaultItem`. They can also require all
listed `tags` and reject any listed `excludeTags`. Example:

```js
{ id: "wiring", role: "conductor", quantity: 1,
  defaultItem: "conductiveParts", excludeTags: ["uninsulated"] }
```

Product recipes accept components only, regardless of roles. Component recipes
accept resources/components. Neither kind accepts products as ingredients, and
recipes cannot output resources or power. A machine is an equipment condition,
not a consumed ingredient.

Exact-item slots never automatically accept substitutes. Use roles for intended
interchangeability. Descriptive tags further restrict an approved role; they do
not grant one. Role names are shared strings: declaring a new role makes it
available to recipes without a separate role registry.

Standard ingredient selection does not silently switch to available substitutes.
The player explicitly chooses alternatives. A changed discovery or inventory
state is rechecked when crafting executes. Full output storage blocks crafting
before payment, using inventory after ingredient consumption.

To add an efficiency improvement, declare another recipe with revised inputs or
utility costs and its discovery condition. To add an improved product, define a
named product with its own recipe and behavior. Inputs do not automatically pass
their tags, quality, or performance to the output.

## Add a product with supported behavior

```js
auxiliaryPanel: {
  name: "Auxiliary panel",
  category: "product",
  unitVolumeM3: 0.03,
  recipes: [{
    id: "assemble",
    name: "Assemble auxiliary panel",
    inputs: [
      { id: "structure", role: "structure", quantity: 1, defaultItem: "iron" },
      { id: "cells", role: "photovoltaic", quantity: 1, defaultItem: "solarCells" }
    ]
  }],
  installation: {
    group: "auxiliaryPanels",
    powerPerSecond: 0.2,
    conditions: { locations: ["habitat"] }
  }
}
```

This generates the inventory entry, assembly controls, installation directive,
saved infrastructure group, and additional power generation without other edits.

Installation consumes one product. `group` must be unique. `limit` optionally
restricts the installed count. Generation defaults to zero; a negative
`powerPerSecond` consumes power through the existing simulation. Current sunlight
is constant, with no day/night system. Quantity and health scale power output.
Only enabled groups operate. Installation preserves aggregate working capacity
when adding a healthy unit to an existing damaged group.

Optional installation `capabilities` is an array of strings such as `["radio"]`.
Conditions can query those capabilities from enabled, nonempty, healthy groups.

Optional installation `capacityBonus` maps utility IDs only to positive safe
integer storage increases per installed unit, for example `{ power: 10 }`.
Bonuses stack on top of the location's base capacity or override. They are passive:
only installed quantity matters, regardless of health or enabled status. Stored
products do not contribute. Installation adds empty capacity, never inventory or
power; surplus generation fills the shared local power reserve normally. Capacity
is derived rather than saved, and the same calculation governs storage, transfers,
the power display, and saved-state validation. Combined capacity must stay finite
and within JavaScript's safe numeric range.

An operation has a globally unique action `id` and a locally unambiguous `name`, optional `cost`, optional
`conditions`, optional `message`, and an authored `effects` array. Effects execute
synchronously in authored order on the same candidate root state. Costs, rewards,
completion, and other changes commit together only after validation and saving succeed.
Operations require their installed product to be enabled
and healthy and can consume resources, components, and utilities. A stored
product alone does not make an installed operation available.

New `once: true` operations require independent `completion: { scope, flag }`
metadata. Scope is `global` or `location` (the captured source location). Keep this
flag identity stable when changing rewards; it determines whether the operation
has already completed. Completion is recorded after successful effects and rolls
back with the action on failure. Conflicting reward writes that clear the same
completion flag are rejected.

```js
{
  id: "scanSignal", name: "Scan local frequencies", cost: { power: 1 },
  once: true, completion: { scope: "global", flag: "localSignalObserved" },
  effects: [{ type: "setFlag", scope: "global", flag: "localSignalObserved", value: true }]
}
```

Legacy singular `effect` is still accepted for existing `setFlag` operations and
normalized to one effect. Declaring both `effect` and `effects` is rejected. Its
omitted scope stays global, `scope: "local"` becomes location scope, and its flag
write stays `true`. Legacy one-time completion retains that exact flag and scope,
preserving old saves. When converting legacy content, use explicit completion
metadata with the same identity. Reload never replays rewards. Save version remains 8.

Supported effects for item operations, dialogue choices, research completion, and inspections:

| Type | Authored fields |
| --- | --- |
| `setFlag` | `scope`, `flag`, boolean `value`; `target` required for `location` or `npc`, omitted for `global` |
| `discover` | `id` (shared knowledge; no experimental rewards or progress) |
| `relocate` | `npcId`, `destinationId` (site or ship) |
| `grantItem` | `itemId`, positive `amount`, optional `destinationId` (defaults to `current`) |
| `deactivateEntity` | `targetId`, optional string `reason` |
| `activateEntity` | `targetId`, optional string `reason`; preserves existing identity/assets |
| `activateLocation` | `targetId` (site/ship), optional string `reason` |
| `spawnEntity` | `spec` containing an authored creation specification; see [ENTITY_AUTHORING.md](ENTITY_AUTHORING.md) |

`current` means the source location captured before the effect array; earlier
effects never rebind it. Item operations cannot use the dialogue-only `speaker`
alias. Literal entity targets must exist and have the appropriate type; reusable
templates are definitions, not target entities. Unknown effect types fail during compilation.

A grant creates stored cargo at an active site or ship, without a source debit.
Bulk resource amounts use authored m³ and compile once to exact volume units;
components/products use whole counts. Capacity or arithmetic failure rejects the
entire action without clamping. Products remain uninstalled cargo. NPC inventory
and utility grants are unsupported. Deactivation preserves identity/assets and
uses existing lifecycle blockers; it never forces eviction or cancels journeys.

Research discovery `effects[]` run only on first experimental completion; generic
`discover` effects never trigger rewards. Location `inspectionEffects[]` and scene
`effects[]` run once per existing inspection marker. See
[RESEARCH_AUTHORING.md](RESEARCH_AUTHORING.md) and [LOCATION_AUTHORING.md](LOCATION_AUTHORING.md).
Operations still require installed products. General consumable-item use, crafting
effects, upgrade effects, result bindings, and automatic event hooks remain deferred.

Maintenance entries contain action `id`, `name`, `target` infrastructure group,
component-only `cost`, and optional conditions. Repair sets the group's health to
one without consuming the installed product. Repairs are hidden when unnecessary.

Upgrade entries contain a local `id`, player-facing `name`, component-only `cost`,
numeric `powerBonus`, optional nonnegative `travelSpeedBonus` (default 0), and
optional conditions. Infrastructure/installation definitions can supply nonnegative
`travelSpeed` for ship propulsion; see SHIP_AUTHORING.md. Each upgrade applies once per
installed group, adds to its per-unit power rate, and is recorded by its ID. New
units added to that group share its upgrades. Arbitrary upgrade effects and
per-instance equipment inventories are not implemented.

## Conditions

Conditions are optional objects. Each provided array is a list of requirements:

- `locations`: any listed location matches `state.locationId`.
- `discoveries`: every ID must be true in `state.knowledge.discoveries`.
- `flags`: every ID must be true in root `state.flags`.
- `localFlags`: every ID must be true in the current location’s local flags.
- `equipment`: every installed group must exist, be enabled, and have positive quantity and health.
- `capabilities`: every capability must be provided by an active installed group.

All provided condition types must pass together. Empty arrays impose no condition.
Other condition keys fail validation. Location references do not create locations and are checked against the location
catalog. Gathering actions must also be assigned to their locations. See
[LOCATION_AUTHORING.md](LOCATION_AUTHORING.md) for travel and one-entry site authoring.

## Extension checks

For a new item, confirm acquisition/recipe reachability, category legality, costs,
storage, role matching, and supported operation behavior. Avoid circular prerequisites
with no accessible starting input. Reachability and economic balance are content
design responsibilities; the catalog compiler validates structural rules.

Existing saved locations gain zero quantities for new item IDs and zero-count
installed groups. Starting grants belong in location definitions. Preserve IDs. Capacity reductions can create recoverable overload; category or unit changes require
an explicit migration. Removing items, recipes selected in a save, or installed
upgrades also needs a migration strategy. Unsupported or malformed saves are
preserved instead of being overwritten with a new game.

`tests/crafting.test.mjs` includes definition-only extension examples. New mechanics
need shared implementation and validation first; after that, item definitions can
reuse them. Research experiments and ship propulsion have dedicated systems. Trade, timed jobs, and continuous
resource-processing machines remain future work.
