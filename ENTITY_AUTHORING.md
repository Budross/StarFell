# Persistent entities and authority

Version-eight saves separate reusable definitions from persistent instances.
`state.entities[id]` is the identity/lifecycle/authority record; `state.locations[id]`
and `state.npcs[id]` retain domain state. Ships still use the location store and
equipment system. Neither catalog membership nor a definition ID proves that an
instance exists.

Player-built modular vessels are still ordinary `ship` entities. The trusted
`modularVessel` template must be created with a valid `assembly` of physical
Product module IDs and placements; a shell without assembly is invalid. It starts
at the actual Shipyard berth, with private player owner/controller and empty
cargo, tank and power. Assembly-owned equipment membership is reconstructed from
composition while condition persists. Current module definitions determine live
geometry/capacity and autonomous boarding feasibility. Retired vessels retain
syntactic composition and catalog-independent assembly history. See
[VESSEL_AUTHORING.md](VESSEL_AUTHORING.md) for the full contract.

## Definitions and initial instances

Existing `locationDefinitions.locations` and `npcDefinitions` entries still
create authored instances with their existing IDs. Compilers expose a separate
`initialSpawns` manifest, consumed only by initialization/content reconciliation.
Destroyed or retired entries remain in the registry and are never spawned again.
Site/ship/NPC definitions may declare `initialLifecycle: "inactive"`; omission
means `"active"`. This applies only to new initial instances, including new
content added on reload. Existing saved lifecycle is preserved. Areas and the
starting site must be active. Placements and docks must reference active instances.

Reusable location templates belong in `locationDefinitions.templates`. They use
the same inherited `type`, storage, equipment, action collections, scenes, and
navigation metadata as authored locations. They do not create initial instances.
Placement is required when instantiating a template.

```js
// In locationDefinitions, alongside types and locations:
templates: {
  lightFreighter: {
    type: "ship",
    name: "Light freighter",
    description: "A compact commercial freighter.",
    remoteDescription: "A compact freighter.",
    storage: { capacityM3: 2 },
    initialResources: { power: 20 },
    initialInfrastructure: { engine: { quantity: 1 } },
    initialAccess: { public: ["enter", "dock"], grants: {} }
  }
}
```

Reusable NPC definitions use `spawn: false`. Supply shared dialogue groups;
personal conversations with hard-coded named participants do not automatically
become generic conversations. The existing `speaker` binding resolves the actual
runtime NPC. Generated NPC creation deliberately requires an explicit template.

```js
merchant: {
  spawn: false,
  name: "Merchant",
  description: "A visiting merchant.",
  initialInventory: { scrap: 0.02 },
  inventoryCapacities: { scrap: 0.2 },
  dialogueGroups: ["habitatCrew"]
}
```

Author starting bulk quantities in mÂ³ as usual. Runtime creation overrides use
compiled internal units: integer cubic centimetres for bulk, integer counts for
manufactured items, and numeric power. Initial cargo must fit; later saves can
retain overload under existing storage rules.

## Creating entities

Use `createEntity(candidate, systems, spec)` or
`createEntities(candidate, systems, specs)` from `js/entityCreation.js` inside a
saved runtime action. These are trusted domain APIs, not player command payloads.
They never mutate catalogs or register actions. Any exception must abort the
candidate; do not catch a failed domain mutation and then commit that candidate.

```js
import { createEntities } from "./entityCreation.js";

let shipId, captainId;
runtime.applyAction(candidate => {
  [shipId, captainId] = createEntities(candidate, systems, [
    {
      key: "ship", type: "ship", definitionId: "lightFreighter",
      displayName: "Carina's Wake", areaId: "vicinity",
      dockedAtId: "habitat", ownerId: "player",
      controllerId: { ref: "captain" }
    },
    {
      key: "captain", type: "npc", definitionId: "merchant",
      displayName: "Edda", locationId: { ref: "ship" }
    }
  ]);
  return "A freighter and its captain have arrived.";
});
```

