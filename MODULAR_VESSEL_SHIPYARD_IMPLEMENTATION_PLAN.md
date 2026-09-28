# Modular Vessel Construction / Shipyard implementation plan

Status: implemented 2026-09-27. The revised design remains the specification and review record. Its approved 1-metre scale, recovered-hardware policy, module-count assembly stock, minimum structure, power dissipation, and exploration-driven material economy are now implemented. Player-facing authoring guidance is in [VESSEL_AUTHORING.md](VESSEL_AUTHORING.md).

## 1. Recommended scope and architectural decision

Build one composition model for crewed vessels and autonomous drones. Physical modules are ordinary counted Products with optional `vesselModule` metadata. Assembly consumes those Products in one existing runtime transaction and creates an ordinary `ship` entity with location-owned cargo, equipment, docking, and journey state. Save its core and placed module IDs/coordinates; derive balance values from the current catalog.

The revised slice contains two cores, six basic functional modules, four improved module designs, five new raw Resources, three Habitat-made Components including fuel, and eleven reusable off-site-material Components. It proves a crude autonomous prospector first, then different transport/mining builds and crewed construction using explored materials. Recovered compatible hardware can bypass fabrication knowledge for that physical stock. Add narrow player-issued drone commands; do not add autonomous decision-making, command queues, timed assembly, or refitting.

Use the approved **1 m × 1 m grid cell**, with rebalanced module envelope volumes and dry masses. Use the existing counted item's `unitVolumeUnits` as its only module envelope volume. Reuse installed equipment behavior for cargo bonuses, power, propulsion output, radio, and extraction. Keep the approved domain contracts: composition/layout, core operating semantics, discrete dedicated fuel, dry-mass-sensitive modular navigation, and command access for unoccupied drones.

Committed structure requires **exactly one core plus at least one attachment**, no overlap, and transitive orthogonal connectivity to the core. A core-only draft is allowed but cannot commit. Missing propulsion, fuel storage, cargo, generation, or extraction remains a capability warning rather than an imposed functional archetype. Final assembly consumes one `structuralFrame` per total installed module, core included, plus two existing power units; contact count never changes this bill.

## 2. Relevant existing architecture and evidence

Current implementation is the authority; historical implementation plans and older skill reference notes are not current schemas.

| Concern | Current implementation | Consequence for this expansion |
| --- | --- | --- |
| Items | `js/content.js` authors `definitions.items`; `js/itemCatalog.js` builds `items`, `resources`, recipes, and infrastructure. The category field is `category`, not `kind`. | Extend the existing Product definition and compiler. Do not make another item catalog or inventory category. |
| Quantities | `js/quantities.js`: bulk is integer cubic centimetres; `VOLUME_SCALE = 1,000,000`. Components/Products are integer counts; utilities such as power can be fractional. | Compile volumes once; keep fuel counts integral. |
| Counted item volume | Positive `unitVolumeM3` compiles to `unitVolumeUnits`; authoring currently calls it packed volume. | Modules explicitly use that same canonical volume as their assembled rectangular-envelope volume. |
| Cargo | `js/storage.js` computes item occupied volume and installed capacity bonuses. `js/resources.js` owns checked exchanges and exact cross-store moves. | Preserve the existing cargo map and admission policy. |
| Equipment | `js/equipment.js` owns group quantity, health, enabled state, upgrades, passive cargo/power capacity, capability checks, and operational speed/power output. | Reuse these behaviors rather than invent module-specific power or machine runtimes. |
| Crafting | Products consume Components only. Component recipes accept Resources/Components. Products cannot be recipe inputs or ordinary authored consumable costs. All recipes inherit the `fabrication` capability requirement. | Fabricate module Products normally. Final assembly needs its own semantic action, not a Product-to-Product crafting recipe. |
| Research | `js/research/` uses shared discoveries, bounded evidence credits, detached resolution, saved RNG, and compatibility contracts. Stored Products can be consumed as samples. | Unlock module recipes through discoveries; retain experimental evidence and existing save contracts. |
| Processing | `js/processing.js` supports `site` and `ship` hosts, finite node claims, committed batches, and buffered output. `extractionAccess` already allows a ship docked at the source site. | A mining module can use the existing `surfaceExtraction` capability and batch. No second extraction engine. |
| Processing presentation/actions | `processingWorkshopView` selects the occupied host; `startProcess` action rejects another host even though the domain accepts one with permission. | Drone controls need an explicit authorized wrapper and host-selectable read projection. |
| Ships | `js/ships.js` uses mobile location definitions, equipment speed, adjacent-area routes, local approaches, upfront power payment, and a saved fixed-duration journey. Journeys advance for unoccupied active ships. | Reuse movement. Add fuel payment and boarding semantics without creating drone movement state. |
| Existing shipped vessels | `js/locationContent.js` has a ship type but no production ship instances. Ship and Processing tests supply their own vessels. | This expansion provides the first reachable production construction path; avoid claiming exploration is already reachable. |
| Identity | `js/entities.js` has types `area`, `site`, `ship`, `npc`, `principal`; generated IDs share one counter. `entityCreation.js` creates typed instances from reusable definitions. | Drones remain `ship` entities; no new ID allocator or drone entity type. |
| Authority | `js/authority.js` separates owner, controller, and named permissions. Acting principals are NPCs/principals, not ships. Default mobile access can allow passengers. | A drone is an asset controlled by an authorized principal, not automatically its own principal. Core feasibility must override boarding even for owners. |
| Runtime | `runtime.js` clones, executes, reconciles, validates, saves, then swaps the current state. | All assembly/fuel/command mutations run on that candidate. |
| Composition | `bootstrap.js` explicitly binds catalogs, services, actions, state lifecycle domains, simulation steps, and narrative providers. | Extend this explicit composition point, with narrow dependencies and no dynamic plugin registry. |
| Reconciliation | `stateComposition.js` / `stateLifecycleRegistry.js` have ordered synchronous load participants. Production action reconciliation currently only reconciles dialogue contact. | Bind vessel reconciliation deliberately; do not assume the load lifecycle already runs after every action. |
| Ledger | `worldOperations.js` owns semantic recording; underlying creation/movement primitives are silent. Ledger history is bounded and catalog-independent when validated historically. | Assembly owns one meaningful construction record. |
| Narrative | Providers return detached typed facts. `narrativeFacts.js`, context trigger validation, beat selection, and text contracts use explicit allowlists. Publication is after commit through `narrativePresentation.js`. | A provider alone is insufficient: add typed fact, trigger, beat, and text contracts. |
| UI | Plain module displays; `app.js` registers five tabs. Locations uses Canvas, pointer capture, pan/zoom, and read-only presentation state. Panels live inside `.crt`; `.instrument-bay` and `.command-zone` are outside their changing content. | Add a sixth panel and use the existing Canvas interaction approach. |
| Saves | `stateCore.js` currently sets `SAVE_VERSION = 9`; localStorage saves the entire serializable state. | Use the project's additive-schema policy; do not introduce a version bump automatically. |

Relevant existing regression suites include `ships.test.mjs`, `storage.test.mjs`, `processing.test.mjs`, `processingNumerics.test.mjs`, `entities.test.mjs`, `entityLifecycle.test.mjs`, `research.test.mjs`, `worldLedgerIntegration.test.mjs`, `narrative.test.mjs`, and `terminalTabs.browser.mjs`.

## 3. Concrete conflicts and smallest resolutions

| Conflict | Resolution |
| --- | --- |
| Product recipes cannot consume physical module Products. | `assembleVessel` consumes Products with the existing checked inventory exchange primitives inside a dedicated semantic operation. Leave crafting category rules intact. |
| Mobile currently implies a boardable ship in navigation. | Derive `boardable` from the core and check it in boarding, target generation, occupancy validation, and NPC placement. Legacy mobile definitions retain their current boardable behavior. |
| Default public mobile access includes passenger navigation. | Give newly assembled vessels private initial access. Keep permissions and core feasibility separate; an `enter` grant cannot make a drone habitable. |
| Equipment requires saved installed-group state; composition also implies installed counts. | Give modules assembly-owned equipment groups. Derive/rebuild their quantities from composition, preserving existing group condition state. Never accept independent module installation. See section 10. |
| Existing engines use power, not fuel, and have no mass mechanic. | Add a modular-vessel quote branch with whole-Component fuel charges and dry-mass scaling. Preserve legacy quotes and accepted journeys. |
| The browser's Processing action is occupied-host only. | Add a drone command action that checks the link/authority and calls existing `startProcess`; generalize its read query to an explicitly selected permitted host. |
| Ordinary transfers require the actor's location to be an endpoint. | Preserve that policy. Add a drone transfer command restricted to the selected drone and its actual stationary docking site, then reuse checked movement. |
| Existing item volume is described as packed volume, not necessarily deployed geometry. | Require new module Products to have rigid envelopes whose stored and installed envelope volumes are the same. Do not retrofit old folding items with misleading dimensions. |
| Live footprint changes can create overlaps/disconnections. | Treat footprint/role changes as compatibility-sensitive structural content edits requiring an explicit layout migration or restored definition. Never silently move saved modules. |
| Cargo overload is recoverable; power above capacity currently fails validation. | Preserve physical cargo/fuel contents. For modular vessels, validate raw power, derive current capacity, then clamp excess before existing local validation. Excess energy dissipates deterministically. |
| Advanced materials must be off-site, while there is no production starter ship. | Provide Habitat-only bootstrap recipes and a permitted nearby extraction source reachable on the first tank. Prove the outward/extract/return/use loop before exposing advanced progression. |
| Processing cannot output Products and a named Pressure Vessel may sound like one. | Keep every proposed processed engineering item, including Pressure Vessel and Magnetic Drive Assembly, a counted Component. Use ordinary Crafting for module Products; optional Processing produces Resources/Components only. |
| Narrative normally describes only the occupied host. | Describe locally assembled/docked vessels through a vessel provider operating in the occupied yard's context. Do not fake player occupancy or broadly enable remote narration. |

These are bounded integration changes justified by existing code, not reasons to redesign the runtime, inventory, permissions, Processing, or narrative systems.

## 4. Item/Product module extension

Add optional `vesselModule` metadata only to Products in `definitions.items`. Continue requiring the ordinary `name`, `category: product`, tags, positive `unitVolumeM3`, and legal recipes. A stored module contributes nothing to cargo capacity, power, or propulsion until assembled.

Proposed authoring contract:

| Field | Contract |
| --- | --- |
| `vesselModule.role` | `core` or `attachment`; category labels do not determine core status. |
| `vesselModule.category` | One of the currently populated palette categories: Core, Propulsion, Logistics, Systems, Industrial. |
| `vesselModule.footprint.width`, `.height` | Positive safe integer cell dimensions, no rotation. |
| `vesselModule.dryMassKg` | Positive authored mass, compiled exactly to integer grams. Mass currently has no canonical item field to reuse. |
| `vesselModule.designDiscoveryId` | Required fabrication/reproduction discovery; recipe conditions include it. Physically stocked compatible Products are placeable/assemblable without it. It does not gate installation. |
| `vesselModule.core` | Required only for a core; operating contract below. |
| `vesselModule.capabilities` | Closed typed capability object; only supported keys are accepted. |

The compiler produces a read-only module lookup as part of the compiled item content. This is a projection of Products, not another ownership/inventory system. Reject module metadata on Resources, Components, and utilities; reject unknown nested fields, invalid units, unsupported capabilities, or unsafe arithmetic.

For the initial slice, module Products do not also declare ordinary `installation`. The module compiler supplies their equipment behavior without generating a Workshop install directive. Maintenance may target their compiled groups through existing maintenance contracts; upgrades can wait until there is content requiring them.

Fuel is separately an ordinary Component, referenced by propulsion/tank contracts. No fundamental Fuel category and no per-unit inventory identities are needed.

## 5. Core-module contract

The core defines class and operating model, not purpose.

| Field | Initial contract |
| --- | --- |
| `vesselClass` | `crewed` or `autonomous`; presentation and supported operating behavior. |
| `controlMode` | `direct` or `commanded`. This is a closed supported enum, not arbitrary authored scripting. |
| `boardable` | True for crewed, false for autonomous. Compiler rejects contradictory combinations. |
| Assembly cost | Not a core field. The shared Shipyard rule consumes one `structuralFrame` per installed module, core included, plus two power per final commit. No per-core material recipe or per-contact charge. |
| Optional module restrictions | Omit in the initial shared set. Introduce a narrow supported family restriction only when actual content needs it. |

Footprint, structural mass, volume, and any baseline capabilities use the same module fields as attachments. Do not add a Mining Drone Core. Mining, storage, radio, and propulsion come from installed modules.

