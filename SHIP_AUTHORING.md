# Adding ships

Add one entry to `locationDefinitions.locations` in `js/locationContent.js`.
Ships reuse the location catalog and domain state, with identity in the shared entity registry. No map edits, action registration, or new save version is needed for an additional vessel.

This page describes **legacy authored ships**. Player-assembled ships use the
`modularVessel` template and physical module Products; see
[Modular vessel authoring](VESSEL_AUTHORING.md). Their dry-mass, dedicated-fuel,
boarding and remote-command rules differ from the legacy power-only example below.

For reusable ship templates and runtime creation, see [ENTITY_AUTHORING.md](ENTITY_AUTHORING.md). Generated vessels use the same navigation, cargo, equipment, and map systems.

```js
courier07: {
  name: "Courier 07",
  type: "ship",
  areaId: "vicinity",
  initialDockedAtId: "habitat",
  remoteDescription: "A compact courier with reinforced cargo racks.",
  description: "A flight console overlooks the cargo hold.",
  storage: { capacityM3: 1.2 },
  capacities: { power: 30 },
  initialResources: { power: 10 },
  initialInfrastructure: {
    engine: { quantity: 1 },
    solar: { quantity: 1 }
  }
}
```

This example describes an unowned ship. `initialOwnerId: "player"` would grant
ownership when the record is first created. Acquisition and starting ship grants
are outside this authored-ship example; production now permits player-built modular ships.
Tests still add owned and unowned legacy ships without changing production content.

Each entry is one persistent vessel with a stable ID. Keep descriptions independent
of its changing position: the map appends current docking or journey information.

## Fields and defaults

All ordinary location fields work: names/descriptions, capacities, starting assets,
owner, actions, action collections, scenes, discovery conditions, and access
conditions. See [LOCATION_AUTHORING.md](LOCATION_AUTHORING.md) for their merging
and condition rules. Each ship gets independent inventory, equipment, power, flags,
and progress. A nearby fabricator does not enable crafting aboard it.

The existing `ship` template supplies:

| Field | Default | Meaning |
| --- | --- | --- |
| `storage.capacityM3` | `0.2` | Shared usable cargo capacity; excludes installed equipment and power |
| `mobile` | `true` | Enables ship behavior on this site |
| `initialDockedAtId` | `null` | Starting stationary docking site; must share the authored area |
| `propulsionCapability` | `"propulsion"` | Capability required on operational local engines |
| `localTravelPowerCost` | `1` | Power paid when an approach-and-dock journey starts |
| `areaTravelPowerCost` | `5` | Power paid when an adjacent-area journey starts |
| `localTravelDistance` | `10` | Authored abstract approach distance within an area |
| `travelSpeed` | `1` | Multiplier applied to the ship's operational engine speed |
| `actionSets` | `crafting`, `equipment` | Shared local management actions, subject to named permissions and requirements |

Override fields directly on the vessel. Movement costs must be finite and
nonnegative; distance and speed multiplier must be finite and positive. Zero
power cost is supported. No equipment is granted automatically by the template.
Boarding is free; `boardingCost` is deliberately rejected until an economy system
defines payment. Omitted ownership means unowned, not inaccessible.

The `engine` infrastructure supplies propulsion and 10 distance units per second
at full health. It has no idle power demand. Add a solar array or another existing
generator explicitly if the ship should recharge independently. Ships without
generation can exhaust their reserve and require an eligible power transfer.

To make a freighter, override `storage.capacityM3` (for example, `2`). To make a workshop ship, add
`fabricator: { quantity: 1 }` to its initial infrastructure. To make a faster ship,
increase `travelSpeed` or install more/faster engines. Repeated configurations may
use another self-contained type with `kind: "site"` and `mobile: true`, supplying
the same required navigation fields. Types have no inheritance chains.

## Journey timing and power

Cargo does not affect speed or power costs. A ship's resources stay in its one location
record during boarding, docking, and travel. Overload does not block navigation;
ordinary cross-location transfers remain prohibited during journeys. Confirmed discard
of stored cargo is available aboard an owned ship even while travelling. Installed
equipment and utility power cannot be discarded through this action.

