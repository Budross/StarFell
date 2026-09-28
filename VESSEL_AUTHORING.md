# Modular vessel and Shipyard authoring

Modular vessels are ordinary `ship` entities assembled from counted Product items. The saved `locations[id].assembly` contains one anchored core and placed attachments. Current item definitions determine module footprint, envelope volume, dry mass, capabilities, speed, tank and cargo capacity. Existing saves and legacy ships keep their previous behavior. For the implementation rationale and acceptance route, see [the expansion plan](MODULAR_VESSEL_SHIPYARD_IMPLEMENTATION_PLAN.md).

## Make a module

Add a Product in `js/content.js` or `js/vesselContent.js`, with an ordinary recipe and optional `vesselModule` metadata. The compiled item's `unitVolumeUnits` is **the only envelope volume**. `unitVolumeM3` describes the same rigid rectangle when stored or assembled, not a second deployed volume. The grid cell is 1 m × 1 m. `footprint.width` and `height` are positive whole cells; derived depth is `unitVolumeM3 / (width × height)` metres. `dryMassKg` must be positive in exact whole grams. Cargo and tank usable volume together cannot exceed the Product envelope.

```js
smallCargoModule: {
  name: 'Small Cargo Module', category: 'product', unitVolumeM3: 1.5,
  tags: ['vesselModule'],
  recipes: [{ id: 'fabricate', name: 'Fabricate cargo module', amount: 1,
    conditions: { discoveries: ['modularStructures'] },
    inputs: [{ id: 'frame', item: 'structuralFrame', quantity: 3 }] }],
  vesselModule: {
    role: 'attachment', category: 'Logistics', footprint: { width: 2, height: 2 },
    dryMassKg: 85, designDiscoveryId: 'modularStructures',
    capabilities: { cargoStorage: { capacityM3: 0.5 } }
  }
}
```

Categories are `Core`, `Propulsion`, `Logistics`, `Systems`, and `Industrial`. Exactly one Product with `role: 'core'` anchors each vessel at `(0,0)` and uses category `Core`. A core declares `{ vesselClass: 'crewed'|'autonomous', controlMode: 'direct'|'commanded', boardable: boolean }`; the valid pairs are crewed/direct/true and autonomous/commanded/false. Other modules use `role: 'attachment'` without a `core` object. Their optional capabilities are `cargoStorage`, `fuelStorage`, `propulsion`, and `equipment`. Fuel storage names accepted Component IDs; propulsion names one Component fuel ID, a positive `travelSpeed`, and positive `distancePerFuelUnit`. Equipment supports existing power, reserve, operational capabilities and Processing multipliers. Only `radio`, `surfaceExtraction`, `thermalRefining`, `fabrication`, and `benchAnalysis` are supported equipment capabilities in this slice. No family registry or fuel chemistry is inferred from tags.

`designDiscoveryId` gates every fabrication recipe for that Product. It does **not** gate assembly of a physical Product already in Shipyard stock. Unknown recovered stock appears generically in the palette; recipe details stay hidden until the design is learned. Do not add an ordinary `installation` to a vessel module. Compilation creates a stable `vessel_${itemId}` equipment group for its installed effects; the Workshop cannot install it independently.

## Assembly and live state

The Shipyard is a stationary site with `shipyard: true`; production Habitat 05 is the first. The yard must be the player's occupied site with facility use, cargo withdrawal, and equipment management. A draft may contain only a core. Committing requires a core plus at least one attachment, no overlapping rectangles, and a transitive shared-edge path from every attachment to the core. Corner contact does not connect. Missing propulsion, cargo, tank, generation, radio or extraction is a warning, not an arbitrary vessel archetype rule.

`assembleVessel` checks stock and consumes each placed physical Product, **one Structural Frame per module including the core**, and two power units. It creates one privately owned, player-controlled ship at the yard berth with empty cargo, tanks and stored power, and records one `VESSEL_ASSEMBLED` fact. The assembly and exchange share the runtime's clone/validate/save/commit transaction. Failed attempts retain stock, entity IDs, draft and history. Named access never overrides an autonomous core's no-occupant rule.