Do not simulate crew, pressure, life support, or an invented control budget. The crewed core grants boardability only. Do not grant hidden cargo, fuel, propulsion, a fabricator, or a 40-unit power reserve by inheriting legacy defaults.

An unsupported future core operating model requires a deliberate domain addition. Larger cores using an existing operating model are ordinary content. Stations/habitation may eventually need new placement/operating semantics; the plan does not claim that existing ship movement already implements them.

## 6. Shared ship/drone entity representation

Use `entities[id].type = ship` for both classes and `locations[id]` for their domain state. Add one reusable `modularVessel` location template with `spawn: false` through the existing templates facility. It has `kind: site`, `mobile: true`, zero base cargo/power capacity, empty initial assets, and ordinary navigation fields. It supplies identity/presentation scaffolding; it does not bake in module balance values.

Bind the compiled module lookup to the world read capabilities at construction time. Extend definition resolution so a modular vessel instance exposes its live core class/boardability and any required modular navigation policy from its saved assembly. This must work for `locationDefinition`, `runtimeWorld`, creation validation, load validation, graph queries, and lifecycle labels—not just the Shipyard display. Keep this resolver pure and independent of runtime, DOM, and high-level operations.

Any entity using the modular template requires valid assembly state. A legacy ship without assembly remains legacy. An assembly on a stationary location or a missing assembly on a modular shell is invalid, not silently defaulted.

The player remains at the yard when construction completes. The vessel starts docked at that exact active stationary yard, in the yard's area. A crewed vessel can subsequently be boarded normally; a drone never becomes `state.locationId`.

No extra principal is created for a drone. Owner/controller are player by default; commands execute as the player. Future Actor Goals can use that controlling principal and explicit target vessel, matching existing authority semantics.

## 7. Physical scale and volume-to-dimensions derivation

Set one domain constant, `SHIPYARD_CELL_SIZE_METERS = 1`. Each attachment-plane cell is 1 m × 1 m. All geometry, dimension formatting, grid labels, and preview facts consume it. Map distance units are abstract navigation units and must not be silently converted to metres using this unrelated grid constant.

The cell scale is a decided shared conversion. Section 22 replaces the earlier envelope/mass proposal: the 2×2 crewed core is 4.00 m³ and 1 m deep; the 1×1 autonomous core is 0.50 m³ and 0.5 m deep. Habitat's existing 10 m³ hold can stage the 5.35 m³ bootstrap prospector. Do not increase projected area while keeping old volumes. Module balance values remain live authored definitions, not architectural constants.

For each module:

- Physical width = footprint width × cell size.
- Physical length = footprint height × cell size.
- Projected area = physical width × physical length.
- Physical volume in m³ = `unitVolumeUnits / VOLUME_SCALE`.
- Physical depth = physical volume / projected area.

Inventory quantities and capacity arithmetic stay exact integers. Geometry may use finite floating-point metres after this boundary; it never feeds rounded UI values back into inventory. Validate positive volume/area/depth and finite, safe bounds before calculation.

Example: 2×3 cells and 1.50 m³ give 2.0 m × 3.0 m × 0.25 m. The same volume on 1×1 cells gives 1.0 m × 1.0 m × 1.50 m. Footprint is therefore an actual balancing/narrative choice. The Small Cargo Module's 2×2 footprint and 1.50 m³ give 2 × 2 × 0.375 m; the Basic Reaction Thruster's 1×2 footprint and 0.80 m³ give 1 × 2 × 0.4 m.

No second `physicalVolumeM3` field. For future deployable/folding equipment, require an explicit semantic exception before separating packed and deployed envelopes.

## 8. Module geometry facts and classification thresholds

The vessel domain owns numeric geometry and its classifications. Narrative receives those results; text templates do not calculate dimensions.

Add `module_geometry` facts with a stable module subject key, definition ID/name, footprint dimensions, width/length/depth, physical volume, projected area, dry mass, and derived bands. Installed occurrences need a subject such as `vessel_module` with vessel ID and placement key; otherwise two identical modules would collide under the current fact-key rules. Palette facts, if ever needed, use definition subjects and do not masquerade as installed entities.

Proposed explicit v1 thresholds:

| Classification | Numeric predicate |
| --- | --- |
| Small / medium / large | Largest physical dimension is respectively <2 m, 2–<5 m, or ≥5 m. |
| Elongated | Larger attachment-plane dimension / smaller is ≥2. |
| Broad and shallow | Both plane dimensions are ≥1 m, plane aspect is <2, and depth / smaller plane dimension is ≤0.25. |
| Shallow | Depth / smaller plane dimension is ≤0.25. |
| Deep | Depth / larger plane dimension is ≥1. |
| Compact prism | Largest of all three dimensions / smallest is ≤2. |

Use exact boundary comparisons before display rounding. Bands can coexist where their predicates allow it; do not force every module into every category. The numeric thresholds still fit the revised scale: 2 × 2 × 0.375 m cargo supports broad/shallow; 2 × 2 × 1 m crewed core is a compact prism and medium-sized, without a shallow claim; 1 × 1 × 0.5 m autonomous core is small/compact; a 1 × 1 × 1.5 m example is deep. Test approved-volume examples and exact thresholds.

Avoid vague `bulky` unless given its own agreed numeric rule. Never derive reinforced, fragile, aerodynamic, armored, pressurized, or exposed mechanisms from dimensions alone. Existing equipment health can separately support its existing truthful condition vocabulary.

## 9. Aggregate layout/envelope geometry

Treat modules as rectangular prisms extending from one common attachment plane in a common positive depth direction. This is an explicit approximation, not a rendered structural or aerodynamic simulation.

Derive the following from the complete layout including the core:

- Minimum and maximum x/y footprint bounds, including negative coordinates.
- Bounding width/length in cells and metres.
- Maximum module depth as approximate vessel depth.
- Sum of module physical volumes and dry masses.
- Total module count, explicitly including the core.
- Occupied plane area = sum of rectangle areas for a valid nonoverlapping layout.
- Compactness = occupied plane area / bounding rectangle area.
- Contact count = number of unordered module pairs with positive orthogonal shared edge length. Also derive total shared-edge length if useful; do not confuse it with pair count.

Bounding-envelope volume is not the sum of module volumes, not usable cargo, and not fuel capacity. Empty gaps remain gaps.

Initial layout bands: compact cluster when compactness ≥0.75 and there are at least two modules; elongated when bounding plane aspect ≥2; sparse/irregular footprint when compactness ≤0.60. A low fill ratio supports gaps/irregular outline, not asymmetry or weak structure. Defer symmetry and detailed shape analysis.

Preview can retain individual geometry for an invalid disconnected draft, but must clearly mark that the aggregate is a draft and cannot be assembled. A connected cycle is legal; a tree layout is not required.

## 10. Typed capabilities and equipment integration

Use a small closed set of typed module capabilities. A new module using these contracts is content; a new physical mechanic is an explicit domain feature.

| Module capability | Canonical owner and compiled behavior |
| --- | --- |
| `cargoStorage.capacityM3` | Compile to equipment `storageBonusVolumeUnits`; cargo sums via `storage.js`/`equipment.cargoBonus`. |
| `fuelStorage.capacityM3`, accepted fuel item IDs | Compile exact volume; dedicated vessel fuel domain sums tanks separately. |
| `propulsion.travelSpeed`, `fuelItemId`, `distancePerFuelUnit` | Compile existing operational `propulsion` equipment capability and travel-speed contribution; vessel navigation owns whole-unit travel payment. |
| `equipment.powerPerSecond`, `capacityBonus`, `capabilities`, optional `processing` multipliers | Reuse the existing equipment field meanings and validation. Enables power generation, radio, fabrication, bench analysis, extraction, or refining where a consuming domain already exists. |

Do not author the same cargo/power/speed statistic twice in `installation` and `vesselModule`. The module compiler translates the typed contract into one compiled equipment definition per module ID, with a reserved stable group name and source Product ID. Cargo is represented only once as an equipment cargo bonus; the modular shell has zero base hold capacity. Fuel is never an equipment cargo bonus.

### One owner for installed quantities

Composition is authoritative for assembly-owned group quantities. At creation/load/action reconciliation, count occurrences of each module and rebuild those groups' `quantity`. The existing infrastructure shape can retain these counts for compatibility with all current consumers, but they are a reconstructible membership cache, not independent installed stock or balance snapshots. No mass, volume, speed, output, cargo capacity, or tank capacity is persisted in that cache.

Existing `health`, `enabled`, and `upgrades` remain authoritative equipment runtime state and retain current group semantics. Multiple occurrences of one module share that group's condition in v1, as existing installed machinery does. Do not duplicate group condition onto placements or imply individual module damage. Initial assembly initializes healthy/enabled groups, with no upgrades. Individual wear/modifications are deferred.

Validate present group condition records before rebuilding quantities. Do not turn malformed health/upgrades into healthy defaults. Derivation must be deterministic and idempotent, and direct canonical validation checks count/composition agreement. New compiled groups get neutral state only through the existing additive-content reconciliation policy.

Assembly-owned groups cannot be installed, granted as loose equipment, or independently increased through Workshop actions. Stored module Products remain cargo. Reject module-group quantities on ordinary sites/legacy vessels unless explicitly initialized through a future supported conversion. For assembled vessels, ordinary Product installation is also unavailable in v1: structural additions must eventually be refits, otherwise the grid/mass model could be bypassed by installing cargo bays or engines outside composition. Existing authored ships retain ordinary installation behavior.

This bridge deliberately avoids changing every equipment function to accept a vessel root or adding parallel equipment state. Audit direct infrastructure readers in Processing, power, conditions, views, and narrative; they must all see the same rebuilt counts and current compiled definitions.

## 11. Cargo integration and functional capacity

Keep actual cargo in `locations[vesselId].resources`. Installed module Products have been consumed and do not also occupy that cargo map. Each cargo module adds usable hold volume through the existing passive capacity rule, independent of health/enabled state.

For the Small Cargo Module, external volume is 1.50 m³ and usable cargo is 0.50 m³. Its low usable fraction is a real bootstrap tradeoff. Require initial cargo/tank functional volume not to exceed its physical module envelope; this is a deliberately constrained v1 content check, not a complete packing or material-conservation simulation.

Cargo summaries, crafting admission, checked grants, transfers, and Processing deliveries all use the same `getLocationContext(...).store`. Never save a context or modify the browser's read projection as if it were state.

A live cargo reduction may overload an existing vessel. Preserve its items; existing admission allows reductions/equal occupied volume while rejecting increased load. Navigation remains available while overloaded, matching current behavior. Do not add a speculative loaded-cargo mass calculation: non-module items currently have no canonical mass data. The movement metric is explicitly dry structural mass.

## 12. Discrete volumetric Component fuel

Author `reactionMassCartridge` as a Component with `unitVolumeM3 = 0.01` (10,000 volume units), whole-count recipes, and normal inventory/research behavior. It represents packaged mineral reaction mass, not manufactured raw Resource stock or a chemical propellant made from unmodeled chemistry.

Save a concrete dedicated field on modular vessels: `fuel: { items: { reactionMassCartridge: integerCount } }`. This is the only additional storage distinction. It uses the same item IDs, quantity validation, volume arithmetic, and checked movement primitives as cargo. It does not contain fuel definitions, capacities, fractional fuel, or stored energy equivalents.

For a 0.25 m³ tank and 0.01 m³ cartridges, the maximum is floor(250,000 / 10,000) = 25 cartridges. Tank capacity sums separately from cargo. Cartridges in cargo consume general cargo space and cannot power navigation until loaded. Cartridges in the tank consume tank space and do not also occupy cargo.

The first tank/engine accept the explicit cartridge item ID. Do not introduce a fuel-family registry. The contracts can reference a different Component ID later, but simultaneous mixed-fuel propulsion requires a deliberate operating policy; v1 rejects unsupported mixtures rather than silently pooling incompatible fuels.

Use checked integer addition/multiplication and exact floor division for capacity. Volume changes to a fuel Component must also affect occupied tank volume live. Unknown/non-Component fuel items or invalid integer quantities fail validation.

## 13. Fuel loading, unloading, consumption, and honest range

Add `loadVesselFuel` and `unloadVesselFuel` authoritative actions. They accept a vessel ID, known fuel ID, and positive whole amount; trusted actor identity is bound by the action, never supplied by the player payload.

Source/destination choices are limited to the vessel's own cargo or its actual stationary docking site's cargo, subject to current access and absence of journeys. A player aboard a crewed vessel or at its berth can load normally. A commanded drone can load through the drone command access policy. Do not interpret merely sharing an area as an unlimited remote fueling connection.

