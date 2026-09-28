# Entity registry, lifecycle, and authority implementation plan

Status: implemented. Version-eight identity, authority, runtime creation, lifecycle, reference validation, migration, and normal-system/browser integration are present. See [ENTITY_AUTHORING.md](ENTITY_AUTHORING.md) for the implemented API and authoring contract.

Verification completed: all 161 unit tests and all 37 browser tests pass, including generated instances, authority checks, lifecycle/history retention, save migration, and normal interface integration.

The design below records the intended scope. Hard deletion, terminal-state compaction, generated areas, event generation, and autonomous AI remain explicitly deferred.

Based on the current version-seven state, location/ship systems, NPC/dialogue
systems, research history, action registry, and runtime commit path. The event
proposal supplies long-term context only. This plan does not implement events,
AI goals, trade, conflict, or procedural content selection.

## 1. Recommended direction

Add one flat, saved entity registry for identity, lifecycle, and authority.
Keep inventories, equipment, navigation, NPC state, and history in their existing
domain-owned state slices, indexed by entity ID. Introduce shared queries that
resolve an instance to its definition and runtime state.

The important separation is:

- A **definition** describes reusable content and starting defaults.
- An **entity** identifies one persistent instance in this playthrough.
- A **domain state record** holds that instance's changing gameplay data.
- An **authority policy** determines which actor may perform which operation.

A ship remains a location for storage, occupation, and equipment purposes. Its
registry type is `ship`; it does not acquire a second copy of its cargo or a new
ship-specific inventory system.

Use plain modules, explicit composition, synchronous candidate mutations, and
the existing save-before-commit transaction. Do not introduce an ECS, gameplay
event bus, generic component store, automatic system loader, or service locator.

## 2. Findings in the current implementation

| Existing behavior | Consequence for this work |
| --- | --- |
| `stateCore.js` creates one local/NPC state record for every catalog entry and rejects additional IDs. | A generated instance currently fails validation even if its state is otherwise valid. Validation must start from instances and resolve their definitions. |
| `locations.js` combines inherited location types with named authored locations. `npcs.js` also treats named characters as definitions. | Reusable templates and initial world placements need distinct compiler outputs; retain an adapter for existing content. |
| Ships use `state.locations[id]`, with `areaId`, `dockedAtId`, and `journey`. | Preserve this useful shared location/store boundary. |
| `ownerId` lives on local state and is only checked for string validity. | Owners need resolvable identities; migrate authority to one canonical record. |
| `getLocationContext()` derives `owned` and `managedAccess` from `ownerId === "player"`. Many actions and displays reuse these booleans. | Ownership, operational control, permissions, and cargo visibility must become separate queries. |
| Navigation and scene-inspection actions are registered once per authored target. Research actions capture a list of authored sites. | Runtime targets need payload-based actions and live action availability. A registry alone cannot make generated places usable. |
| Maps and NPC rosters enumerate definitions; names are frequently read directly from catalogs. | They must enumerate relevant entities and resolve display information. |
| `validateShipStates()` rejects a journey unless the player occupies that ship. | Extract ship movement from player movement so an explicitly commanded generated ship can move independently. Autonomous scheduling remains deferred. |
| Dialogue already retains encounter/completion history; research attempts store location IDs. Research validation/rendering requires a live catalog location. | Historical references need retained identities and fallback labels, independently of operational state. |
| Load reconciliation adds missing authored locations/NPCs. | It must distinguish a new authored spawn from an existing retired/destroyed instance, or it will resurrect entities. |
| Runtime actions clone, execute, reconcile, validate, save, and replace state. | Creation, authority changes, and lifecycle transitions should use this existing atomic boundary. |

Important compatibility detail: passenger navigation of an accessible unowned
ship is intentional and tested. Boarding does not grant cargo/equipment access.
Generic authority must preserve this through an explicit passenger-navigation
policy, rather than accidentally requiring ownership for every operation.