Only module IDs, placement keys and integer coordinates are saved as composition. Group quantities are reconstructed from composition at load/action reconciliation; group health, enabled state and upgrades are retained. Current definitions determine bounds, capacity, power and dry mass after reload. A compatibility edit that changes footprint or role and invalidates a saved layout needs an explicit migration or the old definition; the game never silently moves modules. Physical cargo and fuel overload survive content edits. Raw stored power must first be valid and is then clamped to the current passive reserve cap, dissipating excess energy deterministically. Version 9 stays version 9 for this additive slice.

## Fuel, travel and commands

`reactionMassCartridge` is a counted Component of 0.01 m³. It is fabricated five at a time from Habitat-accessible iron and silicon minerals. It occupies dedicated saved tank storage only after an explicit whole-count load from the vessel's own cargo or its actual stationary berth; tank contents are not ordinary cargo and never fill by assembly or recipe. Unload uses the same exact physical endpoints and storage checks. One fuel type is supported per vessel.

The modular branch keeps the existing adjacent-area and docking journeys. Full-health speed is the sum of operational propulsion output multiplied by `250 / dryMassKg` and the ship speed multiplier. Disabled or damaged drive output reduces speed; multiple drives add. For a positive route distance, upfront fuel is at least one cartridge and otherwise `ceil(distance × speed-weighted fuel-per-distance × dryMassKg / 250)`. Area travel also pays the existing five power units, and docking pays one; undocking is free. Fuel and power debit at departure, and the saved journey retains only its existing five fields. Cargo mass does not affect speed; `dryMassKg` is structural/module mass only. Legacy power-only ships keep their original quote.

Player-issued autonomous commands require a known active drone. At the same berth, commands are local; elsewhere both the player host and vessel need operational radio, plus player facility access at the host. A Habitat antenna is separate from the drone radio module. The player remains at Habitat during drone travel and mining. Navigation, one Processing batch, reviewed abort, and cargo transfer reuse existing systems. Extraction requires docking at the actual source site, its `useFacilities` permission, and one finite node batch. Remote cargo transfer accepts only the drone and its current stationary berth. There is no autopilot, queued command, refit, midflight transfer, or remote item teleporting.

The minimum crude prospector uses autonomous core, small cargo, small tank, reaction thruster, power, radio, and extraction modules; install a Habitat antenna, load cartridges and allow the new reserve to charge. Its 318 kg dry mass can reach the nearby Metallic Fragment, extract Titanium Ore, return and transfer it to Habitat. The five new raw materials start only at off-site finite nodes. Advanced modules and crewed cores use materials researched after those trips. An extra basic tank extends crude round trips toward the more distant tungsten and ice sites.

## Extensions and checks

Use `js/vesselContent.js` for module Products, engineering Components, raw materials, discoveries and hints; `js/locationContent.js` for stationary nodes and berths; `js/processingContent.js` for compatible extraction batches. Follow [item](CONTENT_AUTHORING.md), [research](RESEARCH_AUTHORING.md), [location](LOCATION_AUTHORING.md), and [Processing](PROCESSING_AUTHORING.md) contracts for their underlying content. `js/vessels.js` owns composition, geometry and speed projection. `js/shipyard.js`, `js/vesselFuel.js`, and `js/vesselCommandActions.js` own the respective transactions. UI read views never authorize a mutation.

The vessel narrative provider supplies current module/vessel geometry and permitted composition, plus a historical assembly fact from the ledger. Automatic construction wording requires the committed `VESSEL_ASSEMBLED` trigger; it cannot replay from a save load or announce a failed save. See [Narrative authoring](NARRATIVE_AUTHORING.md).

Run `node --test tests/*.test.mjs` and, with Playwright available, `node --test tests/terminalTabs.browser.mjs`. `tests/vessels.test.mjs` includes the no-luck, no-recovered-hardware route from fresh Habitat industry through assembly, fuel, travel, mining, return, transfer, research and reload.