Build a narrow tank store adapter over `fuel.items`, with zero utility capacity and exact dedicated volume admission. Reuse `moveExact`/its before-and-after validation where compatible. The domain owns accepted-fuel checks and endpoint feasibility. Do not duplicate a general inventory framework; do not pretend this adapter is another ordinary location. Both debit/credit must succeed before either persists.

Loading never manufactures cartridges, unloading never grants extra stock, and failed saves roll both sides back. Preserve overfilled tanks caused by live balance changes; allow consumption/unloading and non-increasing occupied volume, rejecting growth while overloaded. Unloading also requires room in the receiving cargo hold. No silent venting.

### Departure quote policy for modular vessels

Retain upfront full journey payment. Extend the shared quote with fuel item ID and whole fuel units alongside power cost and duration. Legacy vessels still produce their existing power-only quote.

Proposed initial mechanics:

1. Use the existing operational propulsion sum and shared distances.
2. Modular effective speed = operational propulsion sum × 250 kg reference mass / current dry mass. The reference mass is one named shared balance constant, not a physical thrust conversion. All cores have positive mass.
3. With the initial thruster, fuel units = ceiling(distance / 10 navigation units × dry mass / 250 kg). A positive journey therefore costs at least one cartridge.
4. Keep the existing upfront navigation power costs: one power for local approach, five for area travel. These are actual ship power costs, separate from cartridges.

Both mass effects are deliberate additions for modular vessels: adding cargo/tank/machine structure slows travel and increases travel fuel requirements. Cargo contents and loaded fuel do not add mass in v1; label the model accordingly. Multiple identical thrusters add speed under existing rules without multiplying fuel units per distance. They still add their own dry mass.

For different same-fuel thrusters, define consumption per distance as the speed-weighted mean of their per-distance fuel rates: sum(speed contribution / distance-per-unit) / sum(speed contribution), multiplied by distance and mass factor, then rounded up once. Health/enabled state affect the same contributions used by propulsion. This gives one deterministic content-driven rule and preserves identical-drive behavior; no arbitrary modifier stack or selectable engine mode. Reject zero/nonfinite quote results and arithmetic overflow. Do not call speed Newtons of thrust or G.

`navigate` rechecks operational engines, permissions, destination, fuel, and power on the candidate, then debits whole cartridges and power and creates the existing journey atomically. No fuel debit each tick, hidden reservation, continuous accumulator, or component fractions. Cancellation uses the existing no-refund principle. Do not add a public cancel UI solely for this expansion.

Accepted journey duration/remaining time remain saved job state. Balance edits affect future quotes, not the duration or already-paid fuel of a trip underway. The simulation advances arrivals exactly as today; no new vessel simulation step is needed for upfront fuel.

Show route-specific cartridge cost and estimated duration. A range value is only the largest quoted navigable route/repeated leg affordable with loaded fuel and available power under current conditions. Prefer exact selected-route costs over a universal distance that ignores whole-unit rounding, docking, adjacency, or energy. Tank-only theoretical range must not be presented as currently reachable range.

## 14. Research: fabrication designs and reusable material technologies

Physical possession and fabrication knowledge are separate. A compatible Product in accessible physical stock may be assembled whether or not its `designDiscoveryId` is known. Discoveries unlock recipes/reproduction; they neither grant Products nor authorize control of a vessel. Keep the existing evidence engine, shared discoveries, saved RNG, sample consumption, eligibility rules, and bounded evidence credits.

Use existing materials/mechanics/energy/computation/navigation families and the current bench. Preserve all existing evidence contracts; add ordinary routes rather than changing old routes. The first-vessel guarantee must not depend on a lucky roll, off-site evidence, an installed Product being removable, or a crewed ship. In the tables, electrical fabrication means existing `electricalConduction`; photovoltaic and radio knowledge mean `photovoltaicFabrication` and `radioAssembly`. These are not new renamed discoveries.

### Bootstrap evidence routes

Proposed new discoveries use threshold 10 and guaranteed, distinct evidence credits totaling 10. A single listed Resource sample is 0.01 m³; Component samples are whole counts. These credits are additive to any ordinary experimental outcomes, bounded by existing signature/credit rules. Compile one-sample routes with `items` and min/max sample bounds; paired routes use existing `distinct` sample selectors. Use separate evidence IDs and bounded credits, and assert guaranteed totals under current repetition discounts and evidence-credit semantics.

| Discovery | Eligibility | Guaranteed evidence, in order | Fabrication unlocked |
|---|---|---|---|
| `modularStructures` | Existing `structuralFabrication` | 1 iron: 4; 1 iron + 1 conductiveParts: 6 | Structural Frame, Small Cargo Module, Small Fuel Tank (tank also requires propellant handling) |
| `autonomousCoreDesign` | Modular structures + existing `circuitAssembly` | 1 electronicParts: 6; 1 electronicParts + 1 conductiveParts: 4 | Basic Autonomous Core |
| `reactionPropulsion` | Modular structures + existing electrical fabrication | 1 iron + 1 conductiveParts: 4; 1 electronicParts + 1 conductiveParts: 6 | Basic Reaction Thruster |
| `propellantHandling` | Modular structures | siliconMinerals: 4; siliconMinerals + 1 iron: 6 | Reaction-Mass Cartridge; supporting tank knowledge |
| `modularExtraction` | Modular structures + electrical fabrication | siliconMinerals: 4; siliconMinerals + 1 conductiveParts: 6 | Basic Extraction Module |

Basic Power Module uses existing photovoltaic knowledge; Basic Radio Module uses existing radio knowledge. Reuse the exact existing discovery IDs when authoring. A loose recovered reaction thruster may instead provide 10 guaranteed reaction-propulsion evidence as a consumed Product sample. A loose existing mineral extractor may offer an optional extraction evidence route. Neither Product is required to learn its own recipe.

### Off-site material technologies

Ore acquisition reveals an ordinary Resource, not a finished module design. Experiments with that material and existing hardware establish reusable engineering discoveries. Use threshold 10, with distinct single-material evidence worth 4 and paired evidence worth 6; do not consume an output whose own recipe is locked by the discovery being investigated.

| Discovery | Eligibility | Evidence: 4, then 6 | Component recipes unlocked |
|---|---|---|---|
| `lightAlloyMetallurgy` | Structural fabrication | titaniumOre; titaniumOre + 1 iron | Titanium Alloy Stock |
| `polymerSynthesis` | Electrical fabrication | carbonaceousRock; carbonaceousRock + siliconMinerals | Polymer Seal Pack |
| `compositeFabrication` | Polymer synthesis | carbonaceousRock; carbonaceousRock + 1 polymerSealPack | Carbon Composite Panel |
| `permanentMagnetMachinery` | Electrical fabrication + circuit assembly | rareEarthMinerals; rareEarthMinerals + 1 conductiveParts | Magnetic Alloy Parts |
| `precisionActuation` | Permanent-magnet machinery + circuit assembly | 1 magneticAlloyParts; 1 magneticAlloyParts + 1 controlBus | Precision Actuator; supporting Magnetic Drive Assembly knowledge |
| `tungstenMetallurgy` | Structural fabrication | tungstenOre; tungstenOre + 1 iron | Tungsten Alloy Stock, Tungsten Tool Head |
| `pressureSystems` | Light-alloy metallurgy + polymer synthesis | 1 titaniumAlloyStock; 1 titaniumAlloyStock + 1 polymerSealPack | Pressure Vessel, Coolant Canister |
| `highTempCeramics` | Tungsten metallurgy | siliconMinerals; siliconMinerals + 1 tungstenAlloyStock | High-Temperature Ceramic |

Magnetic Drive Assembly requires permanent-magnet machinery and precision actuation. Coolant Canister additionally requires its actual ice/container inputs; pressure knowledge grants neither ice nor a thermal simulation. These technologies can unlock future industrial Products through the same recipe requirements.

### Advanced module evidence

Keep module discoveries distinct from material knowledge. Proposed threshold-10 routes use two distinct experiments worth 4 and 6:

| Discovery | Eligibility | Evidence: 4, then 6 |
|---|---|---|
| `crewedCoreDesign` | Pressure systems + composite fabrication | 1 titaniumAlloyStock + 1 carbonCompositePanel; 1 pressureVessel + 1 controlBus |
| `lightweightCargoDesign` | Light-alloy metallurgy + composite fabrication | 1 titaniumAlloyStock; 1 titaniumAlloyStock + 1 carbonCompositePanel |
| `improvedFuelTankDesign` | Pressure systems | 1 pressureVessel; 1 pressureVessel + 1 polymerSealPack |
| `efficientDriveDesign` | Permanent-magnet machinery + precision actuation + high-temperature ceramics | 1 magneticDriveAssembly; 1 tungstenAlloyStock + 1 highTempCeramic |
| `improvedExtractionDesign` | Precision actuation + tungsten metallurgy | 1 precisionActuator; 1 tungstenToolHead + 1 controlBus |

Material and module routes must compile into the existing evidence schema; eligibility precedes consumption. Verify exact sample signatures, discounts, shared evidence, and required credits in the production reachability test. Do not create a special deterministic research engine. Add hints about evidence and material roles without listing unrelated undiscovered recipes, and retain additive save compatibility for old discoveries.


## 15. Exploration, recovered hardware, and alternate research evidence

A checked once-only recovery may grant one ordinary module Product independently of its fabrication recipe. It appears as recovered hardware in the Shipyard when physically available and may be placed and assembled immediately, including a recovered compatible Core. Compatibility, structure, stock, berth, and authority still apply. Knowing a design never supplies missing hardware.

For an optional nearby wreckage route, a Basic Reaction Thruster occupies 0.80 m³; the existing checked grant must verify storage before granting or marking recovery complete. The player can retain this one thruster and research reproduction with ordinary Components, or sacrifice the loose Product as an ordinary research sample for guaranteed reaction-propulsion evidence. Do not reveal its recipe while the design is unknown. The fresh-game guarantee does not depend on this salvage.

Later wrecks may supply improved modules or a Crewed Core. These are physical alternatives to fabrication requirements, not grants of the associated discoveries. A recovered Crewed Core can therefore be used before material technologies are known; constructing another still requires off-site Components and design knowledge. Keep grants bounded, checked, and once-only. No new loose-item damage/reliability system is needed.

Installed composition is not inventory stock and cannot be passed to the Research bench as a loose Product. Refits, removal, and dismantling remain deferred. Do not promise “install then sacrifice” without such a mechanic. The current ordinary routes let a player install the recovered unit and learn reproduction later through Component experiments, or choose to sacrifice it before assembly. An optional installed-hardware study route can reuse an explicit authorized inspection action at a stationary berth: award a bounded one-time evidence clue through existing Research contracts, then complete the discovery at the ordinary bench. Define and test that narrow action before authoring content that depends on it; previews, assembly, loading a save, and narrative rendering must never award inspection evidence. It is not required for bootstrap acceptance.

Off-site raw samples and recovered machinery provide overlapping evidence choices rather than a mandatory material sequence. Drone extraction transports physical samples home; it does not grant the player's personal inspection flags remotely. Existing derelict personal-exploration clues remain available once the player can actually visit.


## 16. Detached Shipyard draft

Create a presentation-owned draft with yard ID, optional selected core, attachments, a local draft placement counter, and optional proposed vessel name. Every placement holds module definition ID and integer x/y; the core is anchored at 0,0. Placement keys are local assembly addresses, not entities or physical inventory identities.

The inventory is counted by type, so availability references are yard ID + Product ID + required count. Do not pretend the player owns distinct serialized module instances. Repeated placements consume repeated units of the same Product.

Use pure domain functions for create/change/validate/derive. Return new detached draft results, diagnostics, geometry, and a capability preview. Derived metrics may be cached in presentation against a draft/catalog revision but are never authoritative or saved.

The draft does not debit, reserve, move cargo, allocate entity IDs, append facts, advance time, or call the save function. Opening/toggling the tab and dragging remain read-only world interactions. Keep the draft across ordinary tab switches; clear or explicitly invalidate it when its yard becomes unavailable or the player leaves. Reload starts a new draft.

Stock changes from crafting, research samples, other actions, or Processing require rechecking availability. Display counts as current physical stock minus draft placements, without pretending the remainder is reserved. No world-state revision token or generic reservation framework is necessary; commit revalidation is sufficient.

## 17. Placement, overlap, connectivity, and compatibility

Use half-open rectangles: each footprint occupies x through x+width and y through y+height. Overlap requires positive intersection in both axes. Orthogonal contact requires equal opposing x or y edges and strictly positive overlap on the other axis. Corner contact has zero shared edge and is invalid as a connection.