Production content currently grants no ship. Generated-ship integration can be
proved with fixtures without changing the starting game.

## 3. Saved model and identity contract

### Registry structure

Use `state.entities` as the flat ID-to-record map. Use a separate
`state.entityIds` record for the allocator's saved next sequence. Domain slices
remain `state.locations`, `state.npcs`, and existing history/progress records.

Recommended common entity fields:

| Field | Meaning |
| --- | --- |
| `id` | Globally unique within this saved world; immutable and equal to the map key. |
| `type` | Initially `area`, `site`, `ship`, `npc`, or `principal`. Determines supported state and operations. |
| `definition` | Explicit catalog namespace and definition ID, such as a location or NPC definition. May be null only for supported identity-only principals and migrated historical placeholders. |
| `origin` | Authored, generated, or legacy; useful for migration and diagnostics, not gameplay permissions. |
| `lifecycle` | `active`, `inactive`, `destroyed`, or `retired`. |
| `createdAt` | Simulation time of creation. Use zero as the documented legacy baseline; do not invent a historical creation time. |
| `lifecycleChangedAt` | Simulation time of the most recent lifecycle transition. |
| `lifecycleReason` | Optional short reason for the current terminal/inactive state. Not a general event log. |
| `displayName` | Optional per-instance name; falls back to the definition for live entities. |
| `ownerId` | Legal/title owner, or null. Applies only to ownable entity types. |
| `controllerId` | Explicit operational controller, or null for the owner fallback described below. |
| `access` | Small, validated set of public permissions and direct principal grants. No arbitrary policy expressions. |
| `retained` | Terminal/historical label and last-known placement summary when needed. Never interpreted as current position. |

Do not save arbitrary paths such as `statePath`, live object references, compiled
definitions, closures, cached contexts, reverse indexes, or computed permissions.
The fixed type mapping tells queries that ships/sites/areas use `locations[id]`
and NPCs use `npcs[id]`. A principal may be identity-only.

Keep placement canonical in the existing domain state:

- Player: `state.locationId`.
- NPC: `state.npcs[id].locationId`.
- Site or ship: `state.locations[id].areaId`.
- Ship docking/transit: its existing docking and journey fields.
- Area: its own identity and authored coordinates.
- Identity-only faction/corporation: no physical placement required.

Do not also put a writable `locationId` on every registry record. Shared location
queries return immediate location, containing area, and transit/docking details
as applicable. An NPC aboard a travelling ship resolves through that ship; it
does not independently change its own location on arrival. Guard against cycles
and invalid containment types.

### ID allocation

- Preserve current authored runtime IDs (`habitat`, `mira`, `oren`, etc.). An
  authored ID may initially equal its definition ID; the two roles are still
  explicitly distinct.
- Reserve a generated namespace, for example `gen_ship_41`, using one monotonically
  increasing saved sequence. Existing ID validation permits this spelling.
- Generated prefixes aid debugging; never infer type by parsing an ID.
- Allocate inside the candidate transaction. Save failure rolls back both the
  entity and its counter. Reuse after an aborted, uncommitted transaction is fine;
  reuse of a committed identity is forbidden.
- Reject unsafe keys, collisions, mismatched map keys, unknown types, and sequence
  overflow. Validate the counter against persisted generated IDs on load.
- Check authored IDs across location, NPC, and principal namespaces at bootstrap.
  Reject collisions with a clear content error before starting the game.
- IDs are world-local. Cross-save imports or merging worlds require a future
  namespace/remapping design; do not use random IDs or consume research RNG now.

### Which things become entities?

Register current areas, sites, ships, NPCs, and the player principal. Allow
minimal faction/corporation principals as ownership identities without a faction
simulation. An NPC is already an actor identity; do not create a second principal
record for that same NPC.

Resource kinds, recipes, discoveries, dialogue definitions, and equipment
definitions remain catalog IDs. Inventory quantities and the current weighted
equipment groups remain aggregates. Decorative scene objects remain local scene
descriptors unless a later mechanic gives one an independent lifecycle.

