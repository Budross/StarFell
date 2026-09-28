# Processing authoring

Processing runs are committed industrial batches. Crafting remains immediate and
owns products/assembly. Add authored processes in `js/processingContent.js`,
machine products in `js/content.js`, and finite nodes in `js/locationContent.js`.
Bootstrap compiles and binds these catalogs before linking actions or loading saves.
Custom games supply `processSource`; custom item catalogs default to no processes.

The production `prospectResource` process uses `['solid','prospectable']` nodes at
off-site berths. An assembled extraction module provides `surfaceExtraction` on a
ship. Player-issued drone batches use the selected ship as the actual host and
require an operational command link, source access, power, and an available machine
slot. See [Modular vessel authoring](VESSEL_AUTHORING.md).

## Definitions and quantities

```js
{
  id: 'processSolarCells', name: 'Process photovoltaic cells',
  kind: 'refining', capability: 'thermalRefining',
  inputs: [
    { itemId: 'siliconMinerals', amount: 0.04 },
    { itemId: 'electronicParts', amount: 1 }
  ],
  outputs: [{ itemId: 'solarCells', amount: 2 }],
  duration: 30, powerRate: 0.15,
  startConditions: { discoveries: ['photovoltaicFabrication'] }
}
```

Bulk authored amounts use m³ and compile once to integer cubic centimetres.
Components use whole counts. Both inputs and outputs support resources/components;
products and utilities are rejected. Power is a separate continuous utility rate.
Each list has at most eight unique item lines. Outputs transfer as one atomic batch.

`startConditions` determine whether the operation may be committed: discoveries,
technology, unlocks and progression flags. They are evaluated only at start.
Do not encode physical requirements that must remain true, such as continuous
coolant, vacuum, temperature limits or crew presence. V1 has no generic operating
conditions. Real maintained requirements need explicit runtime capabilities/blockers
and tests before content can depend on them. `conditions` is not an alias.

Optional `hostKinds` defaults to `['site','ship']`. The selected equipment group
itself must provide the named capability. Equipment can specify
`processing: { speedMultiplier: 1, powerMultiplier: 1 }`; speed must be positive,
power nonnegative. Effective work duration/rate are snapshotted at start.

## Extraction sources

```js
// On a stationary site definition; nodes are not entities.
resourceNodes: [{
  id: 'surfaceMinerals', resourceId: 'siliconMinerals',
  initialReserveM3: 0.5, tags: ['solid','surface']
}]
// One generic extraction process serves all compatible node materials.
{
  id: 'surfaceMineralExtraction', name: 'Extract surface minerals',
  kind: 'extraction', capability: 'surfaceExtraction',
  sourceRequirements: { tags: ['solid','surface'] },
  batchM3: 0.01, duration: 20, powerRate: 0.08, startConditions: {}
}
```

Node identity is `(locationId,nodeId)`. Every required tag must match. A site uses
its own nodes; a ship uses the stationary site where it is docked in the same area,
with no journey underway. Source facility-use authority is required to start.
All working extraction runs, including blocked runs, constitute claims. New runs
cannot overclaim a reserve. Generated locations create independent node states.
Additive node reconciliation initializes missing new nodes once; it never refills
an existing reserve. Removing/changing authoritative node/item IDs needs migration.

## Player commitment and machine buffer

Refining start removes exact inputs from host cargo: the player has loaded the
machine. No reservations or refunds exist. Powered manual starts require current
stored power supporting representable positive work; future generation is not
enough. Rejection changes no inventory, counter, run, claim, or ledger. A full
output destination is a warning, not a start rejection.

`working` contains unfinished committed work. At zero remaining work, extraction
permanently debits its node once and releases its claim. Both kinds enter
`delivery`: exactly one finished batch is staged inside the machine. Saved
`pendingOutputs` is its sole representation, not another inventory. It becomes
host cargo only when every output fits. The slot remains occupied until that
transfer or an abort; extracted buffered material travels with its ship.

Working blockers are host inactivity, unavailable equipment, inaccessible source
(extraction only), and insufficient power. Delivery blockers are host inactivity
and full storage. Disabled/broken equipment can unload finished output. This
automatic transfer is the accepted host-internal deposit and does not recheck the
initiator's later access. It consumes no power and emits no work-resumed event.

Abort requires `manageEquipment`, or matching `initiatorId` plus current
`useFacilities`. Ordinary users cannot abort another actor's batch; revoked access
removes initiator rights. No extra permission is added. Working refining loses
loaded inputs; working extraction releases its claim; delivery loses finished
buffered output without restoring extracted reserve. UI review binds run and phase.
Terminal-host world operations abort its runs on the same transaction candidate.

## Initial playable chain

At Habitat 05, discover structural fabrication/electrical conduction and assemble
and install a mineral extractor (2 iron + 1 conductive part) or thermal processor
(2 iron + 1 conductive part + 1 electronic part) through existing Crafting actions.
The opening repair route and immediate solar-cell recipe remain available.

The repaired starting array produces net 0.3 power/s. Extraction uses 0.08 power/s
for 20 seconds to obtain 0.01 m³ from the finite 0.5 m³ surface deposit. The thermal
batch requires photovoltaic fabrication and converts 0.04 m³ minerals plus one
electronic part into two solar cells over 30 seconds at 0.15 power/s. Compared
with two immediate solar-cell crafts, this saves one electronic part for a timed,
powered commitment. No new starter ships or free machines are granted.

## Simulation, history, and compatibility

The narrow integrator splits at battery empty/full, batch completion and arrival.
It preserves upfront navigation payment, chronological arrivals, one root frame
candidate and one outer save. A completed journey never mines retroactively.
Only visible play advances; there is no offline catch-up or persistent accumulator.
Runs use global monotonically increasing save-local IDs and execution snapshots.
Changing/removing a process definition cannot reinterpret accepted work.

Ledger events record start, block/resume edges, unloading completion, phase-specific
abort losses and node depletion at extraction finalization. History validates
captured quantity kinds without requiring live process definitions. A synchronous
ledger batch validates existing history once before its first append and validates
the resulting history at exit; every new entry still receives its own checks.
Call it only inside the existing candidate transaction; errors roll back the frame.

V8 migrates explicitly to v9 with empty Processing state, preserving identities,
allocation counters, cargo, authority, research and history. Malformed present v9
Processing is rejected. Older identity migration remains frozen at v8 first.

Verify with `node --test tests/*.test.mjs`, the isolated browser suite, and
`node scripts/processingBenchmark.mjs`. Numerical tolerances and discrete correctness
remain those in the approved implementation plan. The measured physical-boundary
strategy uses no fixed 1 ms loop; benchmark fixtures cover 1/32/128 runs on
1/8/32 hosts, staged output, clustered completion and visible stalls.