Build the module contact graph, then BFS from the one core. All attachments must be reached. Root selection never changes because another module happens to have more neighbors. Negative coordinates are legal; coordinates/extents must be safe integers. Reject zero/invalid footprints, coordinates, unknown definitions, missing/multiple cores, duplicate placement keys, illegal rotations/extra fields, overlaps, and incompatible definitions.

Start with O(n²) rectangle-pair checks plus O(n+edges) BFS. This avoids allocating every occupied cell when modules become large. Profile before adding spatial indexing. Use rendering virtualization and safe coordinate/arithmetic bounds as necessary; do not impose a gameplay `MAX_MODULES = 8`.

Reject an overlapping drop by restoring the previous draft placement. Allow disconnected nonoverlapping intermediate drafts, mark their orphans, and disable Assemble. Removal of a bridge can deliberately leave an invalid draft for repair. Recenter changes only the camera. Clear resets the draft without returning or consuming items because none were reserved.

Assembly has hard structural/stock/authority errors: core-only is a hard error even if its core has baseline capabilities. Missing useful capabilities remain warnings. Core + cargo or core + radio can assemble but cannot move; core + thruster is structurally valid but may lack fuel/power. An empty tank, unpowered miner, or cargo-less extraction platform with at least one attachment can exist; actions explain actual operation limits. Do not require a functional archetype.

## 18. Saved composition and live definitions

Persist `locations[id].assembly` with a core placement and a nonempty attachments array. Each placement records a stable placement key, module definition ID, and x/y. Only the core can have role core. Repeated module IDs are legal; repeated keys are not. Keep canonical attachment ordering by placement key, independent of drag/render ordering. Committed core-only shells fail validation; detached draft-only cores are permitted.

Persist the dedicated fuel map and existing equipment condition/journey/cargo state. Do not persist derived geometry, mass, module dimensions, capacity totals, speed, thrust, power output/demand, or a baked capability manifest. Composition does not need a whole blueprint library or balance-version snapshot.

Reserved module-group quantities may appear in the existing serialized infrastructure shape as the compatibility cache described in section 10. On load, discard their authority and reconstruct from validated composition. They contain structural membership counts only. Do not use them to recover missing composition or refund items. Existing loose equipment runtime state remains subject to ordinary validation.

Definition changes have explicit consequences:

| Change | Behavior |
| --- | --- |
| Cargo capacity, dry mass, volume, speed, generation, or fuel rate | Recompute from current definitions for existing vessels. Saved placements remain identical. Future actions/quotes use new values. |
| Cargo capacity decrease | Recoverable overload using existing cargo policy; no deletion. |
| Tank capacity decrease or cartridge volume increase | Dedicated fuel overload retained; consumption/unloading possible; further growth blocked. |
| Power capacity decrease below current stored power | Validate raw power as finite, nonnegative, and within utility numeric bounds; derive current passive capacity, then set power to min(valid stored power, capacity). Excess energy dissipates. No migration solely for ordinary modular-vessel rebalance, no old-capacity snapshot, and no repair of malformed values. |
| Footprint change invalidating layout | Fail with a precise vessel/layout compatibility error and preserve the save, or supply an explicit reviewed deterministic layout migration. |
| Removed module definition / changed category / core role or control meaning | Explicit content/save migration required. Do not replace with another core or disappear installed Products. |
| Equipment capability change | Rebuild live capability projection. Accepted Processing runs keep their existing committed parameters and use existing maintained-capability checks. |
| Terminal entity retaining assembly | Retain syntactic composition for historical identity/assets, without requiring current module definitions to narrate the old assembly occurrence. Live reactivation/operating entities remain strict. |

Volume is live too: stored module cargo occupancy and installed geometry both change from the same item field. Do not snapshot either one. Content edits and compilation occur at reload, not hot in a partially running frame.

## 19. State lifecycle and reconciliation order

Add a `vessels` lifecycle participant in the single default manifest. It owns assembly/fuel shape validation, derived installed membership, modular occupancy feasibility, and clear content-compatibility errors. Do not add a root Shipyard slice for a transient draft.

Ensure validated composition and derived group counts are available before entity-local/equipment/utility validation, ship validation, and Processing queries. A practical manifest order is entities, authority, vessel normalization/validation, entity-instances, ships, then the remaining participants. Within vessel reconciliation: validate present composition, equipment condition, and raw power; initialize only legitimately new neutral groups; derive group quantities/current passive power capacity; then clamp excess electrical reserve. Existing entity reconciliation may add other item/groups afterward; repeat passes must be idempotent. Preserve entity seeding/counters. Active/inactive modular entities receive this live rule; terminal retained records receive catalog-independent syntactic composition validation without rebalance dissipation. Legacy ships keep existing behavior.

Power 10 with newly derived capacity 8 becomes 8; a second pass leaves it 8. Negative, NaN, infinite, nonnumeric, missing required existing power, or out-of-range values fail before clamping. Clamp only valid excess energy, never cargo/fuel, and emit no construction event, reward, or narrative/ledger transition for balance reconciliation. Existing utility validation runs after normalization.

Bind action reconciliation in bootstrap to rebuild/validate vessel membership before its existing contact reconciliation. Do not run all load reconciliation on every frame or silently seed gameplay assets through an action. There is no composition mutation during ordinary simulation; creation explicitly initializes the full assembly before any dependent creation validation.

Fail malformed present authoritative fields. Missing `assembly` on old legacy entities means legacy behavior; missing assembly on a modular template is corruption. Only a missing neutral dedicated fuel map on an otherwise valid assembled vessel may normalize to empty. Reconciliation never consumes/refunds stock, refills fuel, grants discoveries, replays rewards, creates assembly events, or moves modules.

## 20. Assembly transaction and entity creation

Add trusted `assembleVessel(candidate, request, services, actorId)` plus a pure preview. The player action binds `actorId = player` and accepts only yard/name/placements, never derived stats, permissions, owner, templates, or an arbitrary spawn specification.

Use the occupied active stationary site as the yard and initial stock source. Enable the Shipyard facility at Habitat explicitly through a location action collection/facility marker; this is not a new simulated machine. Future sites can opt into the same facility contract through content. Do not assemble while aboard a moving vessel or from remotely pooled warehouses in v1.

Commit sequence inside one candidate:

1. Reject malformed payloads and unavailable/incorrect yard placement.
2. Require existing `useFacilities`, `withdrawCargo`, and `manageEquipment` permission at the yard. Fabrication knowledge is not assembly authorization: physically stocked compatible Products are usable with unknown designs.
3. Rebuild the current layout and typed capability preview; check definitions, compatibility, exactly one core, at least one attachment, no overlap, and BFS connectivity.
4. Aggregate all module Product counts including the core. Add one `structuralFrame` per total installed module plus two power. The same module count costs the same assembly stock regardless of contacts, cycles, compactness, or dry mass. Use checked arithmetic; do not add recipe selection.
5. Preview the entire stock debit against the authoritative yard store. A UI preview is not evidence of current stock.
6. Perform the debit through existing checked quantity/exchange functions. No special Shipyard inventory.
7. Create one generated `ship` through the existing entity allocation/creation path, with the reusable modular definition, owner/controller player, private access, the yard's area and exact dock, empty cargo/fuel, and healthy/enabled equipment condition state.
8. Attach validated composition and derive module-group quantities before entity-local creation validation. Creation must never briefly validate a modular shell without assembly.
9. Append one `VESSEL_ASSEMBLED` record as the semantic owner.
10. The existing runtime reconciles, validates the entire candidate, saves, and commits. Publish outcomes only afterward.

Extend the trusted entity creation specification/initializer to carry a validated ship assembly and initialize its domain state before per-instance checks. Do not hand-build a second entity registry entry in Shipyard code. If authored `spawnEntity` uses this extension later, it must supply a complete valid assembly explicitly; absent assembly cannot produce a free ambiguous modular shell.

Use silent `createEntity`/`createEntities` inside the composite assembly operation, not `worldOperations.spawnEntity`, which currently records `ENTITY_CREATED`. The higher-level assembly record already conveys construction; avoid duplicate generic and specialized creation records for the same operation. Ordinary spawn operations keep their current generic record.

Allocation occurs on the candidate. A failed validation or save discards consumed stock, allocated ID/counter increment, location/authority state, fuel initialization, and ledger append/eviction. Do not promise an ID before commit or reuse draft placement counters as entity IDs. Optional naming follows existing display names and adds a sensible bounded input validation rule.

## 21. Ship/navigation and narrow drone commands

Keep existing area/docking/journey state and simulation integration. Add core boardability to the board target list and domain checks. Validate that a player or NPC cannot be saved/relocated into an autonomous nonboardable vessel even through a direct effect or malformed save. Keep crewed passenger behavior on legacy vessels intact.

Existing domain navigation already accepts `shipId` and `actorId`; player navigation actions currently bind the occupied ship. Add a small drone command family selecting an active known autonomous vessel and using those explicit parameters. It must not set `state.locationId` or grant passenger navigation.

Supported initial commands:

| Command | Execution |
| --- | --- |
| Undock, travel, dock | Existing `navigate` with selected vessel ID, modular quote/fuel, and player as initiating principal. |
| Start one mining batch | Existing `startProcess` with selected drone host and a compatible node at its actual dock. |
| Transfer cargo to/from berth | Checked `moveExact` after requiring one endpoint is the selected drone and the other its exact stationary dock. |
| Load/unload fuel | The same dedicated fuel actions and concrete endpoint checks. |
| Inspect command status | Detached permitted projection of journey, fuel/cargo, equipment, and Processing readiness. |

Access policy: a player co-located at the drone's exact berth can issue local service/launch commands. Otherwise require an operational `radio` capability on both the occupied player host and the drone. A radio authorizes this game's command interface; v1 has no range, propagation-delay, bandwidth, or line-of-sight mechanic. Do not claim those. Remote commands target known locations/vessels and retain every operation's existing authority and physical feasibility checks.

Movement requires `pilot` on the drone and destination access. Mining requires `useFacilities`/output deposit on the drone and `useFacilities` on the source site; current Processing owns claims and source access. Transfers require withdraw/deposit permission on the concrete endpoints. Detail reads require the same cargo/facility permissions as ordinary views. Payloads cannot choose an actor or grant ownership.

Refactor shared transfer feasibility only enough to let the drone wrapper supply its constrained endpoint relationship; keep ordinary `locationTransferReason`'s current-location policy. Record actual drone cargo movement with the existing `RESOURCE_TRANSFERRED` type and principal actor. Fuel compartment movement need not invent a transfer fact that misrepresents same-entity tanks as another location; ordinary action feedback is sufficient for v1.

Preserve the existing global Processing actions' occupied-host restriction. Add an explicit command wrapper for another host and factor `processingWorkshopView` into an occupied-host wrapper over a shared permitted host query. Its readiness comes from the same `calculateProcessingReadiness` used by simulation/narrative. Do not recreate blocker calculations in Shipyard.

Mining at a dock already works; leaving that source causes the existing run to block, not silently mine at a distance. Buffered delivery follows existing rules. The first drone command starts exactly one batch; the player issues subsequent commands. Abort remains the existing reviewed-loss action, with a drone wrapper requiring the same review and authority. Do not add mining/travel/return scripts disguised as commands.

Put command/status controls in Locations' selected-vessel details, within the CRT, alongside existing navigation/transfer presentation. Construction stays in Shipyard. Future goals call domain operations; they do not drive the UI or reuse Shipyard draft logic.

## 22. Initial Resources, Components, and module content

These are first-pass balance values for ordinary content, not immutable architectural constants. Keep the requested item IDs and names. Exactly five new Resources, three Habitat Components, eleven off-site Components, two Cores, six basic attachments, and four improved attachments are proposed. No extra material category or hidden ship-only production engine is needed.

### 22.1 Basic modules: physical and functional values

All physical envelope volumes compile through canonical Product `unitVolumeUnits`. At `SHIPYARD_CELL_SIZE_METERS = 1`, depth = envelope volume / footprint area. Mass is structural dry mass only.