A future unique installed machine, wreck, event instance, or trade offer can
become an entity when its owning domain introduces state and reference rules.
Do not add empty `events`, `objects`, or `trades` subsystems now. A future wreck
can be a new site instance associated with a destroyed ship; do not silently
turn the ship's identity into a different entity type.

## 4. Definitions, initial spawns, and runtime resolution

Have content compilation expose reusable definitions separately from an initial
spawn manifest. A spawn entry identifies its authored entity ID, definition,
starting placement, and initial authority. Definitions no longer prove existence.

Adapt current `locationDefinitions.types/locations` and `npcDefinitions` input so
existing content still produces the same initial world. Existing named content
can receive one-to-one definitions initially. Add explicit reusable location/NPC
templates for fixtures and future content without requiring every author to
rewrite all current entries in the first change.

Keep authored placement links bound to initial entity IDs. Template references
resolve in the definition catalog. Reusable templates must receive required
placement/participant bindings at instantiation; they must not accidentally
inherit another instance's docking site or personal dialogue identity.

Creation applies starting inventory/equipment exactly once, resolves bindings,
and validates allowed overrides. Initially support names, placement, authority,
and domain-validated starting assets. Arbitrary structural overrides, functions,
and unvalidated copied definitions are not supported. Template-specific personal
conversations stay personal; generic NPC templates use explicitly shared dialogue
groups and the existing `speaker` binding.

Common read contracts should include:

| Query | Contract |
| --- | --- |
| `getEntity(state, id)` | Return the identity record or no result, including terminal records. |
| `hasEntity(state, id)` | True for any retained identity, including destroyed/retired entities. |
| `isEntityActive(state, id)` | Explicit operational lifecycle test; existence is not usability. |
| `listEntities(state, filters)` | Enumerate instances by type/lifecycle, with explicit defaults. Gameplay lists normally request active entities. |
| `resolveEntityDefinition(...)` | Resolve the declared catalog reference; never look up a definition using runtime ID as an implicit fallback. |
| `getEntityState(...)` | Locate domain state using the fixed type mapping; terminal records may eventually have none. |
| `getEntityLocation(...)` | Return structured placement, including transit, or explicitly no current location. |
| `getEntityLabel(...)` | Resolve instance name, definition label, or retained historical label. |
| `referenceReason(state, targetId, role)` | Explain whether a declared reference role may point to this type/lifecycle; historical and operational references use different roles. |

Mutation entry points should be equally explicit: `createEntity` delegates to a
supported domain constructor; `setEntityOwner`, `setEntityController`, and access
grant/revoke operations enforce authority; `activateEntity`, `deactivateEntity`,
`destroyEntity`, and `retireEntity` use the lifecycle coordinator. These mutate
only a supplied transaction candidate. The low-level identity allocator cannot
create a playable ship without its validated domain state. Multi-entity creation
reserves IDs within one candidate, constructs all participants, binds their
references, and validates the completed batch before commit.

Keep `getLocationContext()` as the transient adapter for storage, crafting, and
equipment. It obtains identity/definition through these resolvers and supplies
actor-specific permissions. It must never be retained across a state commit.

The initial implementation supports generated sites, ships, and NPCs within
existing areas. Authored areas are registered and lifecycle-aware. Generating
new areas and changing network topology is a separate extension: current
`world.links` can remain compiled authored connectivity filtered by active area
identities. Do not imply that a generic identity creation API alone generates a
valid navigable area.

## 5. Ownership, control, and permission semantics

### Three different questions

1. **Who owns this?** Return the title owner, even if another actor controls it.
2. **Who controls this?** Return the explicit controller when set; otherwise the
   owner. An explicit unavailable controller does not silently fall back to the
   owner.
3. **May actor A perform operation B on target C?** Evaluate a named permission,
   lifecycle, and the operation's physical/contextual requirements.

