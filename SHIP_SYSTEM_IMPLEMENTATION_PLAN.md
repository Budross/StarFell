# Ship system — implementation plan

Status: implemented and verified. The latest confirmed rules are timed journeys,
free permitted boarding of owned or unowned ships, and passenger navigation without
unowned asset access. Ship acquisition and boarding fees remain outside scope.
See SHIP_AUTHORING.md for the implemented schema and examples.

## 1. Goal and relationship to locations

Ships are movable local locations. They reuse location identity, ownership,
inventory, stored power, capacities, infrastructure, local flags, action
assignments, crafting, and simulation. Moving a ship preserves all of those
assets and its identity.

Ships are the player's only transportation between locations, including two
sites within the same area. The normal journey is:

**Location → board ship → move ship → disembark at another location.**

The player remains aboard the same ship throughout movement. A ship left at a
destination remains there when the player disembarks.

This plan supersedes the direct player travel rules in section 19 of
LOCATION_SYSTEM_IMPLEMENTATION_PLAN.md and LOCATION_AUTHORING.md. It retains
their distance-based area connections, discovery rules, local assets, map
browsing, and saved action transactions.

Areas remain navigation containers and map nodes, but cease to be occupiable
player locations. Ships remain `kind: site`, with an explicit ship designation;
there is no separate ship inventory or parallel world model.

## 2. Confirmed decisions and proposed defaults

| Confirmed decision | First-version behavior |
| --- | --- |
| Docking | A ship must dock at the particular site where the player boards or disembarks. |
| Movement | Timed point-to-point journeys, operational propulsion, and payment from the ship's stored power at departure. |
| Boarding | Free when docked at the occupied site and access is permitted; ownership is not required. |
| Passenger navigation | Passengers can choose destinations and use ship propulsion/power, without inventory or equipment-management access. |
| Ship acquisition | Outside this implementation. Do not decide or implement how the player obtains a ship. |

Implementation scope:


- Boarding does not require ownership, only proximity (the ship must be docked
  at the player's current site) and permitted access. Fees are deferred until a
  later economy system defines payment. Visiting unowned stationary sites
  continues to use their existing access conditions.
- Multiple authored ships are supported. Starting grants, ship construction,
  purchasing, capture, autonomous NPC transport, and ship-to-ship boarding are deferred.
- No ship interiors or rooms. The ship itself is the occupied local location.
- Preserve the existing item/power transfer policy: both endpoints must be owned,
  known, in the same area, with the player at one endpoint. Docking allows
  player passage when access is permitted; it does not additionally restrict cargo transfers in this
  version. Requiring docking for transfers would be a separate gameplay change.
- No automatic movement of cargo when boarding or disembarking. There is still
  no player-carried inventory or automatic use of another site's equipment.
- Journeys take time rather than completing instantly, with duration based on
  distance and ship capabilities so future ship improvements can reduce travel
  time. Travel remains strictly point-to-point: one local destination or one
  adjacent area per journey, with no automatic routing through intermediate areas.
  No fuel resource, offline travel, combat, orbital physics, automatic pathfinding,
  or infrastructure transfers in this implementation.

Use test-only authored ships to exercise the system without selecting a ship
acquisition design or adding a player-facing starter grant. The system must work
when no ship is available: show a clear boarding requirement and do not retain
direct travel as a fallback. A later content/acquisition feature supplies ships
for the normal player journey.

## 3. Player journey and movement rules

With the implemented docking model:

| Action | Preconditions | Saved result |
| --- | --- | --- |
| Board ship | Player at the stationary site where a known ship is docked; ship entry conditions pass | Change player location to the ship ID |
| Undock | Player aboard a docked ship with no active journey | Clear the ship's docking target; remain aboard |
| Travel to area | Player aboard an idle undocked ship; destination known, accessible, and adjacent; propulsion/power sufficient | Debit ship power and start a journey; change ship area on arrival; remain aboard |
| Dock at site | Player aboard an idle undocked ship; stationary target known, accessible, and in the same area; propulsion/power sufficient | Debit ship power and start an approach; set docking target on arrival; remain aboard |
| Disembark | Ship docked at the destination; destination entry conditions still pass | Change player location to the docked site's ID |

Undocking is immediate and free. Boarding and
disembarking also have no power cost and remain possible when propulsion is
disabled. Docking includes movement within the local area, so it checks propulsion
and a local maneuver cost. There is no separately simulated local position.
Boarding, undocking, disembarking, second departures, and cargo transfers are
blocked during a journey. Area membership changes only on arrival; the map shows
the travelling ship in its departure area with explicit en-route status.

Two concrete acceptance journeys:

1. Habitat → board → undock → dock at supply platform → disembark.
2. Habitat → board → undock → travel to Outer collector reach → dock at derelict
   relay → disembark → board the same ship → return to habitat.

Area travel follows one existing distance-derived connection per action. Selecting
a remote site's map node never silently travels through intermediate areas.
Access conditions for area travel and docking are evaluated against the current
ship context; disembarking rechecks destination access against that same current
context. Browsing a destination does not change context.

Reject direct stationary-site-to-site and player-to-area movement everywhere,
including old commands, action IDs, and low-level movement helpers. A disabled
button alone is not enforcement. Docking at a ship is not supported initially;
switch ships by disembarking at a shared stationary docking site and boarding the
other ship. No berth limits are introduced.

## 4. Authored definitions and saved state

Continue authoring ships in `js/locationContent.js`, using the existing ship
template and one definition per ship. An explicit normalized designation such as
`mobile: true` identifies ship types independently of their display names. Only
sites may carry this designation in the initial system.

Ship definitions add:

- Initial docking target, or null for a ship starting undocked.
- Required propulsion capability.
- Stored-power costs for local docking maneuvers and area travel. Costs are finite
  and nonnegative, authored on the ship template with per-ship overrides.
- Their own starting assets and capacities, using the existing location fields.

Keep the saved record in `state.locations[shipId]`:

| Value | Meaning |
| --- | --- |
| Root `locationId` | The stationary site or ship occupied by the player |
| Ship `areaId` | Current containing area; changes during area travel |
| Ship `dockedAtId` | Stationary site currently docked at, or null |
| Ship `journey` | Null, or kind, origin area, target, duration, and remaining visible time |
| Existing local asset fields | Owner, resources including power, infrastructure, flags |

Do not save duplicate aboard flags, a separate active ship ID, derived power
rates, or copies of static ship specifications. Player presence is derived from
the root location ID. Docking must reference a stationary site in the ship's
saved area, never itself, an area, another ship, or an unknown ID.

Validate authored defaults at startup and saved relationships after every action.
Fixed sites do not gain movement actions simply by installing propulsion. A
second ship using supported features must need only an authored definition.

### Authoring contract: one entry adds one ship

Adding a ship using existing mechanics must require only one entry in
`locationDefinitions.locations` in `js/locationContent.js`. Do not require a
second ship registry, manual action registration, map edits, per-ship movement
functions, or a save-version change. The entry's key is its stable ship/location
ID and represents one persistent vessel, not a recipe for spawning a fleet.

The `ship` template supplies the mobile-site designation, presentation defaults,
shared crafting/equipment action collections, propulsion capability, and movement
cost defaults. Individual ships override only the values that differ. Use these
flat ship-specific field names to keep the existing template composition rules:
`initialDockedAtId`, `propulsionCapability`, `localTravelPowerCost`,
`areaTravelPowerCost`, `localTravelDistance`, and `travelSpeed`. Missing docking state defaults to null; movement cost
defaults must be explicitly declared in the template. Assets and capacities use
the existing map-merging rules, including meaningful zero values.

Illustrative content entry for the planned schema (documentation only; this does
not add a playable ship or decide acquisition):

```js
courier07: {
  name: "Courier 07",
  type: "ship",
  areaId: "vicinity",
  initialDockedAtId: "habitat",
  remoteDescription: "A compact cargo courier with reinforced storage racks.",
  description: "Cargo racks line the passage behind the flight console.",
  capacities: { scrap: 120, power: 30 },
  initialResources: { power: 10 },
  initialInfrastructure: {
    engine: { quantity: 1 },
    solar: { quantity: 1 }
  },
  localTravelPowerCost: 1,
  areaTravelPowerCost: 5
}
```

`engine` is the shared propulsion infrastructure added by this implementation;
it is defined once in the equipment catalog, not separately for each ship.
Ownership is omitted in this neutral example and therefore defaults to unowned.
Test fixtures set `initialOwnerId: "player"` to exercise navigation. Production
ownership/acquisition remains a separate content decision. Keep remote descriptions
independent of changing position in actual content; derive current docking text
from saved state rather than relying on a static sentence.

Authors may additionally assign existing actions, scene objects, discovery/access
conditions, equipment, or a fabrication facility using the same fields as any
other location. A cargo variant can change capacities; a workshop variant can
add a fabricator; an efficient variant can change movement costs. None requires
new movement code. Repeated configurations can use another self-contained ship
type template with `mobile: true`, following the existing one-template rule;
do not add template inheritance chains.

On loading the content, the system automatically:

1. Expands the template and validates item, equipment, area, and docking references.
2. Creates independent state for a previously unseen ship ID, or restores its
   existing state without resetting assets, ownership, position, or docking.
3. Provides boarding/navigation controls and requirements through shared handlers.
4. Includes the ship in maps, local asset displays, power simulation, and eligible
   transfers according to its current saved state and discovery/access rules.

Changing starting values does not overwrite existing vessels. Renaming/removing
IDs or reducing capacity below saved holdings still requires an explicit migration.
New mechanics such as jump drives, paid fares, or mobile ship-to-ship docking
require a shared mechanic implementation first; a new name, capacity, loadout,
appearance, cost, or set of existing actions does not.

## 5. Ship equipment, power, and cargo

Use the existing infrastructure/capability mechanism for operational propulsion:
at least one local engine group has positive quantity, is enabled, and has
positive health. No separate engine health model is needed.

Add initial propulsion infrastructure through the existing item/infrastructure
catalog. Ship construction and new engine recipes are not prerequisites for this
version. Existing shared equipment behavior remains available where supported.

Movement pays from the occupied ship's reserve only. Check the full cost before
changing position. Neither habitat power nor another owned ship's reserve can
automatically pay a journey cost. Previews and execution use the same cost and
eligibility rules; execution rechecks live values.

The main test ship should have functioning propulsion, storage, stored power, and
its own working power generation. Use representative fixture values such as 20
power capacity, 10 stored power, 1 power per docking maneuver, and 5 per area
crossing, with a working solar array. Confirm a complete return journey. These
are test values; final ship specifications and acquisition balance remain outside
this plan. Require explicit authored movement costs rather than hidden constants.

Each ship has no fabricator unless content explicitly grants one. Its
inventory remains viewable, and fabrication becomes available only when its own
operational equipment supplies the recipe's capabilities.

All initialized ships use the existing visible-page power simulation, including
unoccupied ships. Journeys use that same clock, with no separate timer or offline
catch-up. A ship with positive
net generation can recover from depleted power while aboard; a ship without it
must obtain power through an eligible transfer or remain unable to move. No
automatic rescue, remote recall, or loss-of-ship mechanic is introduced.

Area journey distance is Euclidean distance between area coordinates. Local
approaches use the ship's authored abstract `localTravelDistance` (default 10).
Effective speed is the ship's `travelSpeed` multiplier (default 1) times the sum
of matching enabled engines' speed times quantity and health. The default engine
has speed 10. Engine product upgrades can add `travelSpeedBonus` using the existing
upgrade mechanism. Duration equals distance divided by speed and is fixed at
departure; later equipment changes affect the next journey. There is no midflight
failure, cancellation, or refund mechanism.

The simulation advances remaining time on a candidate state. On completion,
validate and save before committing the arrival and publishing its narrative.
Save failure pauses simulation without committing arrival; a successful action
after save access is restored, or a reload, resumes progress. Ordinary autosaves
and page hiding preserve remaining time; loading grants no offline progress.

Cargo and stored power continue to use the existing transfer action and form.
After movement, stale endpoints must be refreshed and revalidated against saved
area membership. A ship's installed equipment stays with it during movement.

## 6. Modules and integration boundaries

Add one focused `js/ships.js` module for ship eligibility, boarding, undocking,
area travel, docking, disembarking, navigation views, and registered actions.
It receives state/catalogs and mutates only the supplied transaction candidate.
It has no DOM, storage, timer, or message-bus dependency.

Keep generic local assets, contexts, discovery, area membership, scene inspection,
and transfers in `js/locations.js`. Ship logic may use those helpers; avoid a
reverse import from locations into ships. Assemble navigation behavior at the
application boundary and supply its read-only views to the map. Remove or replace
the old unrestricted travel path rather than leaving it as a fallback.

| File | Planned work |
| --- | --- |
| `js/locationContent.js` | Ship template metadata; individual production ship definitions are a later content decision |
| `js/content.js` | Propulsion capability/infrastructure, without automatic ship or equipment grants |
| `js/ships.js` (new) | Central movement checks, mutations, action definitions, and navigation views |
| `js/locations.js` | Validate mobile-site metadata; retain common helpers; retire unrestricted travel; adapt graph navigation data |
| `js/state.js` | Version-four migration and validation, including docking relationships and occupiable player locations |
| `js/app.js` | Assemble ship actions; perform final combined action validation; handle committed movement presentation |
| `js/locationDisplay.js` | Contextual navigation controls, docking status, ship markers, and accurate links |
| `js/transferDisplay.js` | Verify endpoint refresh after ship movement; change only where necessary |
| `index.html`, `style.css` | Compact ship status/control styling where existing elements are insufficient |
| Tests and authoring documents | Replace direct-travel assumptions and describe ship content/rules |

Catalog construction currently generates location actions and validates their
scopes internally. Adjust startup so final validation includes item, scene,
transfer, and ship-navigation actions together before registration. Preserve
unique action IDs, command ambiguity checks, and existing habitat shortcuts.

Reuse `playerActions.js` and the existing copy → execute → validate → save → commit
transaction. A failed requirement, execution, validation, or save leaves position,
power, docking, and player presence unchanged. Keep the single save and clock.

## 7. Locations interface and arrival behavior

Reuse Locations, Operations, Workshop, and the current instrument bay. A separate
Ships tab is unnecessary for the initial implementation.

- Map details show the applicable action: Board, Dock, Disembark, or Travel to area.
  An aboard-ship status/control can expose Undock when required.
- Show ship name, current area, docking site/status, and movement requirements/cost.
- At a stationary site, area travel explains that the player must board a ship.
- Multiple ships have separate entries and controls; never choose one implicitly.
- The map derives ship presence from saved area membership. Movement removes the
  ship from its old area and places it in the new one without changing its ID.
- Area links continue to mean potential ship routes. Replace the local graph's
  all-to-all player-travel implication with clearly identified potential ship
  approaches and current docking relationships.
- Selection, zoom, sidebar state, and browsing remain presentation-only. Preserve
  keyboard/touch access, focus behavior, responsive layout, and reduced motion.

On boarding/disembarking, switch actions and header identity to the newly occupied
location. Expose local inventory, equipment, and power only when owned by the
player; permitted entry or boarding does not grant access to unowned assets.
Clear inaccessible asset views and bindings rather than retaining access to the
previous location or falling back to remote owned assets. Enforce ownership in
both presentation and action execution, including crafting and transfers.
On ship movement, retain the ship header and tint, and retain its active asset
store and power history only while ownership permits access; refresh its
area/docking status, map, transfer eligibility, and navigation controls.

The current application handles travel primarily through `action.travel` and
root location-ID changes. Extend committed movement presentation to distinguish
boarding, ship movement, docking, and disembarking. Arrival messages must name the
actual area or docking destination even when the player's location ID is unchanged.
Successful movement returns to Operations with the appropriate narrative; failed
actions do not switch tabs or announce arrival. Loading aboard restores both the
ship identity and its current position/status.

## 8. Save compatibility

Increment save version from 3 to 4. Preserve supported version-one and version-two
migrations, then apply the ship migration. Keep one localStorage save.

Preserve all existing local assets, owners, flags, discoveries, equipment condition,
upgrades, clock, and crafting selections. Initialize a newly authored ship record
through the existing new-location mechanism only when that record is absent;
never repeat its initial assets on reload. Migration itself grants no ship.

Explicit migration rules keep saved player positions valid under the new
occupancy model without implementing acquisition:

| Existing valid player position | Version-four result |
| --- | --- |
| Stationary site | Keep player there; do not add or relocate a ship |
| Area | Use an explicit compatibility mapping to a stationary site in the same area: `vicinity` → `habitat`, `outerReach` → `derelict` |
| Existing ship-like site in supported content | Preserve player and ship position/assets; initialize newly introduced docking state as undocked unless an explicit migration mapping provides a valid target |

Fresh games retain their existing Habitat 05 player start and receive no new ship
grant. The area-to-site mapping is an explicit compatibility decision,
not an acquisition mechanic or a normal player travel action. Validate that its
target exists in the saved area and is known and accessible. If an area has no
valid explicit mapping, stop migration with a clear explanation and preserve the
save; do not pick an arbitrary destination or teleport to a different area.
Explain any area-to-site conversion in startup feedback after successful migration.

Reject unknown IDs, malformed records, invalid docking relationships, and
unsupported versions without overwriting the saved data. Missing ship fields may
be added by the version-three migration; missing required fields in a version-four
record must fail. Existing ship records must not be relocated or replenished by
changed starting defaults. Repeated migration/loading must be idempotent.

## 9. Implementation sequence and completion gates

1. **Finalize implementation defaults.** Use the confirmed docking, timed travel,
   free boarding, and passenger-navigation rules. Keep acquisition outside scope.
2. **Definitions and state.** Add ship designation, docking metadata, propulsion,
   test ship definitions, and migration/validation. Verify independent state, valid
   defaults, and preservation of older progress.
3. **Movement rules and actions.** Implement board/undock/travel/dock/disembark,
   replace the old direct-travel paths, and validate combined action scopes.
   Both example journeys must work through the saved action transaction.
4. **Presentation and transfers.** Add contextual map controls, ship status and
   movement narrative. Verify changes when the ship moves but root location ID
   does not; refresh transfer endpoints and preserve ship asset views.
5. **Regression checks and documentation.** Update existing tests and guides,
   complete browser verification, and verify the test ship's return journey.

Each phase should produce working, reviewable behavior. Transport availability in
the normal game depends on later ship content/acquisition: until a ship is
available, the player stays at the current site. Document this consequence rather
than adding a starter ship or retaining direct travel without authorization.

## 10. Acceptance checks

Add `tests/ships.test.mjs` and update location/action/browser tests whose expected
journeys currently use direct travel. Test these outcomes:

- No direct travel between stationary sites or onto an area, including through
  old action IDs, aliases, commands, and core movement entry points.
- Boarding requires the correct docking site and permitted ship; movement
  requires player presence. Asset management requires ownership. An engine at a habitat does not make
  that habitat movable.
- Ship movement preserves ID, inventory, equipment, owner, flags, and player
  occupancy; only the intended power cost and position fields change.
- Area adjacency retains inclusive Euclidean distance behavior. Unknown, locked,
  nonadjacent, and wrong-area destinations fail clearly.
- Engines missing, disabled, empty, or at zero health block powered movement;
  exact required power succeeds, insufficient power fails without partial debit.
- Undocking, docking, disembarking, and reboarding follow the transition rules.
  Repeated commands cannot double-charge or create inconsistent docking state.
- Journey duration follows distance and engine speed, condition, quantities, and
  upgrades. Hidden-page time and offline time do not advance it; saved remaining
  time restores correctly. Unowned passenger asset views and controls are cleared.
- Ships have independent assets and simulation. A remote fabricator or power
  reserve never satisfies local crafting or movement requirements.
- Item/power transfers conserve quantities, honor capacity and area rules, and
  reject stale selections after moving the ship.
- Forced execution/validation/save failures roll back all affected movement state
  and power; failed actions produce no arrival effects.
- Version 1/2/3 saves migrate safely, including a player saved at a remote site or
  an area; version 4 reload preserves ship movement and never duplicates assets.
- Migration and new-game creation add no unrequested starter ship. With no ship
  available, navigation is blocked clearly while local gameplay remains usable.
- Adding a second authored ship requires only its content entry. Verify different
  capacities, equipment, costs, and scenes, independent state, automatic navigation
  and map integration, and initialization in an existing save without resetting
  its first ship. Invalid references fail with the ship ID and offending field.
- Browsing never moves anyone. Successful journeys show the right narrative,
  markers, inventory, and power history; keyboard, touch, and narrow layouts work.
- The original habitat production loop remains playable.

Run the existing core test suite plus the new ship tests, then the relevant browser
suite with isolated saves. Document the new rules in LOCATION_AUTHORING.md and
README.md, add SHIP_AUTHORING.md for ship examples, and annotate the superseded
location-plan travel rules with a link to the completed ship plan.

The system is complete when, using authored test ships, the player can load cargo,
board a persistent ship, move locally or through connected areas, dock, disembark,
and return, while all local assets and prior progress remain correctly isolated
and saved.