| Product | Footprint | Envelope m³ | Depth m | Dry kg | Functional contribution |
|---|---|---:|---:|---:|---|
| Basic Crewed Core | 2×2 | 4.00 | 1.000 | 220 | Crewed core; supports player entry |
| Basic Autonomous Core | 1×1 | 0.50 | 0.500 | 45 | Autonomous core; control remains with authorized player |
| Small Cargo Module | 2×2 | 1.50 | 0.375 | 85 | 0.50 m³ general cargo |
| Small Fuel Tank | 1×2 | 0.80 | 0.400 | 35 | 0.25 m³ dedicated cartridge tank: 25 units |
| Basic Reaction Thruster | 1×2 | 0.80 | 0.400 | 55 | Propulsion speed contribution 10; distance-per-fuel parameter 10 |
| Basic Power Module | 1×1 | 0.50 | 0.500 | 25 | Existing equipment power generation +0.50/s; reserve capacity 10 |
| Basic Radio Module | 1×1 | 0.25 | 0.250 | 8 | Existing radio capability |
| Basic Extraction Module | 1×2 | 1.00 | 0.500 | 65 | Existing surfaceExtraction capability; baseline Processing multipliers 1 |

“Basic Cargo Module” and “Basic Fuel Tank” in progression prose mean the same Small Cargo Module and Small Fuel Tank Products, not additional variants. Core/shell base electrical reserve is zero. A tank is fabricated empty. Radio adds capability, not automatic command orders or a radio-range simulation.

### 22.2 Five new ordinary raw Resources

Resources use the existing continuous-volume inventory model, are never fabricated, and initially have zero Habitat stock. A research sample is 0.01 m³. Ordinary authored tags identify evidence/material families without granting discoveries on pickup.

| ID / name | Suggested evidence tags | Identity and reusable role |
|---|---|---|
| `titaniumOre` / Titanium Ore | metal, titanium | Titanium-bearing metallic ore for lightweight alloys, frames, and pressure structures |
| `carbonaceousRock` / Carbonaceous Rock | carbonaceous, carbon | Carbon-rich body material containing organic/carbon compounds for polymers, seals, composites, and housings |
| `rareEarthMinerals` / Rare-Earth Minerals | mineral, rareEarth | Uncommon-element mineral feedstock for magnets, motors, generators, actuators, and sensors |
| `tungstenOre` / Tungsten Ore | metal, tungsten | Dense tungsten-bearing ore for wear-resistant tools and high-temperature machinery |
| `waterIce` / Water Ice | ice, water | Frozen water-bearing material from cold deposits; ordinary commodity and future shielding/coolant/chemistry feedstock |

Tungsten Ore replaces the proposed abstract Refractory Metal Ore; inspection found no current catalog item requiring a rename/migration. Rare-Earth Minerals are not nuclear fuel. Do not add Uranium Ore, Hydrogen, Oxygen, electrolysis, radiation shielding, continuous fluid/coolant consumption, or life support in this pass. Water Ice remains broadly useful by content role even before all future consumers exist, and is never necessary for first departure.

### 22.3 Geographic sources and world additions

Add four ordinary areas and four dockable stationary source locations. Keep existing areas, locations, and nodes intact. Coordinates use current navigation units, not Shipyard meters; with the current 120-unit link threshold all proposed areas connect directly to Habitat vicinity (0,0). Destinations are known/active without material-key gates.

| Area / stationary location IDs | Coordinates | New finite extraction nodes | Design opportunity |
|---|---|---|---|
| `metallicFragmentArea` / `metallicFragment` | (40, 0) | Titanium Ore 1.00 m³; Rare-Earth Minerals 0.50 m³ | Nearest bootstrap destination: lighter structures and electromechanical machinery |
| `carbonaceousBodyArea` / `carbonaceousBody` | (-35, 45) | Carbonaceous Rock 1.00 m³ | Composites, seals, pressure systems, crewed engineering |
| `denseMetallicBodyArea` / `denseMetallicBody` | (-70, -40) | Tungsten Ore 0.50 m³ | Tooling, extraction, ceramics, propulsion/industry |
| `icyBodyArea` / `icyBody` | (85, -65) | Water Ice 1.00 m³ | Commodity, coolant Components, future chemistry/shielding |

Each source location has ordinary 1.00 m³ cargo storage, initial power/stock zero, and no free fuel cache or generator. Give public enter/dock/useFacilities/viewCargo/depositCargo/withdrawCargo authority through existing grants. These are reachable extraction berths, not free factories; the drone supplies its own machine and power. Do not place all five Resources in Habitat nodes, stock, starting grants, or local supply rewards.

Use node tags `solid` and `prospectable` and one ordinary `prospectResource` extraction process: existing surfaceExtraction capability, source tag prospectable, 0.01 m³ output per 20-second batch, baseline power 0.08/s, stationary source and docked ship hosts. Resolve the selected node's Resource through the current extraction contract. This requires no advanced research gate. It coexists with existing Habitat surface processes and does not retag their nodes or change their output rates. Validate the drone's useFacilities/deposit authority and same-area docking, and require positive starting vessel power under current Processing rules. An output buffer alone is not cargo transport.

Seed these new locations/nodes once through existing world-content reconciliation; loading must not replenish depleted nodes. Recipe and research material gates must not be navigation gates. Section 23 demonstrates harder destinations reached early with additional basic tanks.

### 22.4 Fourteen ordinary Components

All following items have `category: component`, positive canonical volume, whole-number outputs, and normal inventory/research semantics. Pressure Vessel and Magnetic Drive Assembly are Components despite their names: they are inputs to finished Products, not installable machinery themselves. Resource quantities below are m³; Component quantities are counts. Author batch output through the existing recipe `amount` field (5 for cartridges/seal packs, 2 for the listed stock/panel/parts/ceramic batches, otherwise 1), and inputs through ordinary `item`/`quantity` slots. Thus the cartridge recipe uses `amount: 5`, siliconMinerals quantity 0.05, and iron quantity 1. Every recipe inherits the existing fabrication prerequisite, plus the listed discoveries. Bind critical off-site slots to their specific materials so generic substitutions cannot replace titanium/carbon/tungsten/rare-earth inputs with Habitat iron.

| ID / name | Unit m³ | Batch output | Exact proposed inputs | Additional discovery |
|---|---:|---:|---|---|
| `structuralFrame` / Structural Frame | 0.020 | 1 | 2 iron | modularStructures |
| `controlBus` / Control Bus | 0.005 | 1 | 1 conductiveParts + 1 electronicParts | Existing circuitAssembly |
| `reactionMassCartridge` / Reaction-Mass Cartridge | 0.010 | 5 | 0.05 siliconMinerals + 1 iron | propellantHandling |
| `titaniumAlloyStock` / Titanium Alloy Stock | 0.005 | 2 | 0.04 titaniumOre + 1 iron | lightAlloyMetallurgy |
| `carbonCompositePanel` / Carbon Composite Panel | 0.020 | 2 | 0.04 carbonaceousRock + 0.01 siliconMinerals | compositeFabrication |
| `polymerSealPack` / Polymer Seal Pack | 0.002 | 5 | 0.02 carbonaceousRock | polymerSynthesis |
| `magneticAlloyParts` / Magnetic Alloy Parts | 0.003 | 2 | 0.02 rareEarthMinerals + 1 conductiveParts | permanentMagnetMachinery |
| `precisionActuator` / Precision Actuator | 0.005 | 1 | 1 magneticAlloyParts + 1 controlBus + 1 structuralFrame | precisionActuation |
| `tungstenAlloyStock` / Tungsten Alloy Stock | 0.005 | 2 | 0.03 tungstenOre + 1 iron | tungstenMetallurgy |
| `tungstenToolHead` / Tungsten Tool Head | 0.008 | 1 | 1 tungstenAlloyStock + 1 structuralFrame | tungstenMetallurgy |
| `highTempCeramic` / High-Temperature Ceramic | 0.006 | 2 | 0.02 siliconMinerals + 1 tungstenAlloyStock | highTempCeramics |
| `pressureVessel` / Pressure Vessel | 0.100 | 1 | 2 titaniumAlloyStock + 2 polymerSealPack | pressureSystems |
| `magneticDriveAssembly` / Magnetic Drive Assembly | 0.025 | 1 | 2 magneticAlloyParts + 1 precisionActuator + 1 controlBus | permanentMagnetMachinery + precisionActuation |
| `coolantCanister` / Coolant Canister | 0.150 | 1 | 0.03 waterIce + 1 pressureVessel + 1 polymerSealPack | pressureSystems |

The first three use only current Habitat feedstocks. The other eleven directly or transitively require off-site Resources. Recipes fit the current Component crafting architecture: raw Resources plus Components as inputs, Component output, no new category. Volumes are balance/packing values; there is no general density or stoichiometric conservation model.

For the minimum pass, use ordinary crafting recipes. Optional timed refining can use existing thermalRefining/thermalProcessor contracts and bounded Resource/Component input/output arrays (maximum eight lines); it must not become a hidden prerequisite for the first vessel. Product recipes remain Component-only, and Processing never outputs module Products. No additional refining engine is justified by this content.

Non-Shipyard extensions can use Titanium Alloy Stock for machine frames, Carbon Composite Panel for equipment housings, Polymer Seal Pack for pumps, Magnetic Alloy Parts for generators/motors, Precision Actuator for automation, Tungsten Tool Head for industrial extraction, High-Temperature Ceramic for refinery internals, Pressure Vessel for process machinery, and Magnetic Drive Assembly for industrial drives. Coolant Canister is ordinary stock until a real consuming mechanic is approved. These roles do not require implementing all consumers now.

### 22.5 Habitat bootstrap Product recipes

All module recipes consume Components only and produce one Product, with the existing fabrication requirement. No off-site inputs or fabricated raw Resources are allowed.

| Module | Proposed Component inputs | Design/supporting knowledge |
|---|---|---|
| Basic Autonomous Core | 2 structuralFrame + 2 controlBus + 1 electronicParts | autonomousCoreDesign |
| Small Cargo Module | 3 structuralFrame | modularStructures |
| Small Fuel Tank | 2 structuralFrame + 1 controlBus | modularStructures + propellantHandling |
| Basic Reaction Thruster | 2 structuralFrame + 1 controlBus + 1 conductiveParts | reactionPropulsion |
| Basic Power Module | 2 structuralFrame + 1 controlBus + 2 solarCells | Existing photovoltaic discovery |
| Basic Radio Module | 1 structuralFrame + 1 controlBus + 1 electronicParts | Existing radio discovery |
| Basic Extraction Module | 2 structuralFrame + 1 controlBus + 1 conductiveParts | modularExtraction |

These seven Products consume 14 frames and 7 buses in fabrication. Final assembly consumes seven additional frames and 2 existing power, independently of contact-edge count. Tank fabrication consumes no loaded cartridges. Produce fuel separately through the five-cartridge recipe.

### 22.6 Improved modules and crewed fabrication

All variants use the same placement, canonical geometry, equipment, propulsion, fuel, and Processing contracts as basic modules. Tradeoffs are actual supported properties; do not add invented reliability/durability ratings.

| Product / proposed ID | Footprint / envelope / dry mass | Supported tradeoff | Component inputs; design |
|---|---|---|---|
| Lightweight Cargo Module / `lightweightCargoModule` | 1×3 / 1.20 m³ / 45 kg | Cargo 0.60 m³: fraction 0.50 versus basic 1/3; lighter, elongated mounting | 2 titaniumAlloyStock + 2 carbonCompositePanel + 1 structuralFrame; lightweightCargoDesign |
| Improved Fuel Tank / `improvedFuelTank` | 2×1 / 0.90 m³ / 25 kg | Fuel 0.60 m³ (60 cartridges); lighter, wider footprint and slightly larger envelope | 2 pressureVessel + 2 titaniumAlloyStock + 2 polymerSealPack + 1 structuralFrame; improvedFuelTankDesign |
| Efficient Drive Module / `efficientDriveModule` | 1×3 / 1.20 m³ / 70 kg | Speed 15; distance-per-fuel 18; larger/heavier; equipment.powerPerSecond -0.05 while enabled | 1 magneticDriveAssembly + 2 highTempCeramic + 2 tungstenAlloyStock + 1 structuralFrame; efficientDriveDesign |
| Improved Extraction Module / `improvedExtractionModule` | 2×2 / 1.40 m³ / 80 kg | surfaceExtraction with supported speedMultiplier 2 and powerMultiplier 1.5; larger/heavier and higher instantaneous power | 1 tungstenToolHead + 1 precisionActuator + 1 controlBus + 2 structuralFrame; improvedExtractionDesign |

The efficient drive's demand is an actual continuous equipment cost while enabled, using existing quantity/health scaling; -0.05/s is the full-health per-unit value. It is not an invented travel-only power parameter. The improved extractor processes the proposed batch in 10 seconds at 0.12 power/s, versus 20 seconds at 0.08: 1.2 versus 1.6 power per batch, with greater instantaneous demand. Reuse existing per-machine multipliers and slot rules: repeated extractors increase available concurrent slots; their multipliers do not stack into a single faster run. Group condition remains shared as in section 10.