Only supported principal types can own/control assets: player, NPC, or an
identity-only faction/corporation. NPCs and the player are not themselves ownable
property. Do not support arbitrary ownership chains or self-ownership.

Use direct grants to assign permissions to the player or an NPC. An NPC uses its
existing entity identity when acting as a controller; do not create a second
principal record for the same actor.


### Small permission vocabulary

Use named permissions such as `enter`, `dock`, `pilot`, `viewCargo`,
`depositCargo`, `withdrawCargo`, `useFacilities`, `manageEquipment`,
`discardCargo`, `transferOwnership`, `setController`, `manageAccess`, and
`manageLifecycle`. Authorization to request lifecycle management still cannot
override structural blockers or substitute for a future combat/destruction rule.

Recommended baseline policy:

| Permission group | Default source |
| --- | --- |
| Transfer title, appoint controller, manage grants/lifecycle | Active title owner. Controllers cannot grant themselves title or more rights. |
| Pilot, manage equipment, use facilities, view/deposit/withdraw cargo | Active effective controller, or an explicit grant. When no separate controller is appointed, the owner is the effective controller. |
| Discard cargo | Active owner or an explicit discard grant; being a controller alone is insufficient. |
| Enter/board and dock | Explicit public/access policy or a grant, plus existing access conditions and physical constraints. Ownership is not required. |
| Passenger navigation | Explicit ship policy preserving existing passenger-directed travel; does not grant private cargo access. |

When someone else controls an asset, the owner's operational permissions are no
longer implied by title; they may have an explicit grant. The owner retains
administrative rights in this first model. Future hostile occupation can add
physical restrictions to those operations without redefining ownership.

Keep the first access schema to validated allow-lists of permissions for public
use and named principals. No deny hierarchy, nested roles, expression language,
group inheritance, or time-limited contracts yet. Removing a direct grant revokes
that source of access; any owner/controller/public entitlement still applies.

Materialize initial access defaults once when creating an entity. Ownership
transfer defaults to clearing the explicit controller and private grants, so old
delegates do not silently retain access; retaining selected delegation must be
explicit and validated in that same transaction. Preserve the asset's public
policy unless the transfer also requests a policy change. Setting controller to
null deliberately restores owner control; it does not mean "disable this asset."
Changing controller does not transfer title or silently rewrite direct grants.

Use read-only `ownerOf`, `controllerOf`, and `permissionReason`/`canUse` queries.
Every command rechecks authority on the candidate. Querying the UI or knowing an
entity ID is never authorization. Missing, inactive, or terminal actors cannot
exercise permissions. Destroyed/retired targets cannot be used; restoration of
inactive entities is a separate lifecycle management operation.

### Domain checks remain necessary

Authority grants permission; it does not guarantee feasibility. Navigation still
checks docking, route, power, and propulsion. Transfers require withdrawal on the
source and deposit on the destination, plus quantity, distance, and capacity
checks. Crafting/research require facility use and permission to consume the
specific store's resources. Discard still requires the existing explicit amount
and confirmation. Public ship navigation authorizes its propulsion power debit
without authorizing arbitrary withdrawals from its hold.

The resource arithmetic and equipment calculations remain authority-agnostic.
Gameplay command boundaries enforce permissions before calling those primitives.
The browser binds commands to the player; it must not accept a user-supplied
`actorId` as a way to impersonate another actor. Internal future simulation
callers can supply an actor explicitly through trusted domain APIs.

Move canonical `ownerId` out of local state into the entity record. Do not keep
two writable ownership fields. A temporary derived `context.owned` can mean
literal player ownership for labels only. Replace `managedAccess` gating with
operation-specific permissions, including in previews and privacy-sensitive
displays. Global action scope must not exempt an action from authorization.

## 6. Lifecycle and reference rules

### Lifecycle states