Batch `key` values are temporary bindings. `{ ref: "key" }` binds placement,
ownership, or control to another participant in the same batch. The saved fields
contain only resolved entity IDs. All participants are validated together.

Supported generated types are `site`, `ship`, `npc`, and identity-only
`principal`. Sites/ships require an existing active area; NPCs require an active
site/ship. An organization principal requires a `displayName` and has no location
or NPC definition. Creation supports explicit initial `active`/`inactive` lifecycle,
names, authority/access, and validated domain asset overrides. Arbitrary domain
fields are rejected. Generated areas and navigation topology are deferred.

IDs use a saved monotonic sequence, for example `gen_ship_41`. Never parse an ID
to decide its type. Never assign an ID manually, reuse a terminal ID, or consume
research RNG to generate one. Failed transactions roll back allocation as well
as entity state.

## Spawning and activation from content

Any supported trigger may author a creation effect:

```js
effects: [{
  type: "spawnEntity",
  spec: {
    type: "ship", definitionId: "lightFreighter", displayName: "Carina's Wake",
    areaId: "vicinity", dockedAtId: "current", ownerId: "player",
    resources: { power: 20, scrap: 0.02 },
    infrastructure: { engine: { quantity: 1, health: 1 } },
    lifecycle: "active"
  }
}]
```

The descriptor accepts `type`, `definitionId`, `displayName`, `lifecycle`,
`ownerId`, `controllerId`, `access`, and type-appropriate fields: site/ship
`areaId`, `resources`, `infrastructure`; ship `dockedAtId`; NPC `locationId`,
`inventory`. Organization principals require a name and omit `definitionId`.
Actors cannot be owned. Generated NPCs require `spawn: false` templates.
Location definitions may be reusable templates or existing compatible definitions;
spawning always allocates a new identity rather than modifying an authored one.

Effect quantities are authored m³ for bulk resources and whole counts for items;
compilation converts them exactly once. This differs from the trusted runtime APIs
above, which receive internal units. Resources/equipment override corresponding
initial values; NPC `inventory` replaces the initial inventory. Fresh cargo must fit,
NPC inventory limits remain enforced, and placement targets must be active.

`current` resolves to the captured trigger location for location/dock fields;
`speaker` resolves to the captured dialogue NPC for owner/controller or permission
grants. Type-incompatible aliases and `speaker` outside dialogue fail compilation.
There are no `key`, `{ ref: ... }`, or named-result bindings in authored effects.
Initialize a spawned entity's cargo/equipment directly in its spec. The descriptor
never accepts player-supplied specs, registers per-instance actions, or consumes
research RNG. Failed effects or saves restore the identity counter and all assets.
Choose trigger completion/repetition rules deliberately: repeatable triggers can
create another entity on every successful use.

Use `{ type: "activateEntity", targetId, reason? }` for an existing inactive entity,
or `{ type: "activateLocation", targetId, reason? }` for a site/ship. These preserve
identity, cargo, equipment, authority, and history. They reject terminal, already
active, player, and blocked-placement transitions. Deactivation retains existing
occupancy/journey blockers. Effects cannot force eviction or resurrect terminal IDs.

## Reading entities

| API | Meaning |
| --- | --- |
| `getEntity(state, id)`, `hasEntity(state, id)` | Look up identity, including terminal identities. |
| `isEntityActive(state, id)` | Test operational lifecycle. |
| `listEntities(state, { types, lifecycle })` | Filter identities; the default includes all lifecycle states. |
| `resolveEntityDefinition(state, systems, id)` | Resolve the explicit definition namespace/ID. |
| `getEntityState(state, id)` | Locate domain state without saving an arbitrary object path. |
| `getEntityLabel(state, systems, id)` | Instance name, definition label, or retained historical label. |
| `getEntityLocation(state, id)` | Immediate location, area, docking and journey details as applicable. |
| `locationInstances(state, world)`, `npcInstances(state, people)` | Active instance projections for ordinary views. |

