# Processing System — Implementation Plan

Status: implemented, 27 September 2026. The approved design below is retained as
the implementation contract; actual authoring and usage are documented in
[PROCESSING_AUTHORING.md](PROCESSING_AUTHORING.md).
Inspected against the current repository on 27 September 2026.

This plan adopts the proposed committed-work model and supersedes the earlier
future-Processing guidance in section 14 of the World Ledger plan. Workshop
visibility is confirmed: show only the player's occupied site or ship, excluding
other ships docked there and other owned locations.

Revision: clarifies the player's loaded-batch and machine-output-buffer model,
own-run abort rights, manual start power requirements, finished-output unloading,
authoring intent, and simulation cost.

### Exact revision map

| Section changed | Change in this revision |
| --- | --- |
| 3 — Authored definitions | Explain commitment/unlock conditions versus maintained physical requirements; retain existing transformation schema. |
| 5 — Saved runs | Define loaded inputs and one staged batch per delivery run using existing saved arrays; clarify initiator's limited abort right. |
| 6 — Start/authority | Reject powered manual starts without representable positive work; allow own-run abort with current facility access or any-run abort with equipment management. |
| 7 — Slots/phases | Make machine occupancy physical; equipment availability blocks working only, not finished-output unloading. |
| 8 — Spatial/lifecycle | Small cross-reference correction: completed extraction travels without an operational extractor. |
| 9 — Time/power | Preserve numerical acceptance; choose/measure the least expensive stepping strategy; add concurrent-run/stall performance gates. |
| 10 — Delivery/abort | Define loaded/staged material and loss messages; unloading is automatic host-internal transfer, independent of machine operation. |
| 11 — Ledger | Clarify loaded-material start, staged delivery waits, factual phase-specific losses; no new event types. |
| 12 — Persistence | Validate staged-output and phase/blocker invariants; migration routing and v8 → v9 policy unchanged. |
| 13 — Workshop | Add loading, hopper/buffer, occupied-machine, start-rejection, and phase-specific abort review text/controls. |
| 14 — Sequence | Adjust affected milestone exits and planned authority/authoring documentation. |
| 15 — Acceptance | Add all six requested gameplay examples plus authority, unloading, buffer, and performance checks. |

Sections 1, 2, and 4 remain unchanged. Keep the module architecture, global IDs,
snapshots, resource/component quantities, finite nodes/claims, atomic delivery,
power/navigation ordering, ledger infrastructure, and explicit migration route.
The approved plan revision originally limited supporting changes to wording in
World Ledger section 14 and a clearly marked planned authority note in
`ENTITY_AUTHORING.md`. Implementation now includes the modules, content, tests
and documentation described below; the implementation results are recorded at
the end of this document.

## 1. Outcome and scope

Add Processing as a saved, timed simulation primitive with two initial operations:

```text
Location resource node → extraction → resource
Host resources/components → refining → resources/components
Components/resources  → crafting   → product
```

Crafting retains its existing immediate operations, recipes, ingredient choices,
and assembly behavior. Processing does not convert recipes automatically. Future
automation decides when to start runs through the same domain API as manual
actions; it does not execute transformations itself.

V1 includes process compilation, finite location nodes, committed runs, machine
capacity, continuous power use, atomic delivery, abort, persistence, permissions,
ledger facts, detached UI queries, and a minimal Workshop control surface. A full
Workshop visual redesign remains a separate task. The first playable slice must
still let the player select and start a process, inspect progress, and abort it.

Defer queues, repeat batches, automatic production, offline progress, individual
machine entities, reservations for ordinary inventory, partial deliveries,
refunds, salvage of unfinished batches, pipelines, operators, maintenance
histories, and process-driven product assembly.

## 2. Existing architecture and integration points

| Existing owner | Processing integration |
| --- | --- |
| `itemCatalog.js` / `equipment.js` | Installed groups already provide capabilities, count, enabled state, and shared health. Extend validated machine metadata narrowly. |
| `resources.js` / `storage.js` / `quantities.js` | Use existing exact quantities, cost payment, and whole-output storage preview; physical output never clips. |
| `locations.js` / `locationContent.js` | Compile and construct location-owned nodes, including generated location instances. |
| `authority.js` | Reuse named host/source permissions rather than infer authority from title ownership or UI visibility. |
| `ships.js` | Read docking and journey state to determine source access. Processing owns no movement. |
| `bootstrap.js` / `simulationRegistry.js` | Compose a synchronous Processing step with explicit ordering and narrow bound services. |
| `stateComposition.js` | Add Processing initialization, reconciliation, and validation before entity-reference validation. |
| `entityComposition.js` / `entityReferences.js` | Collect host, source, initiator, and authored condition references explicitly. |
| `runtime.js` | Keep candidate transactions, validation, saving, and rollback. Processing never clones the root or saves itself. |
| `worldLedgerTypes.js` / `worldLedgerSimulation.js` | Add actual event descriptors; existing step wrappers request saving when history changes. |
| `craftingDisplay.js` / `app.js` | Current Workshop mixes storage, installed products, and recipes. Add a separate machine view without coupling Processing to Crafting. |

Today `advanceGame` produces/clamps power for every active location and increments
`simulationTime`; journeys advance next and contact reconciliation runs last.
Contexts are transient and unavailable for inactive hosts. Check host lifecycle
before obtaining a context, and reacquire contexts for every new candidate.

## 3. Authored definitions and quantities

Use a dedicated `processingContent.js` source and `processingCatalog.js` compiler.
Keep item definitions, process definitions, and resource-node definitions separate
but linked through IDs and capabilities. Do not make processes recipes belonging
to particular equipment items.

Authored bulk quantities use m³, matching existing content conventions. Compilation
converts them once into integer volume units: 1 m³ = 1,000,000 units. Counted
components use positive whole counts. API requests and saved state always use
compiled quantities. Avoid a field whose unit changes silently between authoring
and runtime.

Illustrative authored definitions, using items/equipment to be supplied by content:

```js
{
  id: "laser_surface_extraction",
  name: "Laser surface extraction",
  kind: "extraction",
  capability: "laser_mining",
  sourceRequirements: { tags: ["solid", "surface"] },
  batchM3: 0.5,
  duration: 30,
  powerRate: 4,
  startConditions: {}
}

{
  id: "refine_nickel_ore",
  name: "Refine nickel ore",
  kind: "refining",
  capability: "ore_refining",
  inputs: [{ itemId: "nickel_ore", amount: 1 }], // m³ for resources
  outputs: [{ itemId: "nickel_ingot", amount: 4 }], // whole component count
  duration: 60,
  powerRate: 5,
  startConditions: { discoveries: ["nickelRefining"] }
}
```

Compiler rules:

- Reject unknown fields, unsafe/duplicate IDs, unknown items, unsupported kinds,
  invalid start conditions, nonfinite values, zero/negative duration, and negative power.
- Extraction has a positive compiled `batchAmount`, required source tags matched
  with ALL semantics, and no inventory inputs or authored item outputs. Its output
  is exactly the claimed volume of the node's resource.
- Refining has explicit, nonempty inputs and outputs. Both arrays support resources
  and components immediately, with bulk volume or whole counts derived from item
  category. Products and utilities are excluded from these transformation arrays;
  operating power is separate. Initial content remains resource → component, but
  resource/component mixtures and component → component need no schema migration.
- Normalize item lines deterministically; reject duplicate authored item IDs to
  avoid ambiguous totals. Bound lines and ID lengths so valid processes and their
  ledger payloads fit existing limits, including the 2,048-character entry limit.
- The chosen equipment group itself must provide the process capability. Another
  machine on the host cannot satisfy that assignment accidentally.