Basic Crewed Core recipe: 8 structuralFrame + 4 titaniumAlloyStock + 4 carbonCompositePanel + 4 polymerSealPack + 2 pressureVessel + 3 controlBus + 2 electronicParts. Require crewedCoreDesign and supporting pressure/composite knowledge. Its envelope/dry mass remain 4.00 m³ / 220 kg. Fabrication therefore requires metallic and carbonaceous exploration; a recovered compatible Core is the physical-possession exception. Material requirements convey person-carrying engineering complexity without atmosphere/life-support simulation.

Iron remains the cheap/common/heavy structural baseline. Reduced module mass comes from authored alternative Product definitions, not an ingredient-quality system that infers statistics from whichever substitute was consumed.


## 23. Autonomous bootstrap, exploration, and later crewed construction

The default fabrication progression is Habitat industry → crude autonomous prospector → off-site Resources → reusable material technologies → module tradeoffs → crewed or specialized vessels. This supersedes the earlier proposal that both useful crewed and autonomous builds could be fabricated entirely from Habitat materials. Recovered hardware remains an alternative physical route. After bootstrap, the player can pursue different destinations/technologies in different orders; no mandatory upgrade chain is imposed.

### 23.1 True minimum useful autonomous prospector

All seven proposed modules are mechanically needed for the complete first extraction-and-return loop:

| Module | Why this minimum needs it |
|---|---|
| Basic Autonomous Core | Defines the unoccupied commanded vessel |
| Small Cargo Module | Holds mined output and enables transport/use; a Processing buffer alone cannot deliver stock into a zero-capacity hold |
| Small Fuel Tank | Dedicated fuel storage; cartridges in cargo do not fuel travel |
| Basic Reaction Thruster | Operational propulsion required for departure |
| Basic Power Module | Core/shell reserve capacity is zero; provides capacity 10, generation 0.50/s, and power for navigation/Processing |
| Basic Radio Module | Command link after launch so the player at Habitat can order docking, mining, and return |
| Basic Extraction Module | Supplies surfaceExtraction for the actual off-site batch |

Also install the existing radioAntenna at the player's Habitat host; the link needs radio at both ends. This stationary antenna is not an eighth vessel module. Local yard commands alone cannot complete a remotely controlled journey without the link, and commands are not queued.

Generation is a general capability warning rather than a structural assembly requirement. It is specifically necessary for this minimum because no other listed hardware supplies a usable electrical reserve. A future alternative with real reserve/transfer support may change the useful minimum without changing structural validity.

### 23.2 Hard fresh-game anti-deadlock acceptance

Implement an end-to-end production integration test, not only a recipe graph or injected ready-made vessel. Start with ordinary fresh state, seeded RNG, no new off-site stock, no discovered new technologies, and no free module grants. Use registered gameplay actions and elapsed simulation time. Required sequence:

1. Inspect the damaged fitting and research existing structural fabrication using scrap. Learn electricalConduction with scrap + electronicSalvage; learn circuitAssembly with electronicSalvage + conductiveParts. Inspect solar hardware, then research photovoltaicFabrication with siliconMinerals + electronicSalvage and siliconMinerals + electronicParts. Learn radioAssembly using electronicParts and electronicParts + conductiveParts. These are current bench routes; no-power research/fabrication remains possible.
2. Fabricate two iron and use the existing solar repair action. Current Habitat generation rises from 0.10/s to 0.50/s against 0.20/s life-support demand: net +0.30/s. The damaged starting solar is not assumed sufficient for sustained power.
3. Complete all five new bootstrap discoveries using the exact eligible evidence routes in section 14. Check guaranteed credits/signatures and real sample consumption; do not directly set discoveries or bypass the ordinary repetition/credit rules.
4. Fabricate seven module Products, the existing stationary radio antenna, seven additional final-assembly frames, and 25 Reaction-Mass Cartridges. Install the antenna through its existing action and respect its installation limit/capability.
5. Assemble a connected valid autonomous prospector using the production action. Assert 318 kg DRY MASS, summed envelope volume 5.35 m³, seven-frame/two-power assembly charge, empty initial tank/cargo/power, player owner/controller, and docking at Habitat.
6. Load 25 cartridges into the dedicated 0.25 m³ tank using the real checked fuel action. Generate a full reserve of 10 before launch (20 seconds from empty at +0.50/s). Check current stock/capacity and command authority rather than granting power.
7. Undock, travel to metallicFragmentArea, wait for actual arrival, and command docking at metallicFragment. The player stays at Habitat. Check both radio ends, permissions, route link, fuel debits, and power payments.
8. Start the real prospectResource batch using the vessel's machine and battery against the site's finite Titanium Ore node. Advance the existing Processing simulation to deliver at least 0.01 m³ into the real vessel hold and reduce/claim the source correctly.
9. Undock, return to vicinity, dock at Habitat, and transfer the Resource into Habitat storage through the authorized dock-only command. Consume a real sample in a light-alloy experiment or otherwise demonstrate an actual permitted use. Outward arrival or a buffer-only output is insufficient.

No Titanium Ore, Carbonaceous Rock, Rare-Earth Minerals, Tungsten Ore, or Water Ice may be required before this first launch. The test must also run with optional local recovered-thruster content unused, proving fabrication is independently reachable. Include failed/blocked authority and stock variants without disguising them as successful reachability.

A conservative bill makes the capacity/material proof reviewable. Seven module recipes use 14 frames, 7 buses, 2 additional electronicParts, 2 additional conductiveParts, and 2 solarCells. Final assembly uses 7 more frames. Five cartridge batches use 5 iron and 0.25 m³ siliconMinerals; the stationary antenna uses 1 iron + 1 conductiveParts + 1 electronicParts; solar repair uses 2 iron.

Budget extra research samples conservatively: 4 iron, 8 conductiveParts, 8 electronicParts, and direct raw samples up to 0.03 m³ scrap + 0.025 m³ electronicSalvage + 0.07 m³ siliconMinerals. This exceeds the explicit distinct route bill and permits separate experiments instead of relying on shared evidence or random bonuses. Expanded total is 54 iron, 18 conductiveParts, 20 electronicParts, and 2 solarCells, including the cells' electronic input. Current recipes turn this into at most 2.55 m³ scrap, 0.315 m³ electronicSalvage, and 0.36 m³ siliconMinerals, all renewable at Habitat. At current acquisition amounts, 255 scrap actions, 63 salvage actions, and 36 mineral actions suffice; starting stock can reduce this effort.

Even an intentionally excessive simultaneous-space bound fits Habitat's existing 10 m³: all budgeted raw stock 3.225 m³ + all intermediate iron/conductors/electronics/cells/21 frames/7 buses 0.785 m³ + all seven module Products 5.35 m³ + all fuel 0.25 m³ + antenna 0.01 m³ = 9.62 m³. Actual staged fabrication consumes these inputs and needs less space. This is a storage upper bound, not a claim of volume/mass conservation or a requirement to hoard every intermediate.

Repaired Habitat can regenerate the assembly charge. The prospector generates +0.50/s against the proposed extraction demand 0.08/s, giving net +0.42/s while working; its positive starting battery satisfies Processing. The production test must confirm these calculations against final compiled recipes, discovery evidence/discounts, quantity units, action costs, host limits, and simulation. These are planning calculations, not already-passing implementation tests. If real integration fails, fix the smallest content balance/evidence/source contract causing the deadlock.

### 23.3 Reference builds and route arithmetic

| Build | Modules | Count / final frames | Dry kg | Sum envelope m³ | Cargo / fuel |
|---|---|---:|---:|---:|---|
| Crewed utility vessel | Crewed core + cargo + tank + thruster + power | 5 / 5 | 420 | 7.60 | 0.50 m³ / 25 cartridges |
| Bootstrap prospector | Autonomous core + cargo + tank + thruster + power + radio + extraction | 7 / 7 | 318 | 5.35 | 0.50 m³ / 25 |
| Drone transport | Autonomous core + cargo + tank + thruster + power + radio | 6 / 6 | 253 | 4.35 | 0.50 m³ / 25 |
| Hybrid utility drone | Prospector + second cargo module | 8 / 8 | 403 | 6.85 | 1.00 m³ / 25 |

Crewed utility fabrication requires explored materials; it supports personal travel/inspection without radio, but does not mine unless extraction is added. Drone transport trades mining capability for lower dry mass. The hybrid adds carrying capacity and travel cost. No player occupancy or NPC conversations are simulated for drone arrivals.

With one basic thruster, area fuel = ceil(distance / 10 × dry mass / 250), speed = 10 × 250 / dry mass, area power = existing 5; a local dock approach is distance 10 and power 1. Cargo and loaded fuel add no mass. Undocking is not an additional charged journey. At current outerReach distance approximately 100.623, one-way area charges are 17/13/11/17 cartridges for crewed/prospector/transport/hybrid; each local dock costs 2. Thus the prospector's round trip including destination/home docking costs 30, and the crewed utility costs 38. The old assertion that one tank covers every reference round trip is withdrawn.

Proposed direct routes for the 318 kg prospector:

| Source | Area distance | Area fuel each way | Dock fuel each end | Round trip | Basic-tank option |
|---|---:|---:|---:|---:|---|
| Metallic fragment | 40.000 | 6 | 2 | 16 | One tank (25); returns with 9 |
| Carbonaceous body | 57.009 | 8 | 2 | 20 | One tank; no titanium upgrade required |
| Dense metallic body | 80.623 | 11 | 2 | 26 | Add a second basic tank |
| Icy body | 107.005 | 14 | 2 | 32 | Add a second basic tank |

The extra tank adds 35 kg, yielding dry mass 353 kg and fuel capacity 50. Recompute rather than reuse the old quote: tungsten route becomes 12 cartridges each area leg + 2 each dock = 28 round trip; ice becomes 16 + 16 + 2 + 2 = 36. Both fit 50, permitting harder early trips with inefficient Habitat-built hardware. More fuel capacity is not free: extra fabrication/assembly stock, volume, footprint, and dry mass apply. No material-key door is introduced.

For the first metallic trip, departing at power 10 pays 5; travel takes 5.088 seconds and generates 2.544, arriving with 7.544. Dock pays 1; its 1.272-second approach generates 0.636, leaving about 7.180. Mining replenishes the reserve toward capacity 10 and leaves enough for return area/dock charges. Quote previews must show each debit and any required waiting, rather than implying a full tank guarantees sufficient electrical power.

### 23.4 Concrete connected reference layouts

Coordinates are rectangle lower bounds, not centers. Footprints are from section 22 and rotation is unavailable.

| Placement | Crewed utility | Drone transport | Bootstrap prospector |
|---|---|---|---|
| Core | (0, 0), 2×2 | (0, 0), 1×1 | (0, 0), 1×1 |
| Cargo | (-2, 0) | (-2, 0) | (-2, 0) |
| Tank | (2, 0) | (2, 0) | (2, 0) |
| Thruster | (3, 0) | (3, 0) | (3, 0) |
| Power | (0, 2) | (1, 0) | (1, 0) |
| Radio | Omitted | (0, -1) | (0, -1) |
| Extraction | Omitted | Omitted | (0, 1) |

At the 1-metre scale, crewed envelope is 6 × 3 × 1 m; transport is 6 × 3 × 0.5 m; prospector is 6 × 4 × 0.5 m. These bounding envelopes include gaps and are not summed module volumes or cargo capacity. Add the second basic tank at (4,0), touching the thruster: the prospector becomes 7 × 4 × 0.5 m, 353 kg, summed envelope volume 6.15 m³, eight final frames, and 50-cartridge capacity.

Check overlap and edge-connected BFS in tests, with current definitions and exact sums. These examples prove feasible arrangements, not mandatory archetypes, saved blueprint libraries, or a geometry-based assembly surcharge.


## 24. Shipyard UI architecture

Register Shipyard immediately after Research in `app.js`:

Operations → Workshop → Locations → People → Research → Shipyard.

Add only `#shipyard-panel` directly inside `#terminal-panels`; keep all new styling scoped to this panel/feature. Preserve the CRT housing, instrument bay, command zone, existing narrative-stream node, bottom terminal, and existing tab behavior.

Use Canvas, matching `locationDisplay.js`'s current pointer, pan/zoom, pixel-ratio, resize, and presentation-state conventions. Reuse interaction principles rather than copying or refactoring the entire map renderer. Use ordinary DOM controls alongside Canvas for accessibility, status, module selection, coordinate entry/movement, and removal. Do not require mouse dragging to operate the yard.

Three-column desktop workstation: approximately 25% palette, 50% dock, 25% metrics. On narrow screens, stack/reflow within the same viewport and permit panel-local scrolling; do not widen/rearrange the persistent instrument bay. The tab strip already supports overflow and keyboard navigation.