Identity queries live in `entities.js`; definition/state/placement projections
live in `entityQueries.js`. Missing or terminal entities have no current location.
Their `retained.location` is a historical snapshot. NPCs aboard a ship resolve
their containing area/transit through the ship. Organization principals need no
physical location. Keep canonical placement in the existing domain slice.

Resolve contexts afresh for every candidate. `getLocationContext()` returns a
transient store and read projection; it is not saved and must not cross commits.

## Owner, controller, and permissions

`ownerId` and `controllerId` belong only to the registry. Do not write local
`ownerId` fields. `context.owned` is a literal title-ownership label, not a
permission test.

`ownerOf` returns title ownership. `controllerOf` returns the explicit controller
or, if null, the owner. An unavailable explicit controller does not restore owner
control automatically. The player, NPCs, and organization principals may act;
legacy unresolved principals cannot. Actors themselves cannot be owned.

Declare authored organization identities through
`buildGameSystems({ principals: { corporation: { name: "Collector Corporation" } } })`.
An organization identity does not implement membership, allegiance, inheritance,
or faction simulation.

`authority.js` provides `canUse`, `permissionReason`, `setEntityOwner`,
`setEntityController`, and `setEntityAccess`. Mutations require an authorized
actor and run on the same saved candidate as gameplay.

| Permissions | Default entitlement |
| --- | --- |
| `transferOwnership`, `setController`, `manageAccess`, `manageLifecycle`, `discardCargo` | Active title owner. |
| `enter`, `dock`, `pilot`, `viewCargo`, `depositCargo`, `withdrawCargo`, `useFacilities`, `manageEquipment` | Active effective controller. |
| Any named permission | Explicit direct grant or public policy, subject to lifecycle and domain rules. |
| `passengerNavigation` | Explicit ship policy; permits occupied passenger-directed navigation and its propulsion power debit only. |

Default location policies preserve public entry/docking and the existing ship
passenger-navigation behavior. Override `initialAccess` to author restricted
ships/sites. Policies have only `public` permission lists and `grants` mapping
principal IDs to permission lists. They are materialized once, not reapplied on
load. Inactive or terminal actors cannot use their grants. Ordinary permissions
require active targets; lifecycle management can reactivate an inactive target.

```js
runtime.applyAction(candidate => {
  setEntityAccess(candidate, shipId, {
    public: ["enter", "dock"],
    grants: { player: ["viewCargo", "depositCargo"] }
  }, "player"); // The title owner may manage grants; control alone does not suffice.
});
```

Ownership transfer clears private grants and explicit control by default.
`setEntityOwner(..., actorId, { retainDelegation: true })` explicitly preserves
them. Public policy remains unchanged. Setting controller to null deliberately
restores owner control. `setEntityAccess` replaces the complete policy; omit a
grant to revoke that source of access.

Transfers require withdrawal on the source and deposit on the destination;
crafting requires facility use plus resource withdrawal/deposit; research requires
facility use, withdrawal, and cargo visibility. Discard requires its separate
permission and the existing amount/confirmation. Permission does not bypass route,
position, equipment, inventory, capacity, or knowledge requirements.

Gameplay commands declare a `permissions` list. Legacy `access: "managed"`
defaults to facility/withdrawal/deposit checks; global scope is not an exemption.
Player commands always act as the player and reject `actorId` payloads. Trusted
navigation and transfer domain calls accept explicit actor IDs. Arithmetic helpers
remain independent of authority; call them only after command/domain checks.

### Processing authority

The [Processing implementation plan](PROCESSING_SYSTEM_IMPLEMENTATION_PLAN.md)
reuses these permissions. An equipment manager (`manageEquipment`) may abort any
run on the host. A run initiator may abort their own run while they still have
`useFacilities` there. Initiator identity alone grants no lasting access; another
ordinary facility user cannot abort that batch. Active actor/host requirements,
controller defaults, and grants remain those of `canUse`; no new permission is
introduced. Player controls also require the occupied host.