- Optional `hostKinds: ["site", "ship"]` restricts eligible host entity types and
  defaults to both. Validate this in the Processing compiler; the shared condition
  language currently has no host-type operator. Additional start requirements use
  existing shared conditions without introducing location-specific engine branches.
- Author `startConditions`, not generic `conditions`. Compile with the existing
  shared condition syntax and adapters, but evaluate only while previewing/starting
  a new run. Reject the old field rather than support two ambiguous spellings.
  Dynamic operating requirements are explicit runtime blockers, not conditions
  reevaluated from a changed process definition.
- Compile capability indexes, discovery-reference summaries, and condition-owned
  entity references. Feed those summaries into existing research/reference linking;
  do not have Research traverse Processing's content tree.

Authoring rule: `startConditions` state whether the actor may commit/start an
operation. Discoveries, known technology, unlocks, and story/progression flags are
appropriate. They are evaluated at commitment and never silently become ongoing
requirements. Do not encode "must remain in vacuum", temperature limits,
continuous coolant, required crew presence, or radiation thresholds here when the
physical requirement needs to hold during the batch. That would permit the batch
to continue after the physical requirement disappeared.

V1's maintained requirements are its explicit runtime blockers/capabilities:
host lifecycle, working equipment, working extraction access, available working
power, and output admission. Future real physical requirements should gain an
explicit domain-owned capability/blocker and tests when content needs them. There
is no generic `operatingConditions` system in this round; author no production
process that depends on an unsupported maintained requirement.

Allow optional equipment metadata `processing: { speedMultiplier, powerMultiplier }`,
both defaulting to 1. Require finite positive speed and finite nonnegative power
multiplier. Support this on both built-in infrastructure and product installations.
Do not add upgrade accumulation or per-unit statistics in v1.

Effective duration is `duration / speedMultiplier`; effective power rate is
`powerRate * powerMultiplier`. Reject nonfinite/invalid effective results. Group
health controls operational availability using today's `health > 0` rule; it does
not change speed or create fractional machine slots.

## 4. Location resource nodes

Authored nodes belong to stationary site definitions in v1, including asteroid
sites. They are not entities, cargo, or area-wide deposits. This fits the current
navigation model without inventing mining range or a second approach state.

```js
resourceNodes: [{
  id: "nickel_A",
  resourceId: "nickel_ore",
  initialReserveM3: 180,
  tags: ["solid", "metallic", "surface"]
}]
```

Runtime identity is `(sourceLocationId, nodeId)` using the location's persistent
instance ID, including generated instances. Runtime state is:

```js
state.locations.asteroid_17.resourceNodes = {
  nickel_A: { resourceId: "nickel_ore", remaining: 180000000 }
};
```

Persist the resource ID as well as reserve so a catalog edit cannot silently
reinterpret a saved deposit. Tags and display text remain authored metadata;
source tags are a start eligibility test, not a reason to recalculate accepted
output. Node IDs and resource identity must remain stable or migrate explicitly.

Node initialization must cover fresh saves, generated locations, and newly added
authored instances through `createLocationState`; root initialization alone is
insufficient. Existing remaining reserves never reset from `initialReserveM3`.
Reconciliation may seed genuinely new nodes once; it never refills existing ones,
advances jobs, appends history, or silently removes incompatible nodes.

Available reserve is `remaining - sum(sourceClaim)` for working extraction runs
on the same node, including blocked working runs. Delivery runs have zero claim;
their material has already left the node. There is no saved
`reserved` field or authoritative cached claim index. A temporary per-pass index
may be built from runs if needed.

For v1, the entire batch must be available. Reject the start if available reserve
is smaller than the batch; do not silently shrink it. UI explains a remaining
reserve too small for this batch. Smaller-batch operations can be authored later.
Reserve decreases exactly once when working finishes. In the same candidate,
release the claim and enter delivery with extracted material buffered in the run.
Cargo admission is a separate later operation and never debits or restores reserve.

## 5. Saved Process Run contract

```js
state.processing = {
  nextRunId: 74,
  runs: {
    73: {
      id: 73,
      processId: "laser_surface_extraction",
      kind: "extraction",
      hostId: "ship_04",
      equipmentId: "mining_laser",
      requiredCapability: "laser_mining",
      initiatorId: "player",
      startedAt: 1234,
      phase: "working",
      blockedReason: null,
      workTotal: 30,
      workRemaining: 30,
      powerRate: 4,
      committedInputs: [],
      pendingOutputs: [{ itemId: "nickel_ore", amount: 500000 }],
      sourceLocationId: "asteroid_17",
      nodeId: "nickel_A",
      sourceAmount: 500000,
      sourceClaim: 500000
    }
  }
};
```

Refining runs use the same common fields and omit extraction-only fields.
`committedInputs` records the batch loaded from host inventory into the machine;
it is an execution/history snapshot, not another spendable store or refundable
stock. `pendingOutputs` records what will be delivered. `workTotal` supports progress calculation without looking up
the current process duration. Do not save percentages, DOM selections, contexts,
slot ordinals, or a second completion flag.

For extraction, `sourceAmount` is the immutable snapshotted batch volume;
`sourceClaim` equals that amount in working and becomes zero in delivery. Pending
output describes intended material in working and actual buffered material in
delivery. The atomic phase transition is proof of extraction finalization; no
additional extracted flag or duplicate output inventory is needed.

For BOTH kinds, `phase: "delivery"` means industrial work is finished and exactly
one batch of finished material is physically staged in that machine's output
buffer/hopper. A run's existing `pendingOutputs` array is the sole saved
representation of that batch. One batch may contain several output item lines;
it cannot hold several batches. In working, those lines are expected output,
not finished stock. Refining enters the same staged-output semantics when its
work reaches zero, without a source debit.

The buffer is not host cargo and does not count toward shared host cargo volume
until admitted. It cannot be withdrawn, transferred, used for recipes/research,
or topped up as independent inventory. Its capacity is exactly the accepted
run's output contract, with no separately authored volume limit, second inventory,
multi-batch buffer, or new storage framework. Delivery remains a live run rather
than a terminally completed run: its machine stays occupied until unloading or
discarding that staged batch.

`initiatorId` also identifies whose run this is for the narrowly defined abort
rule in section 6. Initiators must still have current facility access; this field
never grants perpetual host control or bypasses authority checks.

Player-facing consistency model:

```text
Refining: load materials into machine → machine works → finished batch in output
hopper → host storage accepts whole batch → process complete

Extraction: reserve a source batch → machine extracts → material leaves deposit
→ finished batch in machine output buffer → cargo accepts batch → process complete
```

This explains occupancy and loss without exposing saved claims, transaction
candidates, or output-array field names in the game.

IDs are positive safe integers globally unique within this save. Map keys must
match numeric run IDs; `nextRunId` is greater than every live ID and never decreases.
Guard counter exhaustion. Allocation, input payment/claim creation, and the start
fact share one transaction; rejected or rolled-back starts do not consume IDs.
Completed/aborted runs disappear, while the counter persists independently of
ledger retention. Run IDs are not entity or ledger IDs.

Snapshot all mechanical execution data at start: kind, required capability,
effective duration/rate, exact committed inputs, exact intended outputs, and
source identity/amount. Later duration/yield/multiplier/start-condition changes affect
new runs only. Existing runs never recompile their contract from `processId`.
Research and initiating-actor permissions are checked at start, not every tick.

A removed process definition may leave a mechanically valid active run; preserve
and complete it from its snapshot, using a fallback process label in the UI.
This tolerance does not allow removing an item, equipment definition, location,
or node still needed by authoritative state. Those changes need explicit migration.
An extraction delivery run retains source identity for provenance, but no longer
requires a live node definition or access to its reserve.