### Palette

- Show physically available compatible module Products in the yard even when fabrication knowledge is unknown. Unknown zero-stock designs are absent. Known zero-stock designs may appear as clearly nonplaceable rows.
- Require existing `viewCargo` permission before exposing exact stock/bill quantities; facility access alone must not disclose private inventory.
- Derive available counts from current inventory minus draft consumption. Mark unknown-design stock as recovered hardware with footprint, stock count, observed supported capabilities, and `Fabrication design: UNKNOWN`. Do not expose its recipe, prerequisite technologies, research scores, or unrelated zero-stock designs. No new loose-item provenance field is required.
- Categories are exactly the populated Core, Propulsion, Logistics, Systems, Industrial groups.
- Show footprint, unit volume, count, and pointer/keyboard placement control.
- Show Assembly Stocks with `Structural Frames — Required: N / Available: M`, where N includes the core, and the separate two-power final-commit charge. Module Products are the primary fabrication cost. Geometry/contact count never changes assembly stock.

### Dry dock

- Whole-cell snapping, core at origin, definition-sized rectangles, no rotation.
- Distinct core marker, overlap rejection, orphan/error indication with text as well as color.
- Pan/zoom/recenter, selection, move/remove, clear, and Assemble.
- Draft errors do not redraw or mutate world entities.
- Core replacement resets/revalidates placement according to the new core footprint; it never silently repositions attachments.

### Metrics

- Class and boardability.
- Estimated width/length/maximum depth, module count, and **DRY MASS**. Never call it gross/total/loaded mass; arbitrary cargo and loaded fuel have no mass data in v1.
- General cargo and dedicated fuel capacity, with empty-at-assembly state.
- Effective travel speed in existing navigation units/sec, not physical thrust/G.
- Selected-route whole-cartridge and power cost when a route is selected; otherwise a plainly labeled full-health quote example/policy, not invented range.
- Power generation, reserve capacity, actual continuous equipment demand where present, and actual Processing batch demand. Basic modules have zero idle demand; the efficient drive has an explicit supported -0.05 power/sec equipment rate, and improved extraction uses existing Processing multipliers.
- Installed capability list from actual compiled equipment/domain contracts.
- Structural/stock/authority blockers and useful-build warnings.

All displayed mechanical previews come from the same pure derivation/quote functions used by commit/actions. Keep runtime health separate from full-health new-build preview. Assembly defaults to empty fuel/power; show how to load cartridges and allow generation/power transfer before launch rather than granting inventory implicitly.

Keep a draft on save failure and show the actual error. On successful assembly clear the consumed draft and update stock; do not automatically board, launch, or switch to Operations. Construction narration can mark the existing Operations update indicator.

## 25. Operations/Narrative integration

Add `vesselFactProvider` to bootstrap's explicit read-only provider manifest. It consumes vessel-domain geometry/capability queries, existing visibility/authority, and recent assembly ledger records.

New current kinds: `module_geometry`, `vessel_geometry`, and `vessel_composition` with a bounded supported capability summary. New history kind: `recent_vessel_assembly`. Add their strict payload/subject contracts to `narrativeFacts.js`, observability topic IDs/metadata validation where required, and knowledge/exposure handling. Exact internal capacities, cargo quantities, fuel counts, and equipment condition require current permissions. Publicly visible local envelopes can support coarse geometry bands without exposing private hold contents or undiscovered internal designs.

Within an occupied yard context, the provider can describe a visible vessel assembled/docked there. It does not make the vessel the occupied subject or relax context-builder locality. Exact module inspection can remain a Shipyard/Locations mechanical detail view in v1; broad new remote narrative surfaces are unnecessary.

Add evidence-backed beat families and typed text slots for assembly and grounded layout descriptions. Prose belongs in `narrativeContent.js` and the existing text pipeline, never in vessel saved state or module metadata. Product inventory descriptions remain ordinary item labels/tooltips, not computed ship narratives.

Author the five raw-material identities and reusable Component descriptions in ordinary content. Where material identity is relevant to vessel prose, use a bounded explicitly authored observable tag/property from the current Product definition, exposed only through permitted facts. Never infer titanium reinforcement, pressure safety, shielding, or internal composition merely from recipe inputs, geometry, or item names. An unknown recovered module can expose its visible envelope and supported observed identity without revealing its locked recipe or unrelated technologies. The revised scale supports broad/shallow cargo and compact cores through section 8 predicates; dry mass remains structural mass only.

Extend the explicit assembly allowlist across `committedNarrativeSummary`, local trigger filtering, context trigger validation, and automatic beat eligibility. A local successful `VESSEL_ASSEMBLED` record triggers at most one contextual construction result. Failed actions/saves, drag movements, previews, reconciliation, and reload do not emit construction history or replay its prose.

An assembly beat can combine a historical completion fact and current geometry/composition. It must consume the existing mixed/history budget. Historical completion alone proves assembly occurred, not the vessel's old dimensions. After balance edits, current facts describe the current definition-derived craft; never label those values its dimensions at the original construction time. An entity's retained name is enough for an old construction occurrence after retirement or catalog changes.

Narrative examples such as a compact core cluster, a long modular frame, or cargo blocks extending the footprint require the corresponding numeric/layout facts and module identities. Do not use “exposed mining assembly” without an explicit supported observable identity/property; the existence of an extraction module alone does not prove exposed internals. Narrative failures remain isolated from successful gameplay commits.

Remote drone status is a permission-checked mechanical view and normal explicit command feedback. Do not expand automatic remote Processing reporting or NPC knowledge merely because a command link exists. A later remote reporting feature needs its own concrete observability policy.

## 26. World Ledger integration

Add one `VESSEL_ASSEMBLED` descriptor in `worldLedgerTypes.js`:

- `actorId`: initiating principal.
- `targetId`: new ordinary ship entity.
- `locationId`: stationary assembly yard.
- `areaId`: that yard's area at assembly.
- `data`: empty by default; optionally a small validated vessel-class enum if a historical class consumer actually needs it.

Entity identity and current composition provide the blueprint/current module details. Do not store an unbounded module list, capacities, coordinates, geometry, item bill, or prose in the ledger. An append-time check can confirm the target is a modular vessel at that berth, but historical validation must not consult current assembly/dock/capacity or require that it is still active.

Declare principal/ship/location/area reference roles using the existing retention contracts. Preserve terminal entity identities. History remains within existing FIFO/entry-size bounds and is neither a blueprint database nor a notification queue.

Only assembly records construction, exactly once. Existing ship departures/arrivals and Processing transitions continue through their current owners. Actual command cargo transfers can reuse `RESOURCE_TRANSFERRED`; there is no `VESSEL_REFITTED` until refitting exists.

## 27. Future Actor Goals, refits, and larger content

Expose reusable trusted operations with explicit candidate, acting principal, target vessel, and narrow services: navigation, fuel movement, cargo movement, and process start/abort. Goal systems can later inspect the current installed capabilities and decide which operation to request. They must not control a different physical drone model or mutate module layouts themselves.

No goals, actor simulation, queue, automated loop, or destination script lives in Shipyard. Initial commands are one action each, and the existing simulation handles travel/work continuation.

Saved placements support a later detached refit draft using the same keys/core/layout validation. A future refit operation must settle active Processing slots, cargo/fuel capacity reductions, returned module condition, materials, and docking authority atomically. Do not promise that full refitting is trivial because composition exists; those are concrete unresolved refit policies. Do not add “Remove installed module” buttons until they are resolved.

Larger footprints, more cargo/tank blocks, additional same-contract engines, radio designs, and Processing-capable refinery Products reuse the same authoring contracts. A refinery module providing `thermalRefining` already fits current Processing; a fabricator module can provide current fabrication/bench capabilities. Drone bays, station placement, habitation/crew, and weapons require their actual consuming systems when added, but do not require replacing vessel composition.

## 28. Migration and save-version policy

Recommend retaining **save version 9** for this first additive slice, provided implementation satisfies these conditions:

- Legacy entity types, definition references, quantities, journey encoding, and existing ship behavior keep their meaning.
- Old vessels without assembly continue unchanged. Valid modular-vessel power above a reduced live reserve intentionally dissipates during reconciliation; physical cargo/fuel overload is preserved.
- New item/groups reconcile with zero quantities; new discoveries have empty progress and do not grant rewards on load.
- Newly assembled vessels use optional per-location fields and the new reusable shell definition; no existing ship is converted into an assembled vessel.
- Missing assembly on the new shell fails rather than being defaulted; absent dedicated fuel can mean empty only for an otherwise valid assembly.
- No new on-disk field is required to reinterpret old authority, cargo, or RNG.

Keep new terminal composition validation catalog-independent where history/retained identity require it, while live authoritative modules remain strict. Extend entity creation validation and NPC/player occupancy checks consistently. Existing migrations from versions 1–8 still route through their frozen historical quantity/identity paths and then reconcile the additive current catalog.

If implementation instead changes the meaning of existing infrastructure quantities, alters old journey contracts, migrates old ships into layouts, or changes item units/category/identity, use an explicit v9→v10 migration. Do not claim those changes are additive. A future bump is a consequence of the chosen encoding, not an arbitrary expansion number.

Current localStorage serialization includes all state. Verify no transient draft/contexts/geometry or balance aggregates are written. Module-group counts are reconstructible; authoritative membership remains assembly. Failed migration, reconciliation, validation, or persistence preserves the original saved text. Normalization is deterministic/idempotent and creates no construction event or reward. The explicit min(storedPower, currentDerivedCapacity) rule permits valid energy dissipation, not malformed-state coercion or physical-stock deletion. New Resources/Components add zero inventory; new source entities/nodes initialize once without replenishing existing reserves.

## 29. Test strategy and acceptance matrix

The implementation adds Node and browser coverage for the full production route and Shipyard interaction. The following matrix remains a review checklist; passing suites are recorded at the end of this plan.