This is a domain OR rule, not a list of required permissions: the action registry's
flat list requires every entry, so the abort action uses its existing
`requirement` callback and the shared Processing abort preview/operation. Neither
abort branch needs withdrawal/deposit rights because no material is refunded.
Automatic delivery remains an accepted host-internal deposit, independent of the
initiator's later grants or machine health; explicit unload controls, if added,
must check current host access and `depositCargo`. Working equipment requirements
remain separate from authority. These contracts are implemented in Processing and its local Workshop controls.

## Lifecycle and references

`entityLifecycle.js` exports `previewEntityTransition`, `transitionEntity`,
`activateEntity`, `deactivateEntity`, `destroyEntity`, `retireEntity`, and
`deletionAssessment`.

Active and inactive may transition in either direction. Either may become
destroyed or retired. Terminal states cannot reactivate. Player death/respawn is
not implemented, so changing the player identity's lifecycle is rejected.

Inactive entities stop ordinary simulation/interaction. Terminal identities and
their frozen domain state remain saved; cargo, equipment, flags, and historical
references are not deleted. Retirement is not an automatic salvage or liquidation
operation. Terminal-state compaction and hard deletion are deferred.

Preview returns references and blockers, without reserving the result. The actual
transition recomputes the checks on the current candidate. Occupants, docking,
area membership, and journey dependencies block an unsafe transition. Resolve
them explicitly in their owning domains in the same transaction:

```js
runtime.applyAction(candidate => {
  relocateNpc(candidate, captainId, "habitat", systems.people);
  if (candidate.locations[shipId].journey) cancelJourney(candidate, shipId); // No refund.
  retireEntity(candidate, shipId, systems, { reason: "Withdrawn from service" });
});
```

The example assumes no player/other occupants remain aboard and all other
blockers have been resolved. Cancellation retains the represented departure-area
position. There is no automatic teleport, nearest-safe-place selection, cascade
destruction, or authority succession.

Lifecycle functions are trusted orchestration APIs. Passing `actorId` also checks
that actor's `manageLifecycle` permission; ordinary user-facing commands must
supply the player. Omission is for internal world/domain operations, not for
forwarding user-supplied lifecycle payloads.

Active contact closes on loss of the NPC/location; met/completion/history records
remain. Research journal entries retain runtime location IDs and display labels.
An absent live definition fails loading without overwriting the save. Terminal
identities and history remain readable without that definition.

Each domain exports a collector for its known saved entity-reference fields.
Compilers report `entityReferences` from their own content schemas. Composition
combines these in `entityComposition.js`/`bootstrap.js`. Reference roles specify
target types, allowed lifecycle states, and block/close/retain policy. Use
`referenceReason`, `referencesTo`, or the transition preview to inspect them.
Do not scan arbitrary strings or persist a reverse-reference graph. When adding a
domain, add its collector explicitly to composition and its state validator.

## Runtime commands and migration

Board/travel/dock/disembark and scene-inspection operations register once. Live
`targets` projections bind IDs and payloads without modifying the action registry.
Both `executeAction("board", { targetId: shipId })` and the existing
`board:<entityId>` command spelling work. `inspectScene` accepts `targetId` and
`sceneId`; old `inspect:<entityId>:<sceneId>` commands remain supported. Names
resolve against current instances, and ambiguous names require a full ID.

Explicit ship journey calls accept a ship ID and authorized actor independently
of player occupation. Arrivals update that ship, not the player's location.
Autonomous scheduling, event generation, and AI goals remain future work.

Versions one through six first run their historical storage/research migrations
to version seven; version seven then gains registry identities and authority.
Version-eight reconciliation adds only new authored spawn IDs and empty entries
for newly defined resource/equipment kinds. It never refills stores or recreates
a terminal entity. Migration failures preserve the original save.

Run `node --test tests/*.test.mjs` and, with Playwright available,
`node --test tests/terminalTabs.browser.mjs`. New entity, authority, lifecycle,
migration, and browser fixtures exercise the production composition/transactions.