## 6. Starting work, actions, and authorization

Provide a pure preview and a synchronous mutation API:

```text
previewStartProcess(state, request, services, actorId)
startProcess(candidate, request, services, actorId)
previewAbortProcess(state, runId, services, actorId)
abortProcess(candidate, runId, services, actorId)
```

Requests select `hostId`, `equipmentId`, `processId`, and, for extraction,
`sourceLocationId` and `nodeId`. The engine derives all amounts, duration, rate,
and outputs. Reject unknown payload fields. Browser payloads cannot supply actor
identity, snapshots, costs, output quantities, work remaining, or chosen run IDs.

Start validates, before mutation:

1. Host exists, is active, and is a site/ship with installed operational equipment.
2. The selected group provides the required capability and has a free slot.
3. Authored `startConditions`/research and host-type requirements pass in that host context.
4. Actor has `useFacilities` and `depositCargo` on the host; refining additionally
   requires `withdrawCargo`. Extraction also requires source `useFacilities`.
   Unowned mineable sources may explicitly grant public source use.
5. Refining has all exact inputs; extraction has compatible tags, spatial access,
   and sufficient unclaimed reserve.
6. For a powered manual start, currently stored usable power supports some
   representable positive work under the effective run rate. No prospective
   generation or future recovery counts as currently available power.
7. Snapshot arithmetic, ID allocation, and required ledger facts are valid.

Then load refining inputs once using existing checked resource payment operations, or
create the extraction claim; create the run; append `PROCESS_STARTED`. These
changes commit together. There is no normal runtime `MISSING_INPUT` or
`SOURCE_DEPLETED` blocker.

Positive-work start check: for effective `powerRate > 0`, compute the available
work budget `min(workTotal, availablePower / powerRate)` using the same utility/
work arithmetic as advancement. Require a finite positive work amount and energy
debit that can actually decrease remaining work and stored power without
underflow, rounded no-ops, or overspend. A zero battery rejects as "Cannot start —
insufficient power." Use the shared check in preview and execution BEFORE input
loading, claim creation, counter increment, or ledger append. Do not require
energy for the full batch, an arbitrary minimum number of seconds, or a chosen
stepping quantum. Zero-rate processes need no power.

This is an affordability/progress proof, not simulated work during an action:
starting does not advance the clock, prepay batch power, reserve future energy,
or invent a zero-time progress tick. Power remains continuously consumed on
timed advancement. Shared demand may still constrain subsequent updates; show
other active machine demand in the preview without promising uninterrupted power.
Use this rule for all v1 manual start paths, including trusted actor calls.
No flag/API for accepting a knowingly powerless waiting job is added now.

Output cargo capacity is NOT a start rejection. Preview says the finished batch
will wait in its machine output buffer if storage is still full on completion.
Equipment/source access must be valid at start. A later loss of power blocks
the already loaded/committed run normally; loaded inputs stay in the process.

Player action wrappers require `hostId === state.locationId`, independently of
ownership or global action scope. Abort resolves the run's host and applies the
same locality check and one shared domain-owned authority rule:

```js
canUse(state, actorId, run.hostId, "manageEquipment") ||
  (run.initiatorId === actorId &&
   canUse(state, actorId, run.hostId, "useFacilities"))
```

An equipment manager may abort any host run. An initiator with current facility
use may abort their own run in either phase; an ordinary facility user may not
abort someone else's. If facility access is revoked, initiator identity alone
grants no right. Missing/unknown initiator provenance never satisfies the own-run
branch. Neither branch requires withdrawal/deposit permission because abort
returns no material. `canUse` already enforces active actor/host, controllers,
public policy, and explicit grants, so no new permission or ownership shortcut is
needed. Inactive-host cleanup remains explicit trusted lifecycle orchestration,
not a new authority bypass for player commands.

Share the reason/decision through `previewAbortProcess`, `abortProcess`, action
requirements, and Workshop controls, and recheck inside execution after any review.
The action registry's flat `permissions` list is an AND check; do not declare
`manageEquipment` there or inherit `access: "managed"` for Abort, which would
incorrectly suppress own-run or manager-only rights. Use the existing action
`requirement` callback for the complete OR rule, with payload/locality validation
and explicit empty permission defaults as needed. Do not alter registry semantics.
Engine APIs accept an explicitly supplied actor and host for trusted
future orchestration, without introducing remote player controls now.

Register a small Processing action family and capability-derived targets. Ensure
`processing` action-set assignments reach supported hosts through normal content
linking. Preview and execution use the same rules; execution revalidates on the
live candidate to prevent stale starts/aborts and concurrent overcommitment.

Runs belong operationally to the host, not the initiating player. Leaving, losing
ownership, or losing a grant does not stop already committed work; it changes
what the player may subsequently see or control.

The start read model identifies exactly what will be loaded and explains its
loss policy: "Load batch: 1.0 m³ nickel ore. Materials move into this machine;
aborting before unloading loses the batch." This statement must be visible at
the commit control, not only in authoring documentation or after starting.

## 7. Equipment groups, slots, and phases

Each installed copy provides one slot. Every live run occupies a slot through
working AND delivery, including all blockers. Working means the machine contains
an unfinished loaded batch/extraction job; delivery means its output hopper
contains one finished batch. Neither machine is empty, so neither slot is free
for another batch. There is no queue waiting for future equipment installation.

Operational slots equal installed quantity when the group is enabled and has
positive health, otherwise zero. Sort the group's runs numerically by run ID;
the first N are assigned operational slots. Working runs outside that allocation
receive `EQUIPMENT_UNAVAILABLE`. Delivery runs still participate in occupancy and
ranking while their batch is staged, but unloading never requires operational
allocation, positive health, enabled state, or a current working capability.
Start capacity counts all live group runs, not just currently progressing ones.
Slot loss may create overcapacity temporarily; it must remain valid saved state.
Equipment restoration makes the oldest runs eligible first.

```text
working (possibly blocked)
  → workRemaining reaches zero
  → extraction: debit node once, release claim, buffer extracted output
delivery (possibly blocked)
  → one finished batch physically staged in the machine output buffer
  → complete buffered output admitted
removed

either phase → explicit abort → removed
```

Use one primary blocker with deterministic precedence:

| Phase | Priority | Blocker | Meaning |
| --- | --- | --- | --- |
| Working | 1 | `HOST_INACTIVE` | Host cannot operate; check before requesting a live context. |
| Working | 2 | `EQUIPMENT_UNAVAILABLE` | Group disabled/broken, capability absent, or no operational slot. |
| Working | 3 | `SOURCE_UNAVAILABLE` | Extraction only; source inactive or spatial access lost. |
| Working | 4 | `NO_POWER` | Available power limits further industrial work. |
| Delivery | 1 | `HOST_INACTIVE` | Host cannot accept its staged batch. |
| Delivery | 2 | `OUTPUT_FULL` | Whole finished batch cannot enter host storage. |

Delivery blockers are only `HOST_INACTIVE` and `OUTPUT_FULL`, in that order.
Staged output consumes its slot until it unloads or is discarded, but holding a
slot is not an operational-equipment prerequisite for unloading. Delivery uses no
Processing power and needs no source access. A delivery-blocked miner can leave
and unload later; output is already extracted. No energy is charged again for
finished work.

Repository finding: `isOperational` in `equipment.js` gates enabled/health/count
for industrial capabilities. `previewExchange`/`transfer` in `resources.js` admit
cargo using quantities and `storageSummary`, without an operational-machine check.
`cargoBonus` also depends on installed count rather than enabled/health. No API
requires a functioning refinery to move its finished batch into host storage.
Therefore a disabled/broken machine in delivery can unload, including a retained
delivery run beyond a reduced installed count. If storage capacity itself fell,
normal whole-output admission can still block as `OUTPUT_FULL`; do not relabel it
as machine failure. Actual equipment-definition removal remains a migration issue.
Sealed/hazardous-machine exceptions are deferred until authored content needs them.