Travel is point-to-point. Area distance is the Euclidean distance between authored
area coordinates; links use the existing inclusive connection threshold. Local
approaches use `localTravelDistance`, not the map's decorative site layout.

Effective speed is the ship's `travelSpeed` multiplier times the sum of operational
matching engines' `(travelSpeed + installed upgrade bonuses) × quantity × health`.
Disabled, absent, and zero-health engines contribute nothing. Infrastructure
definitions may specify nonnegative `travelSpeed`; product upgrades may specify
nonnegative `travelSpeedBonus` alongside their existing `powerBonus` field.

Journey duration is distance divided by effective speed. The full power cost is
paid once at departure. Duration is fixed at departure; subsequent engine damage,
disabling, installation, or upgrades affect the next journey. Power generation and
owned local crafting continue during travel. There is no cancellation/refund or
midflight engine-failure simulation in this version.

Remaining journey time advances only through the visible-page simulation. Closing,
reloading, or hiding the page grants no travel or power progress. Reload restores
the saved remaining time. Arrival updates area or docking state and is saved
before arrival narrative or tab changes are displayed. Save failure pauses
simulation without committing the arrival; restore save access and execute a
valid action, or reload, to resume.

## Boarding, access, and navigation

Boarding requires a known ship docked at the player's exact stationary site,
with its entry permission and `accessConditions` satisfied. Ownership is not required. Under the default passenger-navigation policy, a passenger may
choose destinations and use that ship's propulsion and travel power. This does
not grant inventory, fabrication, equipment-management, or cargo-transfer access.
Asset views without `viewCargo` permission are cleared and marked private.

The normal sequence is Board → Undock → Travel to area (if needed) → Approach and
dock → Disembark. Boarding, undocking, and disembarking are immediate and free.
Approaching/docking and area crossings take time. The player stays at the same
ship location ID until disembarking. No direct site-to-site or player-to-area
travel remains. The player interface remains local. Trusted domain navigation accepts an explicit ship and actor ID, allowing authorized unoccupied journeys. Ship-to-ship docking is unsupported.

Runtime command bindings preserve `board:<shipId>`, `undock`, `travel:<areaId>`,
`dock:<siteId>`, and `disembark:<siteId>`. The map chooses the appropriate action
and shows the duration, power cost, or blocking reason. Destination access is
checked before departure and again before disembarking; accepted journeys finish
even if an entry condition changes en route.

While travelling, the map shows the ship at its departure area with an explicit
"En route" description. Its new area/dock is committed on arrival. No boarding,
disembarking, second journey, or cargo transfer is allowed in transit.

Outside transit, transfers retain their existing same-area policy: two owned,
known endpoints, one occupied by the player, sufficient stock and receiving space.
Docking is required for player passage, not for cargo transfers.

## Saves and extension boundaries

Version four adds `dockedAtId` and `journey` to mobile location records. A journey
stores its kind (`area` or `dock`), origin area, target ID, duration, and remaining
time. It never duplicates the ship's inventory or equipment. Areas are no longer
valid occupied player locations.

Version 1/2/3 progress migrates without ship grants. Existing ship-like records
gain undocked, idle state without changing their assets or position. Old area
positions map explicitly from `vicinity` to `habitat` and `outerReach` to `derelict`,
only when the destination is known, accessible, and in the same saved area. Missing
valid mappings fail without overwriting the save.

Version eight gives every vessel an entity identity and moves ownership/control to that record. Adding a new authored vessel creates its record only when its ID has never existed; inactive and terminal vessels are never respawned. Changing starting values
does not replenish, move, or change ownership of an existing vessel. Renaming or
removing IDs, changing mobile status, removing an active route, or lowering utility capacity
below saved holdings requires an explicit migration decision.

Names, capacities, loadouts, speed, costs, and existing actions are content changes.
New mechanics such as jump drives, paid fares, automated routing, acquisition, or
ship-to-ship docking require shared behavior first. They are not silently enabled
by adding unimplemented metadata.