| State | Meaning |
| --- | --- |
| `active` | Exists and may participate in supported gameplay operations. Discovery and permissions are still separate checks. |
| `inactive` | Exists, but ordinary simulation/interaction is suspended; state is preserved and reactivation is possible. |
| `destroyed` | Irreversibly destroyed in world terms; identity remains available to history. |
| `retired` | Permanently withdrawn from active use without asserting physical destruction; identity remains. |

Creation is an atomic operation ending in active or explicitly inactive state,
not a persistent half-initialized `created` state. Physical removal is not a
gameplay lifecycle state. Supported transitions are active/inactive in either
direction, and active/inactive to destroyed/retired. Terminal states cannot
reactivate through the normal API. Migrations may repair state explicitly.

Inactive is not a synonym for offscreen, undiscovered, damaged, or disabled
equipment. It suspends the whole entity. An inactive occupied container is
unsafe unless the same operation explicitly resolves its dependents; initially
block that transition. Reject disabling/retiring/destroying the player identity
in this scope because no death/respawn model exists.

Keep terminal domain state frozen in the first release. This preserves cargo,
equipment, flags, and debugging evidence without inventing salvage or liquidation
rules. Exclude it from normal simulation and interaction. Retaining identity and
assets is safer than generic deletion; later compaction can shrink terminal
state under explicit per-domain retention policies.

### References are declared by the owning system

Introduce explicit reference collectors composed in `bootstrap.js`. Each system
enumerates its own known entity-reference fields with source, target, role,
expected target types, allowed lifecycle, and transition policy. Root-level
references use a descriptive source path rather than requiring a fictitious
source entity.

Do not scan every string ending in `Id`: definition IDs, recipe IDs, flag keys,
dialogue node IDs, and entity IDs are different things. Do not persist a second
copy of every reference in a reverse-reference graph. Build reverse lookups from
current state when validating or assessing a transition. Add a disposable index
only if measured scale requires one.

Initial reference inventory and policy:

| Reference | Policy when target becomes unavailable |
| --- | --- |
| Player location; NPC location; site/ship area membership | Structural dependency. Block transition until occupants/children are moved or explicitly transitioned together. No silent teleport or recursive destruction. |
| Ship docking target | Block until the ship is safely undocked or otherwise resolved by navigation. |
| Journey destination/origin | Block until navigation explicitly cancels or reroutes the journey with a valid final placement. No arbitrary nearest destination. |
| Active dialogue NPC/location | Close contact within the same candidate, preserving met/completion/choice history. |
| Owner | May reference a retained identity. Loss of the owner does not make its property unowned. No automatic succession or player claim. |
| Controller and permission grantee | Identity may remain referenced, but grants/control are ineffective while the actor is unavailable. Retain the explicit controller rather than silently falling back to owner. |
| Dialogue met/history and research attempt location | Historical reference. Retain target identity/label; allow inactive and terminal targets. |
| Authored conditions, effects, and initial placements targeting named entities | Compiler reports these explicitly. Allow terminal identity where meaningful; operational effects fail cleanly if their target is unavailable. Content references do not resurrect entities. |
| Map selection, roster selection, drafts | Presentation-only references. Clear/recompute after commit; never a reason to corrupt or block a save. |

Flags remain opaque boolean facts. NPC/location flag reads for a terminal entity
use preserved state as historical facts; they do not imply current presence or
usability. Writes require an eligible live target. A future flag compaction
policy must account for authored conditions before removing this state.

Future domains add their own collectors when introduced. A trade offer may
cancel on ship loss while a ledger keeps a historical reference, but this plan
does not create either system. The lifecycle service must not acquire special
knowledge of their schemas.

### Safe transition protocol

Expose `previewEntityTransition` returning affected references, blockers, and
required domain resolutions. Expose a command-side transition operation that
recomputes this assessment on the candidate; a preview is never a reservation.

The ordered transition is:

1. Resolve identity, transition eligibility, actor authority where applicable,
   and all declared affected references.
2. Apply only explicitly requested domain resolutions, such as NPC relocation
   or journey cancellation. Check their own preconditions and costs.