## 8. Spatial access and entity lifecycle

Use one shared read-only extraction access predicate for start and working:

- A stationary host may extract its own location nodes.
- A ship may extract nodes at the stationary site it is docked at, in the same
  area, with no active journey. The source must be active.
- Being somewhere in the same area is insufficient. Other locations are not
  automatically mining targets. Docking is the v1 approximation for close access.

Undocking or beginning travel blocks unfinished extraction. Returning restores
working access; no cancellation is required. Once extraction enters delivery,
source access is irrelevant and buffered material may be unloaded during or after
travel if host/storage permit, regardless of extractor health/enabled state. Shipboard refining may continue
through travel. Player presence is irrelevant to both. Future stand-off mining
replaces this predicate through navigation/range capabilities rather than special
cases inside individual process definitions.

Collect Processing entity references with domain roles that retain identities and
permit inactive hosts/sources, so inactivity produces a blocker rather than an
invalid save. Node and equipment IDs are domain references, not entity references.
Inactive-source working claims remain held until work finalization or abort.
Delivery runs retain source identity as historical provenance, with zero claim.

Terminal host destruction/retirement must resolve its runs by aborting them in
the same semantic lifecycle transaction before completing the transition. Supply
that cleanup as a narrow explicitly bound capability to lifecycle orchestration;
do not silently delete runs in validation/loading or introduce entity event hooks.
An extraction source becoming terminal leaves working runs on other hosts blocked
and abortable; delivery runs remain deliverable from their buffer. It does not
discard another host's committed work automatically.
All resulting ledger facts and lifecycle changes roll back together on failure.

## 9. Time and power advancement

Run at every host, irrespective of selected tab or player location. Preserve the
game's existing clock policy: advance during visible play; hidden/closed pages
grant no progress. Reload restores remaining work exactly. Wall-clock timestamps
and offline catch-up are outside v1.

### Ordering and navigation power are separate contracts

Current code pays the full journey power cost in `navigate` when departure is
accepted; `advanceJourneys` decrements time and publishes arrival, consuming no
power. Preserve that contract. Already paid journeys complete even if shipboard
Processing subsequently empties the battery. A new departure tests and debits
the current battery before the action commits; do not reserve future trip energy,
refund/recharge an existing journey, or add continuous propulsion costs in v1.
Actions and frames remain serial transactions. A departure that was affordable
before an earlier committed processing tick need not remain affordable afterward;
this is ordinary shared-resource use, not a retroactive change to an accepted trip.

Retain navigation's place before Processing in the ordered simulation capabilities:

```text
capture start-of-interval extraction access (read-only)
→ power production → journeys/arrivals → Processing
→ contact reconciliation → validation/save/commit
```

Pass the captured extraction-access result explicitly to the Processing adapter.
A working run may use its interval only if access existed at its beginning AND
still exists when advancing; arrival at the end does not make the preceding
interval mineable. This gate applies only to working extraction, not buffered
delivery or refining. It is transient context, never saved or retained across
transactions. Preserve existing arrival/closure output fields.

The substep adapter below applies this rule per subinterval: a mid-frame arrival
can enable later subintervals, never the interval containing arrival. Capture
access before each subinterval, not once for the whole large frame. This bounds
arrival-related work loss by the substep size. If a future navigation system adds
continuous journey demand, it must have an explicit allocation stage before
Processing demand. Merely moving a journey timestamp step does not define power
priority; that propulsion change would require its own design and tests.

For each run in numeric ascending ID order:

```js
requestedWork = Math.min(elapsedSeconds, run.workRemaining);
possibleWork = run.powerRate === 0
  ? requestedWork
  : Math.min(requestedWork, availablePower / run.powerRate);

energySpent = possibleWork * run.powerRate;
workRemaining -= possibleWork;
```

Debit only actual work energy using utility arithmetic, with a tightly defined
floating-point tolerance for zero/overspend and no negative power/work. A powerless
zero-rate process still advances. Lower IDs receive power first; no fairness or
priority framework is introduced. Work completion attempts delivery in the same
candidate, without waiting an extra tick.

### Concrete numerical acceptance gate

For identical initial state, scheduled actions, and total visible simulation time,
compare constant 30/60/144 Hz updates, seeded jitter of 8–50 ms, and occasional
250 ms/1 s visible-page stalls against a 0.25 ms reference. Test 1 s, 10 s, and
60 s horizons and checkpoints around work completion. Split updates at scheduled
action boundaries so the comparison does not accidentally change player behavior.
The reference must resolve arrival/work boundaries at the same conservative rule.
Halve the reference interval until successive reference results differ by less
than 10% of the allowed numerical tolerances, so reference discretization does not
mask a failure or penalize a more accurate implementation.

Use these explicit tolerances for each host/run, rather than a vague "close enough":

| Measurement | Allowed difference from reference |
| --- | --- |
| Stored power | `max(1e-6, 0.005 * powerCapacity)` utility units (0.5% of capacity). |
| Cumulative accepted generation and Processing energy spent | Each within `max(1e-6, 0.001 * max(referenceEnergy, 1))` utility units (0.1% of the corresponding reference total). Measure accepted generation, including other existing utility consumption, without confusing clipped surplus with captured energy. |
| Remaining work | `max(1e-6, 0.001 * workTotal)` simulated work seconds (0.1% of the batch). |
| Actual completion/finalization time | Within 10 ms of the reference simulated time; tolerance is numerical, not offline time. |
| Items, node debits, working claims, run IDs, and emitted terminal facts | Exact integer quantities and exactly-once transitions, never percentage tolerances. Compare discrete results after a 10 ms finalization/arrival boundary window; differences inside that window must converge without any duplicate or skipped batch. |

Representative fixtures cover empty/half-full/full/nearly full batteries,
production below/equal/above demand, negative existing utility load, two competing
runs, a run finishing mid-update, extraction with full cargo, and journey arrival
plus shipboard work. Use current 40-unit capacity and production/demand in the
0–12 units/s range, plus a deliberately small 2-unit battery to expose clamping.
Assert no negative energy/work, energy conservation including clipped surplus,
and no per-substep ledger spam. Compare completed integer output and source
reserve again after a short settling window, not just floating-point progress.

There is already a concrete failure witness in the proposed frame-sized algorithm:
with capacity/stored power 40, generation 8/s, Processing demand 5/s, and enough
work, one 1 s produce-then-consume update leaves 35 power. Sixty 1/60 s updates
leave approximately 39.916667. The difference of approximately 4.916667 exceeds
the 0.2-unit storage tolerance. Documenting this discrepancy cannot pass v1.

Therefore include narrow interval integration in implementation. Bind existing
power, journey, and Processing capabilities in the stated order with interval
access capture. Choose the least expensive stepping strategy that passes the
numerical AND performance gates: bounded substeps, battery-empty/full/work/arrival
boundary splitting, or a combination. The observed defect requires a correction,
not any particular quantum or a generalized fixed-timestep architecture.

A 1 ms maximum subinterval is only an experiment/comparison candidate. The
reference's small interval is also test-only. Do not adopt either as the production
rate without measured necessity. Compare coarser bounds and boundary-aware
integration on the same workloads first. If 1 ms is needed, report which fixture/
metric failed at coarser settings, timing on the measured machine, allocation
costs, and worst-case iteration counts: a fixed 1 ms loop gives 1,000/5,000 inner
intervals for 1 s/5 s stalls, and up to 128,000/640,000 run visits with 128 runs.
Do not hide that cost behind correctness alone. No general scheduler, second
runtime, persistent clock accumulator, or generalized fixed-step engine is added.
This remains narrow power/work integration, not a redesign of the electrical
grid or Processing module architecture.

