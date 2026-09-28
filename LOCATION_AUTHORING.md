# Adding locations

Stationary sites can author finite `resourceNodes`; ships access them while docked.
See [Processing authoring](PROCESSING_AUTHORING.md) for source tags, scoped node
identity, reserve reconciliation and exact extraction quantities. Add `processing`
to a host type's `actionSets` to expose local batch actions. Generated instances
receive independent reserves; existing depleted nodes never refill on reload.

Locations now have persistent entity identities. See
[ENTITY_AUTHORING.md](ENTITY_AUTHORING.md) for reusable `templates`, runtime
creation, ownership/control permissions, and lifecycle rules. Existing authored
entries still create the same starting locations.

Add one entry to `locationDefinitions.locations` in `js/locationContent.js`.
The type, item definitions, actions, and equipment you reference must already
exist. No engine, UI registration, neighbor edits, or save changes are needed.
Reload to compile the catalog. Invalid references and conflicting commands fail
at startup instead of silently creating unusable locations.

Stationary `shipyard: true` sites can assemble physical module Products; Habitat
07 supplies the first Shipyard. Off-site prospecting nodes use tags
`['solid','prospectable']` and finite reserves. The `modularVessel` template is a
zero-cargo, zero-power shell whose assembled core and attachments supply its live
behavior. See [Modular vessel authoring](VESSEL_AUTHORING.md).

## Add a local site

```js
recoveryPlatform: {
  name: "Recovery platform",
  type: "platform",
  areaId: "vicinity",
  initialOwnerId: "player",
  remoteDescription: "An owned recovery and fabrication platform.",
  description: "Recovered panels line the workshop walls. The fabricator is ready.",
  actions: ["salvage", "gatherElectronics"],
  initialResources: { power: 4 },
  initialInfrastructure: {
    fabricator: { quantity: 1 },
    solar: { quantity: 1, health: 0.6 }
  },
  storage: { capacityM3: 2 },
  capacities: { power: 20 },
  sceneObjects: [{
    id: "workbench",
    name: "Recovery workbench",
    description: "Someone has sorted the recovered wiring by hand."
  }]
}
```

Known sites in the current area are potential ship docking destinations, subject
to access and propulsion requirements. Sites need no coordinates or explicit
connections; canvas layout is decorative. Areas contain sites but cannot be
occupied directly. The player's location and containing area ID are separate.

## Add an area

```js
mirrorFields: {
  name: "Mirror fields",
  type: "area",
  position: [-80, 50],
  remoteDescription: "A nearby field of unfinished reflectors.",
  description: "Light flickers across a field of incomplete mirrors."
}
```

Area positions are 2D vectors from a shared origin at the starting area, in
arbitrary map units. Two areas connect both ways when their Euclidean distance
is **at most** the catalog's `connectionDistance` (initially 120). The graph and
travel use the same derived links. Adding an area updates its neighbors
automatically. A lone area beyond this range is intentionally unreachable until
intermediate areas are defined.

Travel requires boarding a docked ship, undocking, crossing to an adjacent area
if necessary, approaching and docking at a site, then disembarking. Journeys take
visible play time and consume ship power. Map selection and zoom never travel.
Area positions are static metadata; ships change saved `areaId` while preserving
identity, owner, and assets. See [SHIP_AUTHORING.md](SHIP_AUTHORING.md) for the
one-entry ship definition, timing, access, and save rules.

## Templates and starting assets

Each location selects one type from `locationDefinitions.types`. There is no
template inheritance chain. Types supply `kind` (`area` or `site`), color, action
collections, and optional defaults for the same fields as locations.

- Scalar fields override template fields. Use full six-digit hex colors close
  to the existing dark palette; colors are presentation metadata, never saved.
- `initialResources` and `capacities` merge by asset ID. Zero is an explicit value.
- Infrastructure merges by group, then by field. Defaults are quantity 0,
  health 1, enabled true, upgrades `[]`. Each location gets independent objects.
- Missing starting resources are zero. Equipment defaults from the item catalog
  do not grant solar arrays or life support at every location.