3. Update lifecycle and capture retained identity/last-known placement. Close
   affected contact and invalidate operational access.
4. Validate the resulting registry, domain slices, and references; save and
   commit through the existing runtime. Failure discards the entire candidate.

Do not create broad cascade-delete behavior. The foundational generic operation
can reject destruction of an occupied ship until a gameplay system supplies an
explicit evacuation/destruction policy. That is a useful supported outcome.

Do not expose hard deletion in the initial public API. A future purge would
require a terminal entity, no inbound live/historical/content references, no
unresolved assets, and permanently reserved IDs. Tombstones remain the default.
Answer "can it safely be deleted?" with structured blockers and a recommendation
to retire it; do not return true merely because it is absent from the map.

## 7. Module boundaries and integration work

| Module | Responsibility/change |
| --- | --- |
| New `entities.js` | Identity primitives, allocation, basic registry shape/type/lifecycle checks. No imports of gameplay domains or browser code. |
| New `entityQueries.js` | Read resolution of definitions, labels, placement, and state through explicit type mappings. No mutations. |
| New `authority.js` | Principal checks, owner/controller queries, permission evaluation, validated authority mutations. Depends on identity, not locations/ships. |
| New `entityReferences.js` | Reference descriptors, common validation and reverse lookup over explicitly supplied collectors. |
| New `entityLifecycle.js` | Coordinate creation/transition policies through explicitly supplied domain functions. No automatic plugin hooks. |
| `bootstrap.js` | Compose definition resolvers, supported domain constructors/validators, and reference collectors once. Preserve action linking order. |
| `stateCore.js`, `state.js` | Versioned initialization, migration, registry-first validation and compatibility wrappers. |
| `locations.js`, `ships.js`, `npcs.js` | Own domain state and placement changes; resolve instances through shared queries; expose creation/transition support. |
| `playerActions.js`, action factories | Shared permission checks and runtime-target payloads; candidate-side revalidation. |
| `dialogue.js`, `peopleSystem.js` | Resolve NPC definition through instance; use runtime ID for history/session identity; reconcile lifecycle without deleting history. |
| `research/` | Active location resolution for experiments, historical resolution for attempts, permission-based access and live site eligibility. |
| `game.js`, `runtime.js` | Advance active instances only; retain production → journey → contact order. Structural changes require validation and saved commit. |
| Displays and `app.js` | Use instance read models and permission reasons; avoid direct catalog identity assumptions and inaccurate "Unowned" labels. |

A small explicit mapping of supported types to domain constructors and validators
is sufficient. It is not a generic component framework. Domain modules must not
import the lifecycle coordinator back through this mapping; the composition
root supplies dependencies to avoid cycles.

### Actions and navigation

Register stable operations once, such as board, travel, dock, disembark, and scene
inspection. Carry runtime target IDs in validated payloads. Derive available
targets and labels from the current candidate/read state.

Preserve existing textual commands such as `board:courier` through a command
adapter that resolves them to a stable action plus payload; update the command
resolution/dispatch contract and all callers together. Do not register actions
as a side effect of spawning an entity, since action registry mutations would
survive a failed state save.

Definitions retain linked action collections and local scene descriptors.
Runtime instances inherit eligibility from their definition. Inspection payloads
include the instance ID and its valid local scene key. Research eligibility must
be a live site/permission check, not a startup snapshot of site IDs. Continue to
reject ambiguous names and invalid local commands.

Extract ship journey operations to accept an explicit ship ID and authorized
actor. The player navigation wrapper still handles boarding/disembarking and
the existing local interaction rules. A ship journey updates that ship, never
the player's location merely because it finishes. Replace the "player must be
aboard every moving ship" validation with entity/placement/journey invariants.
This enables scripted API tests and later NPC callers; it adds no autonomous AI.

## 8. Save migration and content evolution