| Area | Required proof |
| --- | --- |
| Module compilation | Only Products can be modules; valid categories/core enums; positive footprint/volume/mass; checked units; unknown fields/capabilities rejected; design/fuel references resolve. |
| Geometry | Global 1-metre cell projection; all eight approved envelope/mass targets; canonical volume conversion and derived depth; same-volume/different-footprint proportions; revised reference envelopes/sums; zero/invalid volume rejection, negative coordinates, overflow bounds. |
| Bands/facts | Exact deterministic threshold boundaries; shallow/broad claims supported; no armor/stress/fragility inference; duplicate identical modules have distinct fact subjects; detached outputs. |
| Layout | Core-only detached draft allowed but commit hard-fails; exactly one core plus at least one attachment; core+cargo/radio structurally valid with immobility warnings; edge connection, corner-only failure, overlap, multihop BFS, cycle validity, bridge removal/orphans, no rotation, safe extents. |
| Capability aggregation | Cargo and fuel sum independently; dry mass and physical volume sums; equipment-group counts match composition; engine health/enabled rules; shared fuel consumption rule; repeated modules neither vanish nor double-count. |
| Equipment bridge | Carrying modules grants nothing; Workshop install cannot bypass assembly; ordinary equipment cannot bypass modular layout; preserved group condition; count rebuilding idempotent; malformed present condition rejected. |
| Live definitions | Save a vessel, change cargo/mass/volume/speed/output/fuel balance, reload with rebuilt catalogs, assert current derived values and identical placements. Power 10 with capacity reduced to 8 becomes 8 and stays 8 on a second pass; zero capacity dissipates valid reserve; invalid negative/nonfinite/nonnumeric/out-of-range or missing required power fails before clamp. Cargo/fuel contents survive overload. Footprint incompatibility and missing definitions fail separately; legacy power behavior unchanged. |
| Cargo | Existing resource/component/product storage and overload tests still pass; a reduced assembled hold loses no cargo; Processing output uses the actual hold; tanks do not count as cargo capacity. |
| Fuel | Integer counts only; exact per-unit volume; exact fit/one-unit excess; zero tanks; incompatible/non-Component fuel; cargo/tank separation; load/unload conservation; overfilled-tank recovery; receiver-full/save failures rollback. |
| Navigation | Quote/execute agree on whole cartridges, upfront power, dry mass and time; unhealthy/disabled engines; repeated/mixed supported engines; no double debit; cancellation no refund; mid-trip balance edits affect only next quote; legacy power-only routes unchanged. |
| Core feasibility | Drone cannot board even with owner/enter grants; player/NPC relocation and malformed occupancy rejected; crewed boarding/docking works; no fake player movement on drone commands or arrival. |
| Drone commands | Known active target, pilot/facility/cargo permissions, local berth or operational two-ended radio link, valid node access, concrete dock-only transfers, no player-chosen actor, no remote teleporting items. |
| Processing reuse | Command starts existing batch, claims finite source once, power/work simulation remains shared, departure blocks source work, output buffers/overloads truthfully, reviewed abort rolls back on failed save. Numerical suites remain unchanged. |
| Research/recovery | Unknown-design physical stock is visible as recovered hardware and assembles, including recovered cores; unknown zero-stock designs and recipes remain hidden. Discovery unlocks reproduction without granting Products. Loose Product sacrifice and Component experiments use ordinary evidence; installed hardware is not a loose sample. Material evidence/eligibility/credit signatures compile without cycles; old contracts/RNG remain intact. |
| Material content | Exactly five new Resource IDs and fourteen Component IDs; raw sources only, no fabrication of Resources; Component-only module recipes; whole Component outputs/inputs, canonical volumes, Resource m³ conversion; pressureVessel/magneticDriveAssembly stay Components. Critical material slots cannot substitute Habitat feedstocks. All four improved modules exhibit supported tradeoffs; no fake reliability, fluid, nuclear, life-support, or shielding mechanics. |
| World/geography | Four ordinary source areas/sites, public grants, real finite nodes, zero starting Habitat off-site stock, correct new-only seeding without replenishment. Nearest metallic and carbonaceous return routes fit one tank; extra basic tank reaches tungsten/ice with recomputed dry mass and fuel. No technology-key route gates. |
| Fresh-game anti-deadlock | Execute every section 23.2 step through production actions: guaranteed real Research evidence, solar repair, acquisition/crafting, 10 m³ staging, both radio ends, seven modules, assembly frames/power, fuel loading, outward journey/docking, actual finite new-Resource extraction into cargo, return transfer and use. Assert no off-site input before launch, no free recovery reliance, honest power/fuel costs, and player remains at Habitat. A mocked-ready craft or recipe graph does not satisfy this test. |
| Assembly | Repeated Product counts aggregate; bill is one frame per module including core (2/5/11 for core plus 1/4/10 attachments), plus two power. Equal module counts cost equally across trees/cycles/contact patterns. Recheck materials/power/physical stock without design-install gate; stale draft rejected; private owner/controller, empty tank/power/cargo, exact berth, one entity and assembly fact. |
| Transaction failures | Invalid layout/stock/access, creation validation, later state validation, and save failure consume nothing; original entity/ledger counters and FIFO entries remain unchanged; successful retry creates only one vessel. |
| Lifecycle/history | Inactive/terminal semantics, retained identities and syntax, active definitions strict, assembly history does not need current module stats, removal of obsolete historical content remains tolerated. |
| Narrative | Typed fields/trigger allowlists, geometry and composition evidence, mixed history budget, no private detail leakage, local construction one outcome, no failed-save/reload replay, immutable prior receipts, remote silence preserved. |
| Draft/UI | Drag/snap/move/clear/tab browse do not mutate state/save; 1 m scale and actual core size; recovered unknown-stock presentation without recipe leakage; module-count Assembly Stocks; consistent DRY MASS labels; orphan/overlap feedback; keyboard/touch alternative; stock invalidation; pure metrics; warnings allow assembly but core-only hard error blocks it. |
| CRT invariants | Tab order; existing instrument-bay/command-zone/narrative nodes remain mounted and positioned; no focus theft on automatic outcome; mobile panel overflow; existing five tabs and terminal commands behave as before. |
| Extension proof | Add an extra compatible cargo module and a same-fuel alternate thruster solely by test content; discover/fabricate/place/assemble/use/reload them without editing Shipyard engine or display branches. |

Use production `buildGameSystems`, action registry, runtime, actual save-failure stubs, and pre-change fixtures for integration tests. Do not only test helper outputs or generate “old” saves from the new content. Include fresh games and representative v9 existing saves, plus frozen older migration fixtures.

Run the appropriate focused suites during each phase, then the project's full `node --test tests/*.test.mjs` and `node --test tests/terminalTabs.browser.mjs` once the integrated slice is ready. Add browser cases to the existing isolated-save harness or an equivalent Shipyard suite. No need to broaden tests repeatedly after a complete clean run without a new change/failure.

## 30. Proposed file boundaries

These are the implemented file boundaries.

| File / area | Responsibility |
| --- | --- |
| `js/vesselModuleCatalog.js` | Pure module/fuel-reference contracts, unit compilation, and translation into existing equipment definitions; called from the item compiler. |
| `js/vessels.js` | Pure module/layout geometry, connectivity, core semantics, composition validation, aggregate preview, and installed membership derivation. No DOM, save, ledger, or high-level world creation imports. |
| `js/vesselFuel.js` | Dedicated fuel summary/admission and candidate load/unload operations using existing quantity/movement primitives. |
| `js/shipyard.js` | Detached draft operations and authoritative assembly orchestration with supplied creation/authority/ledger services. |
| `js/shipyardActions.js` | Player-bound assembly/fuel action descriptors in the existing registry. |
| `js/shipyardView.js` | Permitted palette/stock/bill/preview inputs; no DOM or writes. |
| `js/shipyardDisplay.js` | CRT three-column controls, Canvas interaction, transient draft/camera/focus. |
| `js/vesselCommandActions.js` | Narrow player-bound drone navigation/work/transfer wrappers and command feasibility; calls ordinary domains. |
| `js/narrative/providers/vesselFacts.js` | Read-only typed current geometry/composition and historical assembly interpretation. |

Edit existing compiler/content, bootstrap, definition/creation/entity validation, state composition, ships, Processing host projection, location transfer/domain view integration, narrative fact/context/beat/text/presentation allowlists, app panel/tab composition, scoped styles, and ledger descriptors. Leave runtime transaction/save infrastructure intact unless a concrete test exposes a missing contract.

The corresponding authoring guides and `README.md` are updated; [VESSEL_AUTHORING.md](VESSEL_AUTHORING.md) provides the complete module, assembly, fuel and command contract.

Document the 1 m grid and canonical envelope volume, all approved basic targets, DRY MASS terminology, fabrication-only `designDiscoveryId`, unknown-stock palette privacy, per-module assembly frames, core-plus-attachment validity, and validated power dissipation. Include exact new item IDs/categories/recipe units, no cheap substitutions for off-site slots, four source-area/site/node examples and seed-once rules, material evidence/eligibility contracts, and the complete anti-deadlock fixture. Record that reusable Component roles do not imply implemented thermal/crew/nuclear/fluid consumers. Entity/ship guides distinguish unchanged legacy ships, live modular balance, physical overload, and terminal retained composition; Research/Narrative guides prohibit automatic salvage knowledge and recipe inference. Documentation accompanies the implementation.

## 31. Incremental implementation order

| Phase | Work | Exit criterion |
|---|---|---|
| 1. Pure contracts and geometry | Product extension; fabrication-only design metadata; typed capabilities; 1 m grid; approved envelope/dry-mass targets; overlap/contact/BFS; envelope/bands. Test content initially. | Geometry/catalog/extension proofs pass; core-only draft allowed, committed core-only rejected; no gameplay mutation yet. |
| 2. Saved vessel composition | Modular shell; trusted creation; core resolution; equipment membership; empty fuel; lifecycle order and raw-power validation → current reserve derivation → clamp; boarding/occupancy feasibility. | Composed vessel reloads with live derived stats; power 10→8 and repeat-pass idempotence; malformed state rejected; physical overload preserved; old ships/saves valid. |
| 3. Atomic assembly | Yard authority, physical Product stock independent of discovery, module-count frame bill plus 2 power, candidate creation, one assembly record, rollback. | Real action assembles docked core-plus-attachment; equal module counts have equal bills; unknown recovered hardware works; failures preserve stock/counters. |
| 4. Fuel and modular navigation | Load/unload adapters, dry-mass quote/debit, whole cartridges, reserve/generation, legacy policy preservation. | Unoccupied basic vessel fuels/travels/docks with accepted journey compatibility; crewed movement tested with controlled test content, without implying fresh Habitat crewed fabrication. |
| 5. Useful drones | Two-ended radio/local command policy, selected-vessel read views, existing Processing wrapper, dock-only cargo/fuel commands. | Player stays at Habitat; manual unoccupied transport and finite extraction/return/transfer work with real authority and power. |
| 6. Reachable material/content economy | Five Resources; three Habitat + eleven off-site Components; two cores, six basic + four improved attachments; recipes/material and module evidence/hints; four source areas/sites and finite nodes; optional checked salvage; yard availability. | Hard section 23.2 fresh-game production anti-deadlock test passes without off-site first-build inputs, luck, or free modules. Crewed/improved fabrication actually requires explored inputs; harder routes remain accessible using additional basic hardware. |
| 7. Shipyard workstation | Sixth tab, Canvas draft, three columns, keyboard/touch, recovered palette, Assembly Stocks, DRY MASS, live metrics/errors. | User can draft/assemble reference configurations; core-only blocks, limited-capability warnings do not; unchanged CRT/terminal structure and recipe privacy. |
| 8. Narrative integration | Typed geometry/composition/history, authored material identities, local assembly trigger, supported beats, privacy/budget checks. | One grounded construction outcome; revised-scale prose is supported; no recipe inference, preview/save-failure/reload awards or narration. |
| 9. Compatibility and gameplay validation | Regression/browser suites, old saves, live balance changes including energy dissipation, material geography and module tradeoffs, content-only extension proof, authoring guides, effort/range playtests. | All release criteria demonstrated; compatibility-sensitive structural edits handled explicitly and documentation reflects final content/contracts. |

Keep content/facility availability controlled until the complete first gameplay slice is usable. Do not expose construction without reachable recipes or drones without supported commands.

Release acceptance: existing saves load without rewards/reset or new free ships; a fresh player researches, fabricates, assembles, fuels, commands, mines, returns, transfers, and uses a new Resource through real production actions. Habitat alone builds the crude prospector; crewed/improved fabrication requires off-site materials, with compatible recovered hardware usable independently of knowledge. All builds share structural rules and module-count assembly cost; geometry and DRY MASS follow current definitions; valid excess power dissipates deterministically while physical stock survives overload; malformed state/save failures lose nothing. Different destinations and module tradeoffs expand options without material-key gates, local prose uses supported facts, and a same-contract module remains a content-only extension.


## 32. Explicit deferred features and decisions

Deferred: rotation/orientation, hardpoints, center of mass, stress, aerodynamics, thrust vectors, power wiring, fuel plumbing, pressure/crew/habitation simulation, thermal systems, shields/weapons/combat, continuous fuel or fractional Components, generic compartments/reservations/modifiers, timed assembly/queues/partial ships, AI/Actor Goals/factory automation, automatic logistics/mining loops, blueprint libraries, full refits, individual module damage/wear/modifications, symmetry analysis, remote narrative memory/reporting, communication physics, payload mass, and new station/drone-bay mechanics.

The 1-metre scale, recovered-hardware installation, one Structural Frame per module, minimum one attachment, dry-mass-only navigation, and valid excess-power dissipation are decided rules. Envelope/mass targets use the user's first-pass values. Review functional capacity/recipe yields and route tradeoffs through tests/playtesting without changing those rules. Footprint/core-role edits invalidating composition still require explicit compatibility treatment. Material roles/future uses do not authorize nuclear power, electrolysis, Hydrogen/Oxygen, fluid/coolant consumption, trade, shielding, reliability statistics, or crew simulation in this pass.

The durable boundary is straightforward: the core chooses the supported operating model; installed Products supply real domain capabilities; composition records the player's physical choices; current definitions determine their current behavior.

## 33. Implementation verification

The shipped slice contains five off-site Resources, fourteen Components, two cores, six basic attachments and four improved attachments. It adds the Shipyard workstation, a selected-vessel control area in Locations, dedicated cartridge tanks, local/radio drone commands, and typed assembly narrative. Save version 9 and the legacy ship journey shape remain intact.

The integrated tests use the production action registry and runtime. A fresh game with chance insight disabled researches and fabricates all seven crude prospector modules without salvage hardware or off-site feedstock, assembles and fuels the vessel, mines Titanium Ore at an actual finite node, returns and transfers it to Habitat, and uses it in research. Other tests exercise all five off-site materials, an extra-tank long-route build, crewed boarding, live-content power dissipation and physical overload, an unchanged old-save fixture, failed-save rollback, and content-only added modules. Browser tests drive assembly, tank loading, drone travel, extraction, return transfer and reload at desktop and phone widths.

Final verification: `node --test tests/*.test.mjs` passed 303/303; `node --test tests/terminalTabs.browser.mjs` passed 54/54. The deferred mechanics in section 32 remain outside this release.