Reuse the same root candidate for every interval. When delegating to `advanceGame`,
it owns that interval's clock increment; a boundary-aware integration helper must
preserve the same single clock ownership rather than incrementing it again.
The intervals' sum equals the supplied elapsed time. Run
journeys after power and Processing after journeys, accumulate arrival outputs
and save requests, then reconcile contacts once at the end. The production adapter
can expose one composed step to the existing registry; generic registry/runtime
interfaces and final output fields remain unchanged. Save/commit only once for
the outer frame. Failures in any subinterval roll back the entire frame. Hidden
time still advances nothing. No new persistent clock accumulator is required.

### Performance acceptance and strategy choice

Add a repeatable performance harness alongside correctness fixtures, separate
from the intentionally expensive reference calculation. Warm up 100 advances,
measure at least 1,000 normal visible-frame advances and 30 repeats of each stall,
and report median/p95 adapter time on a recorded browser/runtime and machine.
Each repeat starts from the same fixture so completed runs do not silently make
later samples cheaper. Include 1, 32, and 128 concurrent runs across 1, 8, and
32 hosts, steady competition, full-storage staged output, and clustered work/
arrival completions. Test ordinary frames plus 250 ms, 1 s, and 5 s visible stalls.

Provisional release budgets on the project's representative development machine:
p95 interval-adapter time no more than 4 ms for normal visible frames, 50 ms for a
1 s stall, and 200 ms for a 5 s stall, including the 128-run stress fixture.
Record actual measurements before confirming that baseline; run timing assertions
in a controlled performance job rather than treating arbitrary CI load as a logic
failure. These are explicit budgets to verify at implementation, not claimed
measurements or reasons to weaken numerical/quantity correctness. If the baseline
requires a budget change, report the measured evidence and tradeoff in the plan.

Also count inner intervals, run visits, catalog/index rebuilds, root clones, ledger
appends, and saves. There is one root candidate and at most one save/commit per
outer frame; no cloning, full catalog compilation, or persistence per inner
interval. No per-interval output-buffer inventory copies or ledger progress ticks.
The zero-run path should retain the existing coarse power/journey behavior where
the numerical contract permits. Compare candidate strategies by both timings and
operation counts, and retain the cheapest passing one. Do not truncate visible
elapsed time, drop runs, skip source debits, or grant offline time to meet a budget.

An underpowered run can make partial work while retaining `NO_POWER`. Evaluate
the primary blocker once after its work attempt, not through transient internal
clear/block assignments. Emit resumption only when actual work advances and the
run leaves the blocked condition. This prevents solar trickle power from producing
one resumed/blocked pair every frame. Completing a delivery-only wait emits no
resumption. Fix this edge policy in tests before exposing ledger facts to narrative.

## 10. Extraction finalization, atomic delivery, and abort

When working extraction reaches zero remaining work, validate the source/node and
its working claim, subtract `sourceAmount` from node remaining, set `sourceClaim`
to zero, and enter delivery atomically. This is when material actually leaves the
deposit. If the debit crosses positive → zero, append `RESOURCE_NODE_DEPLETED`
now, even when cargo is full. Request persistence for every extraction phase
transition, including nondepleting ones without a ledger fact; do not depend on
the five-second save interval or eventual cargo delivery. Failure discards the
whole candidate, including power/work/debit/phase/history.

No intermediate working-with-zero-work or delivery-with-positive-claim state can
commit. Retries, reload, leaving the source, and abort never repeat/reverse the
node debit. Output remains buffered in `pendingOutputs` while delivery is blocked.

Refining uses the same one-batch hopper: loaded inputs remain committed throughout
working, and its intended outputs become finished staged material when work
finishes. That transition replaces the player-facing "loaded batch/expected
output" view with "batch complete/output hopper"; the saved output array is not
copied into another inventory. The historical input snapshot remains for contract
and ledger purposes, not as additional material alongside the finished output.

Delivery previews the entire `pendingOutputs` against the current host store with
`previewExchange(store, {}, outputs, content)`. No capacity is reserved at start.
If any output cannot fit, insert nothing and set `OUTPUT_FULL`; retain the run,
buffer, and slot. Storage becoming free permits a later retry.

Unloading is a trusted host-internal operation authorized by the accepted run's
original deposit commitment, so it continues remotely and does not recheck the
initiator's current grants each tick. Revoking that actor's access removes their
manual control/visibility; it does not trap or return host material. Do not add an
access-loss runtime blocker. Require an active usable host and atomic storage
admission, but no operational-equipment/capability/power/source check in delivery.
Host retirement/destruction still uses the existing explicit abort cleanup.

No new player unload command is required: when space exists, the host unloads the
whole staged batch automatically. The Workshop says so. Any explicit unload/retry
control later exposed must obey current locality and host facility or equipment
management access plus `depositCargo`, validated through the same read/domain
rules; it may not grant new withdrawal, remote control, or equipment-operating
rights. Existing cargo-management controls retain their own permissions.

Successful delivery inserts all buffered outputs, appends completion, and removes
the run on the same candidate. It neither reads nor modifies source reserve; the
working → delivery transition exclusively owns that debit. Physical movement
helpers remain silent: do not also emit generic
resource transfer/grant events. Retry never consumes refining inputs a second time.
Invalid quantities/missing authoritative definitions/overflow are errors, not
misreported capacity blockers.

Abort removes the run immediately, releases its claim and slot, and appends
`PROCESS_ABORTED`. Refining inputs are lost; there are no cargo outputs or refunds
in either phase. Working extraction releases an unspent claim without changing
reserve. Delivery abort destroys buffered output, including extracted material;
the already debited source reserve stays debited. Abort never changes node reserve.
Record actual lost buffered outputs on delivery abort rather than describe intended
working outputs as already produced. Loaded-input loss describes an unfinished
refining batch; delivery loss describes finished output, without counting the
original converted inputs as a second present/lost stock. Record initiating actor and any real supplied abort reason when
known; do not infer a causal narrative from a blocker. Repeated/stale aborts reject
without another event. Future UI must explain the loss before committing an abort.

Use phase-specific review text. Working refining: "Abort batch? The materials
loaded into this process will be lost." Working extraction: "Stop extraction?
The unextracted claim will be released. No material is produced." Delivery:
"Discard finished batch? The output held in this machine will be lost." For staged
extraction also state: "Extracted material will not return to the deposit."
Show exact loaded/staged item quantities and an explicit final Abort/Discard
button. Cancel leaves the run untouched. Revalidate run, phase, authority, and
loss summary at that final action: if working changed to delivery during review,
refresh the review and require acceptance of the new loss summary instead of
silently discarding a finished batch. Review is transient UI state, not a saved
inventory reservation or new refund mechanism.

## 11. Ledger transitions and historical compatibility

Processing is the single recording owner for its semantic transitions. Facts use
host as actor/location, historical host area, and common data `runId`, `processId`,
`kind`, `equipmentId`; source location/node data appear for extraction. Initiators
are explicit payload references when known. Item lines capture `quantityKind`
alongside canonical amount for history.