Reserve the next save version, provisionally version eight. Recheck the actual
latest version when implementation starts so concurrent work does not collide.
Ship the complete compatible behavior as one save upgrade; intermediate work
must not publish half-migrated saves.

Migration sequence:

1. For versions one through six, run the existing historical conversions to a
   validated version-seven shape, preserving frozen storage conversion rules.
   Keep legacy validation separate from the new current-version validator.
2. Clone the version-seven save. Build registry entries for saved authored
   locations/NPCs and the player, preserving existing runtime IDs.
3. Move local ownership into the registry. Set controller to null so legacy
   owners remain effective controllers. Preserve public entry/docking/passenger
   behavior through compiled compatibility policies. Do not grant public cargo
   management.
4. For valid legacy owner strings with no actor identity, create an explicit
   inert legacy principal with the original ID, no operational credentials, and
   a migration notice. Do not guess that it is a particular faction. Reject
   ambiguous collisions with non-principal entities rather than changing title.
   Principal records distinguish player, organization, and legacy roles; the
   legacy role cannot act until an explicit content migration resolves it.
5. Build terminal legacy identity placeholders for well-formed dialogue history
   references that version seven allowed without a current NPC/location. Only
   migrate known historical fields; do not normalize arbitrary invalid active
   references. Use the ID as label when no historical name is available.
6. Initialize the allocator, timestamps, lifecycle, definition references, and
   retained labels as needed. Preserve resources, equipment, flags, journeys,
   knowledge, research RNG/progress, and dialogue session counters/history.
7. Reconcile newly authored spawns only when their fixed entity ID has never
   existed. Existing inactive/terminal entries are never reseeded. New item
   definitions still start empty in existing stores, as they do today.
8. Validate identity/type/state correspondence, definitions, quantities,
   references, authority, and player placement. Persist the upgraded save before
   startup using the current failure-preserves-old-save behavior.

For version-eight reloads, registry entries are authoritative: an active entity
with missing domain state is corruption, not an invitation to replay initial
grants. Domain state without a corresponding identity is also invalid.

If an active/inactive entity's definition is removed, preserve the save and fail
with an explicit migration/compatibility error. Do not silently retire it or
discard assets. Terminal identity/label/history resolution must work without
the original definition; retained payloads receive domain-appropriate structural
checks without being treated as usable live stores. Retirement of an item or
recipe definition remains a separate content-compatibility concern.

Definition changes that invalidate live state require explicit migrations or
retained compatible definitions. Cosmetic labels may resolve through current
content; new history entries should snapshot their display labels when exact
historical wording matters. None of this requires serializing whole catalogs.

## 9. Implementation sequence and exit criteria

### Phase 1 — Identity, definition resolution, and migration foundation

Add registry/allocator primitives, principal identities, spawn manifest output,
type-to-state resolution, and isolated version-seven-to-eight migration. Adapt
initialization/validation with no production content or balance changes. Keep
the upgrade unreleased until subsequent integration phases pass.

Exit: two instances may share a definition while retaining independent IDs and
state; current authored saves retain their assets/history; global ID collisions
fail clearly; failed creation/save cannot consume a committed identity.

### Phase 2 — Authority and existing behavior

Move ownership to the registry; implement the permission vocabulary and direct
grants. Replace direct ownership checks in action execution, crafting, transfers,
discard, research, and displays. Adapt legacy passenger navigation and public
access explicitly. Keep domain arithmetic unchanged.

Exit: an NPC can control a player-owned ship without becoming its owner; owner,
controller, guest, and unauthorized actor receive distinct correct permissions;
existing player-owned management and passenger travel tests still pass.

### Phase 3 — Runtime instances across gameplay

Convert maps, rosters, contexts, dialogue, research site assignment, and action
dispatch to instance queries and runtime payloads. Add supported creation APIs
for sites/ships/NPCs in existing areas. Make ship journey commands independent
of player occupation while preserving the player-facing wrapper.