- Sites must resolve `storage.capacityM3` from their type or an explicit site value. Zero overrides the type. Areas have zero cargo capacity and no physical contents. Fresh starting loads must fit, including installed storage bonuses.
- `capacities` overrides utilities only; power otherwise inherits its catalog capacity. Raw starting quantities are authored in m³ and manufactured items in whole counts.
- Action lists and expanded collections form an ordered, deduplicated union.
  `removeActions: ["actionId"]` explicitly removes inherited assignments.
- Scene objects merge by local `id`; a location entry replaces the whole matching
  template entry. `removeSceneObjects: ["objectId"]` removes inherited objects.
  Empty arrays do not remove inherited entries.
- `initialOwnerId: "player"` permits local asset management. Omit it, or use
  `null`, for unowned locations. Other stable owner IDs grant no player access.

Keep location IDs stable. New locations receive their authored initial assets
when an existing save first encounters them. Existing location records retain
their saved ownership, area, inventories, equipment, and local flags. Changing a
starting grant does not replenish existing sites. New item/equipment definitions
start empty at existing sites. Removal, renaming, and changing quantity kinds require an explicit migration. Cargo-capacity reductions preserve stock in an overloaded state; utility-capacity reductions still need explicit compatibility handling.

## Actions and facilities

Cargo is shared across physical items. Habitat, platform, derelict, and ship types
currently provide 10, 2, 0.25, and 0.2 m³ respectively. Override `storage.capacityM3`
on a site to change its base hold. Installed `storageBonusM3` is added live. Nothing
about adding a new item increases storage capacity. Existing overloaded saves keep
their stock; Workshop displays overload and offers confirmed discard as recovery.

Transfer action `amount` uses internal units: 0.01 m³ of scrap is `10000`, while
two components are `2`. UI text is parsed through `parseQuantity`. Both endpoints
are checked before mutation and the exact requested amount moves or nothing moves.

Assign reusable registered action IDs in `actions`. A shared action is registered
once and acts on its current local context. Gathering requires explicit
assignment and operation-specific permissions; default unowned examples offer inspection only.

Two predefined collections expand existing item actions at startup:

- `crafting`: direct recipe directives plus `craftSelected`.
- `equipment`: installation, repairs, operations, and upgrades.

The habitat, platform, and ship types include both collections. Adding an item
using supported equipment behavior automatically adds its actions to those types.
Recipe and ingredient selection actions are global presentation selections saved
through the normal transaction. Selecting a recipe does not grant crafting access.

`definitions.recipeCapabilities` in `js/content.js` sets the common recipe
capabilities, currently `fabrication`. Recipe-specific capabilities are added to
them. At least one enabled, healthy, nonempty local equipment group must provide
each required capability. The habitat starts with `fabricator`; other sites need
an explicit grant. There is no new power fee or automatic shutdown rule. Existing
recipe utility costs still apply to the local reserve. This preserves recovery
from depleted starting power.

`inspectSite` is a reusable public one-time local console inspection. Descriptive
scene objects automatically receive an `inspect:<locationId>:<objectId>` action.
Descriptions and inspection results appear in Operations. Scene location
references use `{ id: "relay", locationId: "derelict" }`; their target's definition
owns its identity and saved area membership determines where it appears on the
map. Location references do not override a destination's discovery rules or
force a mobile site to appear in its former area.

## Inspection effects

A location definition may declare optional `inspectionEffects[]` for `inspectSite`;
a descriptive scene object may declare optional `effects[]` for its existing
`inspect:<instanceId>:<sceneId>` action:

```js
inspectionEffects: [{ type: "grantItem", itemId: "iron", amount: 1 }],
sceneObjects: [{
  id: "locker", name: "Sealed locker", description: "The locker opens.",
  effects: [{ type: "discover", id: "lockerManifest" }]
}]
```

`inspectSite` still needs to be assigned to the location; descriptive scenes receive
their actions automatically. Scene entries with `locationId` are map references,
not inspections, and cannot declare rewards. Arrays use the shared effect schema;
unknown types and invalid cross-catalog references fail compilation. `current` is
the captured inspected instance; `speaker` is invalid here. Startup messages,
viewing the map, entering a location, reload, and reconciliation never run effects.