| Fact / default importance | Exact boundary |
| --- | --- |
| `PROCESS_STARTED` / 0.2 | Accepted commitment: refining batch loaded into machine, or extraction batch claimed. No fact for a rejected powerless manual start. |
| `PROCESS_BLOCKED` / 0.3 | Unblocked → blocked; delivery `OUTPUT_FULL` means finished material is held in the machine output buffer awaiting host storage, not unfinished industrial work. Includes phase and primary reason. |
| `PROCESS_RESUMED` / 0.2 | Blocked working run actually progresses and leaves its blocked condition; records previous reason. |
| `PROCESS_COMPLETED` / 0.2 | All buffered output enters host cargo; actual inputs/outputs and extracted source amount where applicable. No further source debit. |
| `PROCESS_ABORTED` / 0.3 | Authorized own-run/equipment-manager abort releases the run. Record phase, aborting actor/known reason, lost loaded inputs for working refining, or lost staged output for delivery; avoid double-counting transformed inputs as another lost stock. |
| `RESOURCE_NODE_DEPLETED` / 0.5 | Actual reserve crosses positive → zero during extraction working → delivery. Cargo may still be full and the run unfinished. |

Changing reasons while remaining blocked updates saved state without another
blocked event. Retrying unchanged delivery produces no repeated facts. If source
or equipment blockage clears only to expose output-full delivery, the run remains
blocked and emits no resumption. Depletion targets the source LOCATION, with its
scoped node ID, resource, exact extracted amount, run ID, and processing host in
payload. It is not an entity event or a claim-availability event.

For deterministic ordering, finalize extraction and append depletion if applicable
before attempting delivery. Append `PROCESS_BLOCKED` if output cannot fit, or
`PROCESS_COMPLETED` if delivery succeeds, then remove a completed run. Depletion
may precede completion by many updates or be followed by abort instead. Facts use
the current simulated update/substep clock; no wall-clock or guessed fractional
event times are introduced.

Narrative/read facts distinguish "industrial work finished; batch staged in the
machine" from "batch unloaded into host storage; run complete". Delivery's saved
phase/output already supplies the first fact; add no new work-finished, buffer,
unload, or permission event family just to support that phrasing. A broken machine
that unloads its finished batch records ordinary completion, without equipment
block/resume noise. Existing transition/historical-validation boundaries remain.

Extend the ledger service's explicit capability allowlist when adding process
checks. `PROCESS_STARTED` checks the current process catalog. Subsequent transition
appends validate the run snapshot and surviving authoritative item/equipment
references, allowing an already accepted process definition to have disappeared.
Do not require `isCurrentProcessId` for those transitions: that would contradict
the saved execution contract. The Processing owner establishes the live run/claim;
ledger validators do not recreate industrial logic.

Historical validation never queries current runs, process catalogs, quantities,
node reserve, permissions, or equipment availability. Finished run IDs and changed
content-only IDs remain valid history. Entity references still require retained
identities. Measure events per simulated minute with several underpowered machines
and retained time span before changing the provisional 200-entry ledger limit.

## 12. Persistence and validation

Target save version 9 with an explicit v8 → v9 migration. Empty Processing alone
could be a neutral same-version default, but introducing authoritative finite node
reserves deserves an explicit boundary. Preserve existing v1–v7 migration logic;
route its resulting v8 state through the new conversion. Conversion copies input,
adds an empty root run slice and initial new-node state, preserves all existing
cargo/identities/research/history, and grants no invented historical events.

The existing loader currently routes every `saved.saveVersion < SAVE_VERSION`
through pre-identity migration. Replace that comparison with explicit boundaries:
versions 1–7 use the historical/identity route, version 8 uses only the new
Processing conversion, and version 9 uses current reconciliation. Do not send v8
through `migrateIdentities`, which deletes and recreates identities and could lose
generated instances and authority. Freeze the historical identity stage's output
at version 8 rather than letting a changed `SAVE_VERSION` label it version 9 early.
Preserve authored-instance repair for v8 input before its new fields are validated;
do not tie that repair solely to `saved.saveVersion === 9`.

Do not turn today's infinite salvage actions into finite nodes or today's immediate
`iron:refine` recipe into a timed run during migration. The opening route and saved
crafting knowledge remain intact. New content is introduced separately.

Processing's state descriptor runs after entity/local state preparation and before
reference validation. Validate:

- Exact supported root/run shapes, global counter/key agreement, finite bounded
  timestamps, duration/rate/work values, phase/blocker applicability, and detached
  snapshots with canonical positive amounts.
- Working runs have positive remaining work; delivery runs have zero remaining
  work. Remaining work never exceeds total. Refining/extraction fields agree with
  kind; no outputs are already delivered while a run is live. Delivery contains
  exactly one staged batch represented by the run's sole output array, not host
  cargo or another buffer inventory. Delivery blockers allow only `HOST_INACTIVE`
  or `OUTPUT_FULL`; disabled/broken equipment does not make the save invalid.
- Host/source IDs have supported retained entity types; hosts and working sources
  have required domain slices/nodes. Delivery requires only source identity for
  provenance, not a live node. Equipment/item IDs still exist. Operational status
  is a runtime condition, not a save-validity
  requirement. Process-definition existence is not required for a snapshotted run.
- Node resource identities, safe nonnegative remaining reserves, extraction output
  equal to snapshotted `sourceAmount`, and aggregate working claims no greater
  than remaining reserve. Working claims equal `sourceAmount`; delivery claims
  are zero and need no current source node. Validate buffered outputs independently.
- Blocked working extraction participates in claims; all working/delivery runs
  participate in machine occupancy. Do not reject saved
  temporary equipment overcapacity after a count decrease.

Malformed present state stops loading without replacing the original save.
Reconciliation defaults only documented absent/new fields; it does not repair
invalid runs, refill sources, recalculate outputs, refund inputs, allocate run IDs,
produce resources, or replay ledger facts. Renames/removals of authoritative node,
item, or equipment identity require explicit migrations.

## 13. Workshop interface contract

Keep the visual redesign separate, but implement a shared read model now:

```text
processingWorkshopView(state, actorId = "player")
  host identity + available permissions
  installed processing equipment groups
  per-run progress + working/finished-batch status + blocker explanation
  loaded-input / expected-output view while working
  staged output batch + occupied-hopper explanation while delivering
  source reserve view + shared start/abort decision and exact loss review
  idle operational capacity + eligible processes and start previews
```

The default player view uses only `state.locationId`. No remote owned station,
docked ship, nearby asset, or NPC-private machine appears. Engine advancement is
world-wide; UI visibility is local. Authority checks also apply to command actions.

Equipment cards require host facility access (`useFacilities` or
`manageEquipment`, as resolved by canonical authority). Cargo quantities/products
require `viewCargo`. Start controls require all operation-specific permissions;
Abort uses section 6's shared rule: own-run initiator plus current `useFacilities`,
or `manageEquipment` for any run. Basic facility access cannot discard another
actor's batch. Show unavailable-control reasons without leaking private cargo.
Ownership supplies defaults
through `authority.js`; never bypass a delegated controller policy with an
`owned || permission` shortcut. Enter/boarding permission alone reveals no Workshop
asset cards. Review the current renderer's all-catalog inventory rows separately
when redesigning product visibility; distinguish craftable definitions from assets
actually installed or stored locally.

Machine UI can show one row per installed copy:

```text
Thermal Refinery                 2 installed
  Machine 1   Refine nickel      [██████░░░░] 60%   Working
  Machine 2   Idle               Choose process…   Start
```

Refining's commit control is "Load & start batch". Show exact loaded amounts,
expected output, snapshotted duration/power rate, current power readiness, and
"Loaded material is committed; aborting before unloading loses the batch."
Extraction uses "Start extraction" with its source and batch size. No-power
preview disables either powered start with "Cannot start — insufficient power".
Full cargo is a visible warning, never a disabled start by itself.

Work status uses "Batch loaded — processing" or "Extracting", with loaded inputs
and expected output clearly distinguished from finished stock. Delivery cards use:

```text
Extraction complete
Output buffer: 0.5 m³ nickel ore
Waiting for cargo space
Machine occupied — unloads automatically when cargo has room

Batch complete
Output hopper: 4 nickel ingots
Waiting for storage
Machine occupied — unloads automatically when storage has room
```

These describe finished industrial work, not a removed/completed Process Run.
Show at most one staged batch per run even with multiple output lines. Use exact
quantities, clear loaded/staged location, and plain loss text; internal field
names such as `pendingOutputs`/`sourceClaim` and ledger/runtime mechanics stay out
of player labels. In delivery, original input snapshots may appear as "Materials
used" history, never as a second loaded inventory still sitting beside the output.

Abort controls open section 10's loss review: "Abort batch" for unfinished work,
"Discard finished batch" for staged output. Actions use the shared authority and
loss preview, preserve Cancel, and revalidate before committing. The confirmed
action binds run identity and the reviewed phase so a changed/completed batch
cannot silently undergo a different destructive action.

These are group capacity rows, not individually persistent machines. Bind a busy
row and Abort to `runId`; bind an idle row's process selector to the equipment
group and its own local UI draft. Sort busy runs by ID and show remaining idle capacity.
A requested idle row is rechecked at start; the engine always assigns a free group
slot. Completing a run can renumber visible rows. Never imply independent health,
upgrades, ownership, or stable unit identity. Keep slot identity out of saved state.
This provides independent process choice for simultaneous batches without adding
machine entities. Stable per-unit selection across batches would be a later scope
change.

Show disabled/broken accessible installed groups with clear reasons. If equipment
count falls below attached runs, retain every run in an overflow/staged-batch
section so it remains inspectable and abortable when authorized. Working excess
runs are equipment-blocked; delivery excess runs can still unload. Disabled/broken
delivery cards say "Machine disabled; finished output can still unload" rather
than "Repair required to collect output". Do not hide the batch because its
physical slot has disappeared.

Progress is `(workTotal - workRemaining) / workTotal`. Delivery displays 100% work
with "Extraction complete"/"Batch complete", the exact output hopper contents,
and "Waiting for cargo space/storage" or "Host inactive" when applicable. Reserve
"Run complete/output unloaded" for actual storage admission. Progress
freezes during complete stoppage; partial power may advance it with an insufficient
power status. Rate/remaining-time estimates use snapshots and distinguish active
work time from uncertain blocked wall time. Source reserve shows remaining,
claimed, and available quantities clearly for accessible working sources. Extraction
delivery instead labels its output as buffered/extracted; it does not show a held
claim or require the player to return to that source.

Eligible process choices derive from the selected group's capabilities, known
research, host `startConditions`, and compatible sources. Show an unlocked compatible
choice with its disabled reason for missing inputs, unavailable power, or no free
machine slot. Insufficient output cargo capacity is only a staged-output warning;
do not expose undiscovered process details. Presentation never recomputes execution
rules or invents process/item/location branches. Each idle row has an independent
draft keyed by host/group and a presentation-only row key or ordinal; two idle
machines can hold different process/source selections. Reconcile drafts when rows
change, and clear/revalidate them on location/access changes. Progress
updates preserve focus and do not rebuild dropdowns on every frame.

The minimal initial panel follows this contract with readable labels, native
progress semantics and accessible controls. A later Workshop design can arrange
local storage, machines, and fabrication into clearer sections without changing
Processing state or APIs.

## 14. Implementation sequence

| Milestone | Work | Exit condition |
| --- | --- | --- |
| 1 — Contracts and catalog | Add content/compiler, machine metadata, resource/component line schemas, `startConditions`/reference linking, and isolated fixtures. | Invalid content fails early; one extraction definition works with two resources/machine groups; component-input transformations compile without products. |
| 2 — Persistence and nodes | Add explicit migration, location construction/reconciliation, Processing state descriptor and collectors. | Old saves preserve gameplay; generated instances have independent finite reserves; invalid present state fails safely. |
| 3 — Commitment and abort | Add loaded-batch start/abort previews, positive-work power check, claims/slots, own-run-or-manager authority, and manual actions. | Rejected powerless starts spend nothing; starts can accept full cargo; own-run abort rights and phase-specific loss reviews are correct. |
| 4 — Timed work and delivery | Choose/measure narrow interval integration, access gating, partial-power arithmetic, extraction finalization, and one-batch staged delivery. | Numerical AND performance gates pass; paid journeys are preserved; work debits source once; staged output travels and unloads with broken/disabled equipment. |
| 5 — Ledger and composition | Add descriptors/service capabilities, recording boundaries, lifecycle cleanup and bootstrap step composition. | Events save through the wrapper; failures roll back runs, power, nodes, inventory, counters and history together. |
| 6 — Playable integration | Add shared Workshop loaded/staged read model, plain commitment/loss controls, and a small industrial chain. | Player understands where loaded/finished material is, why machines remain occupied, and which batch they may abort; current-location visibility and existing crafting remain. |
| 7 — Verification and docs | Run focused/full tests, isolated browser checks and update authoring/architecture/save docs. | All acceptance cases below pass; known time/power limits are explicit. |

Implement event descriptors early enough that start/abort work is transactionally
testable; milestone 5 completes production integration rather than adding history
after the behavior has already shipped.

Suggested module boundaries: `processingContent.js`, `processingCatalog.js`,
`processingState.js`, `processing.js` (domain/query operations),
`processingActions.js`, `processingSimulation.js`, `processingView.js`, and
`processingDisplay.js`. Keep source reserve operations in one small node helper if
needed; do not introduce a general reservation or machine framework. Bind content,
world, ledger and context capabilities explicitly in bootstrap; avoid importing
default-world wrappers from the Processing domain.
Keep the small ordered power/journey/Processing adapter distinct from the
Processing domain's per-run advance operation, whether as a helper in the
simulation adapter or a narrowly named separate module.

The production content slice should use one extractable resource, one component,
one extractor, one refinery, and one stationary node source. Prefer an additive
silicon-mineral → solar-cell chain using existing item IDs where balance permits,
rather than requiring a large nickel family. Document exact machine construction,
research unlocks, access, power provision, and source reachability before enabling
it. No production ship exists today: ship-mining fixtures prove mobility behavior,
while a local stationary extractor proves the first playable route. Do not silently
add a starter ship or revise the opening tutorial as an engine side effect.

## 15. Acceptance and verification