Exit: a generated ship and NPC absent from the initial spawn manifest appear in
normal views, can be interacted with through normal commands, and survive reload
without catalog mutation, action re-registration, or duplicated starting grants.

### Phase 4 — Lifecycle, references, and historical resilience

Add explicit collectors, transition previews, blockers, domain resolutions, and
contact/history integration. Filter simulation and gameplay queries by lifecycle.
Retain terminal identities and freeze their domain state. Remove any remaining
"catalog membership equals existence" assumptions from runtime callers.

Exit: retiring a referenced NPC closes dialogue but preserves history; retiring
an occupied/docked-at/journey-target site is rejected with specific blockers;
resolved transitions commit atomically; research history remains readable at a
terminal site; reload never resurrects an entity.

### Phase 5 — Release verification and documentation

Run focused new suites, then the existing unit and browser suites. Update
`ARCHITECTURE.md`, location/ship/NPC authoring guides, and action documentation
with definition/instance binding, authority, reference ownership, and migration
rules. Release the save upgrade only after the integrated scenarios pass.

## 10. Verification matrix

| Area | Required proof |
| --- | --- |
| Identity | Independent instances from one template; allocator persistence/overflow/collision handling; unsafe keys rejected; tombstone ID never reused. |
| State ownership | One ship cargo store; no duplicated position/ownership; correct type-to-state correspondence; generated state survives reload. |
| Runtime integration | Generated site in map/transfer options; generated NPC in roster/dialogue; generated ship navigation and local scene actions; generated site research eligibility. |
| Authority | Different owner/controller; owner fallback; unavailable controller does not restore implicit owner control; public boarding/passenger travel without cargo access; source withdrawal and destination deposit; no forged actor payload. |
| Privacy/commands | View/execution permission parity; grants revoked after preview; global actions cannot bypass authority; stale target IDs fail cleanly. |
| Lifecycle | Inactive entities stop advancing; terminal entities cannot interact; player/occupancy blockers; no silent cascades; reactivation only for inactive entities. |
| References/history | Dialogue closure and met/completion retention; research at a retired site; owner identity retained; voyage origin/destination and docking dependencies enumerated; presentation selections clear safely. |
| Transactions | Creation plus asset setup, ownership change, relocation plus retirement, and contact closure all roll back on validation/save failure; no leaked catalog/action-registry changes. |
| Migration | Supported versions 1–7, known legacy owner IDs, dangling historical-only dialogue references, overloaded stock, active journeys, research RNG/contracts, idempotent current-version reload, no replayed grants or resurrection. |
| Content changes | Missing live definition preserves old save and reports error; terminal labels/history still resolve; authored ID collision or incompatible definition change cannot silently remap entities. |
| Regression | Existing storage precision/capacity, equipment, crafting, research, dialogue, local access, navigation, browser focus and failure behavior remain covered. |

Suggested suites: `entities.test.mjs`, `authority.test.mjs`,
`entityLifecycle.test.mjs`, and `entityMigration.test.mjs`, plus additions to the
existing domain and browser suites. Use the production bootstrap and runtime for
the end-to-end fixture, not a parallel test-only creation/commit implementation.

The final acceptance scenario is deterministic: create a named ship and NPC from
reusable definitions in an existing area; assign different owner/controller;
interact and move through normal systems; save/reload; preview and resolve a
lifecycle transition; confirm retained history and absence of further simulation.
No event director or procedural RNG is necessary to prove the foundation.

## 11. Explicitly deferred

Event instances/director, weighted spawning, world RNG, NPC goals, autonomous
decision scheduling, trade/contracts, conflict/capture/succession, factions beyond
identity, individual equipment instances, arbitrary nested containers, generated
area topology, offscreen simulation tiers, hard deletion, and terminal-state
compaction are outside this implementation.

The foundation is complete when new instances use existing systems through
stable identity, authority, and lifecycle contracts. Merely adding an unused
`state.entities` dictionary would not meet that acceptance criterion.