Effects run before recording the existing `consoleExamined` or `examined:<sceneId>`
completion marker, on the same root candidate. Any failure rolls back all effects
and the marker. Completion is independent of rewards and separately saved for each
generated instance. Editing rewards does not replay already completed inspections;
keep stable scene IDs. Authored `inspectionEffects` replace inherited arrays, and a
scene with the same ID replaces the inherited scene including its effects. Arrays
are never implicitly concatenated. The inspected description is captured for the
committed action's output.

Site/ship `initialLifecycle` may be `active` (default) or `inactive`. It applies
only to newly seeded identities; reload retains existing lifecycle. The starting
site and authored areas must be active, and starting placements/docks must be
available. An inactive site can later be enabled with `activateLocation`.
See [ENTITY_AUTHORING.md](ENTITY_AUTHORING.md) for spawning and activation examples.

## Discovery, access, and completion

Location `conditions` control whether the location is known. `accessConditions`
control entry separately, so a known destination can show a blocked-travel reason.
Scene objects can have their own `conditions`. Supported keys match item
conditions: `locations`, `discoveries`, `flags`, `localFlags`, `equipment`, and
`capabilities`. Lists combine with AND; `locations` matches any listed ID.

Visibility conditions use the described location's local flags/equipment and
root knowledge/global flags. Entry requirements use the player's current context.
A site's area must also be known before that site appears. References are checked
at startup. The research system reads these conditions without owning location behavior; see
[RESEARCH_AUTHORING.md](RESEARCH_AUTHORING.md) to turn scene inspection flags into evidence.

`flags` remains global, including the original radio-signal outcome. `localFlags`
checks the current local flags. An item operation can set a local completion flag
with `effects: [{ type: "setFlag", scope: "location", target: "current",
flag: "consoleRead", value: true }]` and independent
`completion: { scope: "location", flag: "consoleRead" }`, plus `once: true`.
Legacy singular flag effects preserve their original completion identity.

Action IDs are globally unique. Labels, aliases, and shortcuts can be shared by
different actions only at disjoint locations. Conflicts in effective assignments
are rejected at startup; command resolution also guards against ambiguity. Keep
shortcuts 1–3 stable. Direct execution repeats assignment and access checks.

## Transfers and extension boundaries

Locations provides a transfer form for stored items and power. Both endpoints
must be distinct, known sites in the same immediate area, with withdrawal permission on the source and deposit permission on the destination. The
player must occupy one endpoint. Sending and receiving are supported. Transfers
are immediate and lossless, require the full stock and receiving capacity, and
use one saved transaction. Resources are entered in m³, manufactured items require whole counts, and power permits fractions. The UI converts bulk input to integer volume units before invoking the action.
Transfers are blocked while either endpoint is travelling. Installed infrastructure
cannot be transferred; it remains aboard when a ship moves. Uninstalled products
are ordinary cargo. Entry/passenger permission alone does not grant access to private inventories, equipment, or power.

For a new mechanic, define an ordinary action with callbacks
`visible(root, context)`, `requirement(root, context, payload)`, and
`execute(root, context, payload)`. Context contains `local`, `definition`, `id`,
`owned` (title ownership only), `permissions`, `actorId`, `actionIds`, and a transient `actionState` adapting local assets for
existing resource/crafting helpers. Resolve context afresh for every transaction;
never retain a local object across commits. Do not save the transient adapter.
Declare explicit `permissions` for asset-management actions (`access: "managed"` defaults to facility/withdrawal/deposit checks), or `access: "public"`
for explicit exploration. Use `scope: "global"` only for intentionally global
actions; otherwise assign the action through the location definition.

The location core has no DOM, storage, timer, or message-bus dependency. Resource
arithmetic has no location dependency. `runtime.js` owns copy → execute → validate →
save → commit; all travel presentation happens afterward. Ships already reuse
this boundary; future NPCs, events, and ownership changes can do so without
adding another asset store or save service.

Run `node --test tests/*.test.mjs` and, with Playwright available,
`node --test tests/terminalTabs.browser.mjs`. Browser tests use isolated saves.