| Area | Required evidence |
| --- | --- |
| Data-driven behavior | Another machine with the same capability and another material/node work without engine or renderer branches. `startConditions` unlock choices without reevaluating accepted work. Resource → component, resource + resource → component, resource + component → component, component + component → component, and component → component all compile and execute. Resource outputs also use exact bulk quantities; product/utility transformation lines reject. |
| Commitment | Insufficient input/reserve/free machine, unusable initial power, denied access, or stale payload changes nothing. Inputs load once at start; no full-batch power requirement; full output storage alone permits start. Zero-rate starts work without power; tiny unrepresentable work/debits reject without hidden quantum minimums. |
| Snapshot stability | Rebalance duration/yield/multipliers or remove the process definition after start and reload: accepted work completes with its original contract and valid ledger facts. |
| Concurrency | Two hosts cannot overclaim one node; multiple group runs occupy installed capacity; lower IDs receive available slots and power first; blocked delivery retains a slot. |
| Power/time | All section 9 numerical/discrete tolerances pass across steady frames, jitter, and visible stalls; the full-battery witness passes under the chosen interval integration. Exact partial debits, zero-rate work, competing runs, no negatives, no power in delivery, and no internal transition spam. |
| Performance | Reproducible timing/operation counts for 1/32/128 runs and 250 ms/1 s/5 s stalls meet section 9 budgets; compare cheaper strategies before fixing a quantum. One root clone and at most one save/commit per outer frame; no inner-loop compilation/inventory duplication. Record reasons and worst-case counts if 1 ms is necessary. |
| Navigation priority | Departure still pays exactly once before creating a journey. An already paid journey arrives even if Processing drains its battery; processing cannot stall it or charge it twice. A later departure lacking current funds rejects atomically. Arrival at a subinterval's end grants no working extraction for that subinterval, but subsequent subintervals may work. |
| Spatial/lifecycle | Undock/travel blocks working extraction; return resumes; refining and buffered delivery travel. Inactive/terminal sources block working only; terminal host cleanup aborts atomically; generated source IDs work. |
| Extraction finalization | Work completion debits node and releases claim once even with full cargo; phase/buffer/debit persist together and save is requested even without depletion history. Delivery reload never debits again; depletion may precede a much later delivery or abort. |
| Delivery | Every output fits or none arrives. One staged batch per run, several item lines allowed, no second inventory or recipe use. Full-storage retries hold machine occupancy; broken/disabled/out-of-operational-allocation output still unloads when active host storage permits, without power/source checks. No reserve change on unloading. |
| Abort authority/loss | Initiator with `useFacilities` may abort own run in either phase without `manageEquipment`; different ordinary user may not. Revoked facility access denies initiator alone; manager may abort any run. Loss preview matches phase and revalidates after review. Working extraction releases claim; delivery abort loses buffer without restoring reserve. No refunds/duplicates; lifecycle cleanup remains atomic. |
| Transactions | Inject execution, ledger, validation, and save failures. Original state/save remain intact; frame pause policy remains; no emitted UI result describes an uncommitted completion. |
| Persistence | Literal supported legacy saves, v8 → v9, fresh v9, active/blocked/buffered-delivery reload, zero delivery claims, additive/depleted nodes, malformed phase/claim combinations rejected, and no migration history/rewards. |
| Ledger | Edge-only facts; no resumption for output-only wait or per-substep spam; depletion recorded at work finalization before completion/abort. Buffered loss on delivery abort is factual. Nondepleting extraction phase changes also request save. Old content history stays independent of live runs. |
| Workshop | Only occupied host assets; grants/private/passenger rules remain; independent process selection. Load/start commitment and zero-power rejection are visible; 100% work shows exact output hopper and occupied-machine explanation. Broken finished-output cards allow unloading; own-run/manager Abort and phase-specific review use shared policies. |
| Browser | Isolated saves; tab switching and remote-location progress; hidden-page pause; reload and failed-save behavior; focus preservation; desktop and narrow layouts. |
| Regressions | Immediate crafting, opening repair/research route, exact storage/overload admission, ships, dialogue, entity lifecycle, and existing ledger producers remain valid. |

Run focused Processing tests while building, then the existing
`node --test tests/*.test.mjs` and isolated
`node --test tests/terminalTabs.browser.mjs` suites. Add browser coverage to the
established fixture-driven integration setup, keeping personal saves untouched.
Update `ARCHITECTURE.md`, `README.md`, `LOCATION_AUTHORING.md`,
`CONTENT_AUTHORING.md`, `RESEARCH_AUTHORING.md`, and a new
`PROCESSING_AUTHORING.md` with implemented contracts after code lands. Update the
planned authority note in `ENTITY_AUTHORING.md` to the implemented own-run/manager
rule; retain canonical permission defaults. Include authoring examples that use
`startConditions` for unlocks and explain why maintained physical conditions need
future explicit runtime support.

### Explicit player-behavior checks

These are required implementation/browser fixtures, not claims of tests already
run while revising this document.

| Requested example | Expected result to verify |
| --- | --- |
| No-power start | Effective rate positive, battery has zero usable power, even with a producing solar array: preview/execute reject with insufficient power. Inventory/reserve/claims/counters remain unchanged; no run or `PROCESS_STARTED`. A zero-rate counterpart accepts without power. |
| Power later fails | Start with representable usable power, load inputs, and make timed progress. Later exhaustion retains loaded batch and remaining work, blocks with `NO_POWER`, and emits only the block edge. Restoration resumes work normally; inputs never reappear in cargo or get consumed twice. |
| Extraction with full cargo | Start with source/machine/power, then fill cargo. At 100% work, debit node once, release claim, hold exact ore in machine output buffer, enter delivery, and retain slot. Ship leaves; staged output follows ship and no ore returns to deposit. Retry/reload/undock never repeat debit. |
| Aborting staged extraction | Own-run facility user or equipment manager reviews exact staged loss and confirms discard. Buffer is lost, node stays debited/depleted, run disappears, slot frees, and ledger records actual lost staged output. No loaded-input or intended-output duplicate stock is fabricated. |
| Initiator abort | Player with facility use but no equipment management may stop their own batch. Another ordinary facility user cannot. Manager can stop any batch. Revoke the player's facility grant after starting: initiator alone cannot stop it. Check both phases, preview/action/command/UI consistency, and save-failure rollback. |
| Broken machine after work completes | Finish refining while cargo is full so hopper remains staged; then disable/break the machine and make room. Output unloads without repair, power, or source access. Slot frees and ordinary completion records once; disabled machine still cannot start/continue a new industrial batch. |

Also verify "Load & start batch" explains exact loaded material, Abort/Discard
Cancel changes nothing, and a batch finishing while its abort review is open
requires a refreshed staged-loss review. Narrative facts say material is inside
the machine during delivery, not vanished, still unextracted, or already in cargo.

Completion means a small playable industrial chain and a tested general run engine,
with machine-oriented local UI queries ready for the later Workshop redesign.

## Implementation results — 27 September 2026

Implemented the approved committed-run contracts, generic extraction and
resource/component refining, finite scoped nodes, equipment-group capacity,
phase-specific buffered material, authority, snapshots, ledger transitions and
explicit v8 → v9 migration. Workshop exposes installed machines at the occupied
host, independent idle selectors, progress, loading commitment and reviewed loss.
The playable additive chain uses existing minerals, electronics and solar cells;
the existing crafting/opening routes remain intact. Exact content values and
authoring guidance are in `PROCESSING_AUTHORING.md`.

Production integration splits at physical battery, completion and arrival
boundaries. No fixed 1 ms quantum or persistent accumulator was required.
Numerical tests use an independent generate/clamp/work reference, halved to
convergence, across the specified frame rates, jitter, visible stalls, capacities,
empty/full batteries and competing loads. A fractional-load regression prevents
floating-point residue from manufacturing negligible battery charges.

Performance results: Node v22.17.1, AMD Ryzen 7 9800X3D; 100 warm-ups per case,
1,000 normal-frame samples or 30 stall samples, fixture reset outside the measured
adapter. All 36 measured workloads pass the provisional budgets. Worst p95:
3.34 ms normal visible frames, 7.09 ms one-second stalls, 7.68 ms five-second stalls.
The 128-run workloads cover 32 hosts, competing generation, staged full-storage
output and clustered completions. Retained-ledger validation is batched within
the existing candidate transaction; every entry and the final ledger remain checked.
Raw measurements: `artifacts/processing-performance.json`; reproducible harness:
`scripts/processingBenchmark.mjs`.

Verification includes the six required gameplay examples, paid navigation and
conservative arrival access, generated node/material/machine alternatives,
ordinary crafting/installation reachability, migration/snapshot retention,
counter/input/source/history rollback, stage-aware abort review, and responsive
browser controls. Unit and browser results are recorded in
`artifacts/processing-tests.log` and `artifacts/processing-browser.log`.
Final verification: 273 unit tests and 45 isolated browser tests pass. The focused
Processing browser checks also pass after the final preview/label adjustments.
