# Structured World Ledger implementation plan

Status: approved design implemented for the current game's ledger foundation and
existing semantic producers, 27 September 2026. Processing producers are now also
implemented. Trading, Actor Goals, Event Director, and narrative integrations remain
future work.
Repository originally inspected: 26 September 2026. The architectural findings
below describe that baseline; the implementation results at the end record what
was delivered. Source code is the authority for current behavior.

Revised after design review: historical content validation is catalog-independent;
save-version policy is explicit; timed saving uses one mandatory shared wrapper;
and recording ownership is audited against the implemented Effect Dispatch Round 2.

## 1. Recommended result

Add a bounded, structured `state.worldLedger`, one candidate-state append API,
small read helpers, and an immutable table of supported record types. Semantic
domain operations decide what happened. The ledger validates and retains their
facts. Runtime continues to own transactions, persistence, and commits.

Start with these decisions:

- Retain the newest **200 entries initially**, in chronological append order.
  The constant is provisional pending Processing event-rate measurements.
- Use **numeric ledger IDs**, independent of the persistent entity allocator.
- Use simulation seconds, exact existing quantity conventions, explicit quantity
  kinds for historical amounts, and entity IDs.
- Store a small common envelope plus a **strict payload for each supported type**.
  Append requires current content IDs; historical validation requires only their
  structural validity, never their continued presence in current catalogs.
- Include importance, with authored defaults and optional explicit overrides.
- Include historical `locationId` and `areaId` when the operation knows them.
- Treat every entity reference as historical: it never blocks a lifecycle change.
- Initialize through composition; validate/reconcile through the existing registry.
- Keep **save version 8** under the documented project-wide migration-boundary
  policy. Only an absent field receives an empty default on load.
- Wrap the final simulation manifest with one shared ledger-save adapter so
  emitting steps cannot accidentally omit the save request.
- Add useful producers for existing mechanics; add Processing descriptors when
  Processing actually exists. Do not build Processing or narrative generation here.

```text
Semantic domain operation on candidate
  -> ordinary state change + structured ledger append
  -> existing validation -> existing save -> existing commit

Committed state + recent structured history
  -> future fact providers / eligibility / debugging / summaries
```

The ledger has no subscribers, scheduled work, effects, or gameplay execution.

## 2. Architectural findings

| Existing code | Finding and implication |
| --- | --- |
| `js/runtime.js`, `createGameRuntime` | Actions clone, execute, reconcile contact, validate, save, and replace state. Append only to that candidate. Validation/save exceptions preserve the previous committed state. |
| `js/runtime.js`, `advance` | Timed frames also clone, but quiet frames can commit without validation/save. A save is required after five active seconds, a step's `saveRequested`, or existing arrival/contact reports. Every ledger-producing timed adapter must request a save. |
| `js/runtime.js`, `flush` | Flush saves current state without another validation. Do not add ledger behavior here; make ledger-bearing commits validated through their actions/steps. |
| `js/simulationRegistry.js` | Executes a frozen, ordered step manifest. Accepts only synchronous `{ saveRequested?, output? }` reports. It must not understand ledger types or infer domain events. Apply ledger persistence wrapping in bootstrap after custom step composition, outside this runner. |
| `js/bootstrap.js` | Builds catalogs, collectors, action services, state lifecycle, and simulation steps once per game. This is where to bind the ledger writer to catalogs and supply it explicitly to semantic owners. |
| `js/stateComposition.js` | Single default lifecycle manifest shared by bootstrap and direct callers. Add a `world-ledger` descriptor here, before entity-reference validation. |
| `js/stateLifecycleRegistry.js` | Currently supports only `validate` and `reconcile`, not fresh initialization. A generic initialization seam is needed to avoid a ledger import/field assignment in `stateCore.js`. |
| `js/stateCore.js` | Version 8; owns root checks, initial assembly, explicit v1–v7 migration and identity conversion. v8 loads are cloned, reconciled, then validated. Ledger defaulting fits current reconciliation. |
| `js/state.js` | Compatibility wrappers also use the default composed lifecycle. Fresh ledger creation must work here as well as through bootstrap. |
| `js/save.js`, `js/app.js` | Whole-state JSON in `localStorage`; no partial writes or ledger store. Startup immediately resaves version upgrades, but same-version reconciled defaults normally persist at the next ordinary save. |
| `js/entities.js` | Entity types are `area`, `site`, `ship`, `npc`, `principal`; generated IDs are `gen_<type>_<sequence>`. Ledger IDs must not consume that allocator. |
| `js/entityLifecycle.js`, `js/entityQueries.js` | Hard deletion is unsupported. Destroyed/retired entities retain identity, label, placement, and domain slices. Resolve labels later through `getEntityLabel`; do not duplicate names in every entry. |
| `js/entityReferences.js`, `js/entityComposition.js` | Explicit reference collectors and `retain` roles already distinguish historical references from blocking placement references. Add the ledger's collector to this composition. |
| `js/equipment.js`, `js/itemActions.js` | Equipment is an installed group with count, health, enabled state, and upgrades inside a location. An individual refinery identity does not currently exist. Use a host entity plus equipment-group ID until a domain introduces real machine identities. |
| `js/quantities.js` | Bulk amounts are integer cubic centimetres: `1 m³ = 1_000_000` units. Components/products use integer counts. Power is a utility and may be fractional. Reuse `validateQuantity`; do not apply bulk rules to every resource. |
| `js/ships.js` | Departure is understood by `navigate`; arrival by `advanceJourneys`. Existing arrival records include structured IDs and prose; persist the IDs/facts, never the message. Docking approaches and area travel are distinct journey kinds. |
| `js/game.js` | Power runs first and advances `simulationTime` once. Journeys and contacts follow. Do not add another clock increment. Numeric power changes are not ledger events. |
| `js/locations.js`, `js/resources.js` | `transferBetweenLocations` currently combines action checks, silent movement, and a presentation string. Preserve a silent movement path and introduce a separate semantic transfer operation. Resource arithmetic must not infer trade or resource-transfer history. |
| `js/effects.js`, `js/bootstrap.js` | Effect Dispatch Round 2 is already implemented: spawn, activate/deactivate, location activation, and relocation dispatch through injected services to silent primitives. Switch those services to semantic wrappers; the dispatcher and primitive must not also record. |
| `js/npcs.js` | Relocation has stable NPC/destination IDs, but can assign the same destination. A semantic wrapper must suppress no-op relocation records. |
| `js/research/researchActions.js` | `executeExperiment` knows which discoveries were newly learned and executes rewards atomically. Record newly completed discoveries here, not from generic `grantDiscovery`. |
| `js/research/researchState.js` | Research already retains a bounded 100-entry domain journal, including observations and RNG-related context. Its authoritative progress/contracts keep existing strict compatibility rules; ledger-only historical content IDs must not add such requirements. |
| `js/eventBus.js`, `js/app.js` | Bus messages have `author/type/text`, queue until startup, and feed terminal presentation. They are neither durable facts nor a transaction boundary. No ledger subscription or bus replacement. |

Measured the default fresh state through `buildGameSystems().stateServices`:
**6,672 JSON characters**, eight identities, five locations, save version 8.
This is a fresh-state measurement, not a maximum populated save. There is no Git
repository or package manifest in this workspace; testing uses Node's test runner.

Processing, finite resource nodes, trading, Actor Goals, and the Event Director
are not implemented in the current production modules. Existing `refineScrap`
is immediate crafting, and acquisition actions do not consume finite deposits.
Neither should be mislabeled as a timed processing run or node depletion.

## 3. Responsibility and boundaries

The ledger owns:

1. Canonical record construction, deterministic IDs, and append order.
2. Validation of envelopes, typed payloads, canonical quantities, and references.
3. Bounded retention.
4. Predictable queries over the retained window.
5. A reference collector for existing lifecycle infrastructure.

The originating domain owns whether a transition is meaningful, actor/subject
roles, historical placement, actual quantities, reason codes, and event ordering.
It owns permanent consequences in ordinary state. A valid record is not proof
that an operation occurred: trustworthy producers and their tests establish that.

Runtime owns clone/mutate/validate/save/commit. Presentation owns labels, quantity
formatting, terminal messages, and any later prose. Future knowledge systems own
who knows a fact. Querying the ledger does not grant knowledge or access rights.

Do not diff all state automatically. Do not emit from previews, requirements,
rendering, catalog compilation, initialization, loading, or content reconciliation.
Do not infer an event from terminal text, item tags, or changes to arbitrary flags.

## 4. Saved-state and entry schemas

```js
state.worldLedger = {
  nextId: 1,
  entries: []
};

// A current-game example: actual IDs and quantity conventions.
{
  id: 12,
  type: 'RESOURCE_TRANSFERRED',
  time: 18320.25,
  actorId: 'player',
  targetId: 'supplyPlatform',
  locationId: 'habitat',
  areaId: 'vicinity',
  importance: 0.2,
  data: {
    sourceId: 'habitat',
    destinationId: 'supplyPlatform',
    resourceId: 'scrap',
    quantityKind: 'bulk',
    amount: 10000
  }
}
```

| Field | Contract |
| --- | --- |
| `id` | Positive safe integer, unique within this save, monotonic; use `ledger_<id>` only as a display label if needed. Not an entity ID and not globally unique across games/save branches. |
| `type` | Exact supported uppercase type key, selected from an immutable descriptor table. |
| `time` | Finite, nonnegative simulation seconds; fractional values are valid. Writer assigns `candidate.simulationTime`. No wall clock or caller-supplied timestamp initially. |
| `actorId` | Entity doing the action, or `null` when unknown/not applicable. May be a ship, host site, NPC, or principal, as specified by type. Never substitute current owner or player for an unknown actor. |
| `targetId` | Primary affected entity, or `null`. Affected equipment group is a payload ID, not an invented entity. |
| `locationId` | Historical context entity: area/site/ship, or `null`. For a remote transfer, use its source. For an arrival, use its destination. Context is not current occupancy. |
| `areaId` | Historical containing area when known, otherwise `null`. Useful for finding nearby events after actors move. Snapshot an ID, not an area object. |
| `importance` | Finite number in `[0,1]`, set from the type default unless explicitly overridden. |
| `data` | Exact per-type record of factual identifiers, numbers, enums, and tightly bounded collections. Amount facts include their canonical quantity kind so load validation/formatting does not need a surviving catalog definition. No arbitrary extensible metadata object. |

All common keys are present; absent optional identities normalize to `null` at
append time. The caller supplies neither `id` nor `time`. Payloads are copied
before storage, so later caller mutation cannot alter history.

`locationId` describes one event context, not every involved place. Descriptor
references identify other involved entities/places in `data`. `areaId` is included
now because existing placement makes it meaningful and avoids consulting current
positions to answer historical regional questions. The writer does not guess a
missing location from whichever entity the player currently occupies.

For ship departures/arrivals, `actorId` is the ship; a known navigator belongs in
an optional `initiatorId` payload reference. Arrival must not fabricate an
initiator when the existing journey state does not remember one.

For equipment events, `targetId` is the host and `data.equipmentId` is the compiled
infrastructure-group key. This describes the existing aggregate group, not a
particular physical unit within that group.

Do not store inventory/entity snapshots, formatted amounts, generated labels,
free-form error messages, narrative text, or research observation prose.

## 5. Retention and size

Use `WORLD_LEDGER_LIMIT = 200`, stored once in code, not in each save. This is an
initial implementation bound, not a settled balance value. Push onto the
ordered array and remove the oldest prefix above the limit. At this size, a small
array is simpler than a circular head/index representation and integrates cleanly
with whole-state JSON cloning. It is logically a ring buffer with FIFO eviction.

The initial FIFO algorithm produces a contiguous suffix, but persisted validity
does not require one. Retained IDs must be strictly increasing and below `nextId`;
gaps and an empty retained window with a larger counter are valid. `nextId` never
decreases, including after eviction. There is no public delete/edit/reset API. An abandoned
candidate does not consume committed IDs; a failed action can reuse its uncommitted
ID on retry. Counter exhaustion throws before mutation and never wraps.

Use these initial bounds:

- Maximum serialized entry: **2,048 JavaScript string code units**.
- Any persisted identifier: at most **128 characters**, in addition to existing
  entity/content ID syntax. A larger existing valid ID may still be an entity;
  it needs an explicit ledger policy adjustment before it can be recorded.
- Any typed collection: at most **16 elements**, unless a descriptor specifies a
  smaller bound. Current research completion records store one discovery per entry.
- Payloads permit only their declared nesting; no recursive general JSON tree.

An entry bound is necessary: limiting record count alone cannot prevent one huge
payload from filling a save. Validate the final entry's serialized length in both
append and full validation. Reject oversize entries; do not silently truncate facts.

Typical small records should consume approximately 60–100K JSON characters for
200 entries; verify using representative fixtures, not an asserted browser quota.
The explicit worst-case ledger bound is about 410K characters plus its envelope,
or roughly 820KiB if accounted as two-byte string storage. This is not a promise
of available `localStorage` capacity; other saved state and browser policy matter.
Quota errors still follow existing save failure behavior.

No time expiry or importance-aware eviction initially. Importance affects queries,
not retention. A 200-event window has no guaranteed duration at high activity.
Do not hide this by keeping completed runs or NPC obligations only in the ledger.
Future pruning/importance-aware retention can preserve this schema because gaps
are already valid; no migration is required solely to remove selected records.
Changing encoded facts, quantity conventions, or counter semantics is a different
compatibility decision. Raising the limit is additive; lowering it below an old
valid window needs an explicit, documented load-normalization policy or migration
instead of treating old history as corruption or silently accepting arbitrary
oversize ledgers. Do not implement such pruning now.

When Processing exists, measure records per simulated minute, retained time span,
JSON size, and save writes for routine workloads, many concurrent machines, and
power/output blockage cycles. Include started/completed and blocked/resumed/depletion
bursts. Use those measurements to tune the single constant and domain batching
semantics before treating 200 as a balance decision. Until then, record the value
as provisional in implementation documentation and tests.

## 6. Typed descriptors and initial event vocabulary

Use `js/worldLedgerTypes.js`, modeled on the project's immutable effect descriptors:

```js
// Illustrative contract, not a dynamic plugin/registration API.
RESOURCE_TRANSFERRED: {
  defaultImportance: 0.2,
  validateHistorical(entry) { /* structural facts and stored quantity kind */ },
  validateAppend(entry) { /* closure over resourceKind(id) only */ },
  references(entry) { /* explicit { path, targetId, role } facts */ }
}
```

One table supports writer validation, saved-state validation, entity-reference
collection, and involvement queries. Descriptors have no execute/subscribe/render
hooks. No schema package, type-discovery mechanism, generic query language, or
mutable global registration API is needed. Dependencies are bound per game.

Historical descriptor validation has no current catalog dependencies. Entity
existence/type/time checks belong in the ledger's common reference-validation
layer using `getEntity`, not in catalog-aware descriptor code. Append runs the
historical checks first, then the descriptor's narrowly bound current-content checks.

Bind only the specific read-only capabilities needed by a type:

| Descriptor family | Append-only capabilities |
| --- | --- |
| Resource/amount facts | `resourceKind(id)` returning the current canonical kind or rejecting an unknown ID. Item-only lines reject utility kind. |
| Equipment repair | `isCurrentEquipmentId(id)`; the gameplay domain establishes host suitability and legal repair. |
| Research completion | `isCurrentMethodId(id)`, `isCurrentDiscoveryId(id)` from research, without passing the research system/state wholesale. |
| Future processing | `isCurrentProcessId(id)` for new starts and amount lookup; accepted-run transitions use snapshotted contracts. Local node/run identity is established by its domain, not a global catalog coordinator. |
| Ship/entity/NPC facts | No content catalog access; existing persistent identity types and structural facts suffice. |

A small descriptor factory binds these capabilities to the fixed supported table;
each descriptor closes over only its own capabilities. Bootstrap adapts catalogs
to those read functions. Do not pass `{ state, content, world, people, research }`
to every validator, or give historical validation a "lookup if available" path
that changes the validity of old entries when current definitions change.

Implement descriptors for these existing meaningful operations first:

| Type / default importance | Roles and minimal data |
| --- | --- |
| `SHIP_DEPARTED` / 0.4 | Actor ship; target destination; location origin area. `kind: 'area' | 'dock'`, `originAreaId`, `destinationId`, optional known `initiatorId`. Destination and origin are historical references. Departure means starting a journey, not clearing `dockedAtId`. |
| `SHIP_ARRIVED` / 0.4 | Actor ship; target/location destination; area is resulting area. Same journey-kind/origin/destination facts captured before clearing journey. |
| `RESOURCE_TRANSFERRED` / 0.2 | Actor known principal/NPC; target destination; location source. `sourceId`, `destinationId`, `resourceId`, `quantityKind: 'bulk' | 'count' | 'utility'`, positive canonical `amount`. Append verifies kind against current content; history validates amount from stored kind. Both containers are historical references. This is not `TRADE_COMPLETED`. |
| `ENTITY_CREATED` / 0.5 | Actor creator if known, otherwise null; target new identity. `entityType`, `initialLifecycle`. Definition already lives on the retained identity and need not be copied. |
| `ENTITY_ACTIVATED` / 0.4 | Actor initiator if known; target entity. `previousLifecycle: 'inactive'`. Do not record during seeding. |
| `ENTITY_DEACTIVATED` / 0.4 | Actor initiator if known; target entity. `previousLifecycle: 'active'`. |
| `ENTITY_DESTROYED` / 1.0 | Actor initiator if known; target entity. `previousLifecycle: 'active' | 'inactive'`. |
| `ENTITY_RETIRED` / 0.5 | Same historical roles; previous lifecycle active/inactive. |
| `NPC_RELOCATED` / 0.4 | Actor moved NPC; target destination; location destination. `fromLocationId`, `toLocationId`, optional known `initiatorId`. Both places are historical references. |
| `RESEARCH_COMPLETED` / 0.6 | Actor researcher (`player` in current actions); target null; experiment location/area. `discoveryId`, `methodId`, `attemptId`. One record per newly learned discovery. Attempt ID is a research counter value, not a ledger/entity reference. |
| `EQUIPMENT_REPAIRED` / 0.3 | Actor repairer; target/location host; `equipmentId`, `previousHealth`, `health: 1`. Both health values normalized `[0,1]`; require an actual health increase. |

Exact descriptor rules constrain allowed entity types, required/null common fields,
and equalities such as transfer target/destination and relocation target/to-location.
Do not infer strong causality from timestamp equality alone.

Lifecycle `reason` is currently a free-form string in world state. Do not copy it
to ledger data. A future `reasonCode` must have an explicit domain enum; human
explanation stays in presentation or the originating state field.

Undocking, journey cancellation, player boarding, contact starts, fabrication,
cargo discards, and acquisitions can receive distinct descriptors in follow-up
work when a consumer needs them. Do not emit misleading ship departure/arrival or
processing records as substitutes. The first version does not promise exhaustive
coverage of every existing action.

Importance is an authored coarse selection hint, not an objective measurement.
Allow trusted callers to supply a valid override for a domain-known special case;
otherwise use the table default. Do not calculate it from stock changes, text,
randomness, NPC interest, or narrative rules. Persist the resulting value so
editing a default does not rewrite historical importance.

## 7. Append validation versus historical validation

`validateWorldLedger(state)` is synchronous, read-only historical validation, used
on load and on every ordinary runtime validation. It never consults item, method,
discovery, equipment, or process catalogs. Otherwise a future unrelated action
would reject the same historical record that loading had just accepted.

It checks:

1. Root ledger has exactly `nextId` and `entries`; entries is an array within the
   single provisional `WORLD_LEDGER_LIMIT` constant (initially 200).
2. `nextId` is a positive safe integer. A terminal maximum counter is loadable but
   cannot allocate another entry; append requires room for the increment.
3. IDs are positive safe integers, strictly increasing and unique, and all are
   below `nextId`. Empty windows with `nextId > 1` and gaps are valid. Do not assert
   entry count against lifetime append count or require the newest ID to equal
   `nextId - 1`. Duplicate/reordered IDs and counters at/below the newest ID fail.
4. Every entry has exactly the declared envelope keys and a supported descriptor.
5. Times are nondecreasing, finite, nonnegative, and no later than simulation time.
   Equal times are valid; ID order breaks ties. Referenced entities must already
   have existed by the record time (`createdAt <= time`).
6. Importance is finite and in `[0,1]`; nullable identities are either null or
   valid, length-bounded IDs. No contextual aliases such as `current`/`speaker`.
7. Historical descriptor enforces exact data keys, types, bounded arrays,
   structurally valid historical content IDs, allowed role combinations, and
   canonical quantities. Positive movements must actually be positive. Stored
   `quantityKind` determines rules: bulk/count require nonnegative safe integers;
   utility permits finite nonnegative values up to `Number.MAX_SAFE_INTEGER`.
   Current catalog absence or a changed current kind does not invalidate history.
8. Persisted data is plain JSON-compatible data: no undefined, nonfinite numbers,
   functions, BigInts, class instances, cycles, or prototype-bearing payloads.
   Reject unknown/dangerous keys; JSON serialization alone is not validation.
9. Final serialized entry length is within the bound. Validators do not repair,
   trim, reorder, or recompute IDs/importance.
10. All entity references exist and have the type allowed by their historical
    role. The ledger validator should check this too, so a custom collector list
    cannot accidentally disable the ledger's basic referential validity.

Append first uses the same historical envelope/payload/reference validators and
then requires current valid content IDs through its descriptor's append-only
capabilities. Check recorded quantity kind against the current definition and
reuse existing canonical validation at this boundary. A removed/unknown item,
equipment group, method, discovery, or process cannot enter a new entry through
the writer. There is no public caller-selected "historical append" mode.

Content ID structural checks follow the source namespace: item/method/equipment/
process IDs use the project's ID syntax; discovery IDs use its safe nonempty key
convention, all subject to the ledger's length bound. These remain facts, never
entity references. Reject malformed IDs even if a matching catalog key exists.

Full validation checks the complete bounded window for historical plausibility.
It cannot prove that a saved record was originally emitted through append, or
recover provenance/catalog membership for a manually edited old fact. Production
mutation must use the writer; producer tests enforce that boundary. Invalid
structure/identity/quantity data fails action/frame/load; never silently drop it
to make saving succeed. Errors identify entry ID/type/path. Registry failures retain
`participantId: 'world-ledger'`, phase, and cause as in existing systems.

Validate historical facts, not whether they match the world today. A transferred
amount need not remain in cargo; a repaired machine can be damaged again; an
arrival destination can be inactive; a completed run can be removed from active
processing state. `RESEARCH_COMPLETED.attemptId` need not still be present in the
separate, shorter research journal.

Removed/renamed item, method, discovery, equipment-group, or process IDs remain
unchanged in historical records and require no tombstones or ledger migrations.
Read/presentation consumers resolve current labels when available and fall back to
the stored ID when unavailable. Snapshotting quantity kind preserves whether an
amount means bulk volume, count, or utility without copying names or definitions.
Do not reinterpret past amounts using current recipe ratios, item categories,
owners, health, placement, process durations, or catalog membership.

| Fact | Append-time checks | Historical runtime/load checks |
| --- | --- | --- |
| Content ID | Valid syntax and current membership in its namespace | Valid syntax only; retain absent/renamed ID unchanged |
| Quantity | Canonical amount and kind match current resource definition | Canonical amount valid for the persisted kind; no catalog lookup |
| Entity reference | Existing identity/type, created by occurrence time | Same persistent checks, allowing all historical lifecycles |
| Transition payload | Structural old/new enum/equality/range constraints | Same structural constraints; never compare to the entity's current status |
| Historical place | Correct identity type; producer captures occurrence placement | Identity/type only, never current containment/placement |

The ledger does not relax authoritative world-state compatibility. For example,
removing a discovery still required by research progress/contracts may independently
need a research migration. Tests for tolerant history must remove definitions
referenced only by the ledger so an unrelated authoritative invariant is not
mistaken for a ledger failure. Changing the interpretation of encoded quantity
units, unlike removing a content label/definition, still requires a migration.

## 8. Entity-reference semantics

Add `historyEntity` to `js/entityReferences.js`: all current entity types, all
lifecycles, policy `retain`. Existing `content` is technically broad enough, but
an explicit historical role expresses the correct meaning without calling ledger
history authored content. Continue using `historyNpc`, `principal`, `historyArea`,
`historyLocation`, and `historyContainer` when a type needs narrower constraints.

`collectWorldLedgerReferences(state)` returns references for common fields and
every declared entity-valued payload field. Its source includes the ledger ID and
field path, e.g. `worldLedger.entries.12.data.sourceId`; use null `sourceId` for the
reference record because the ledger entry is not an entity. Do not use numeric
ledger IDs where the entity API expects an entity source.

Add the collector to `stateReferenceCollectors` in `js/entityComposition.js`.
All these records use `retain`, never `block` or `closeContact`. Lifecycle previews
may report historical references but must not include them as blockers.

Missing identities remain invalid: destroyed/retired is not the same as deleted.
Do not create orphan tombstones on load to hide a malformed ledger. Existing
terminal identities and `getEntityLabel` supply historical labels. No name fields
are needed. Active renamed entities may display their current label; exact past
names are a separate future identity-history requirement.

Area and location snapshots must have valid historical types/existence. Do not
compare them to current placement during reload. When appending, the semantic
producer captures placement at the transition; tests verify that capture.

## 9. Mutation and read APIs

Core exports in `js/worldLedger.js`:

```js
createWorldLedger(); // { nextId: 1, entries: [] }

createWorldLedgerServices(appendChecks); // frozen { append, validate }

// bound services.append: the only public history mutation
append(candidate, {
  type,
  actorId: null,
  targetId: null,
  locationId: null,
  areaId: null,
  data: {},
  importance // optional: default comes from descriptor
}); // returns assigned numeric ID

recentLedgerEntries(state, query = {});
ledgerEntriesForEntity(state, entityId, query = {});
ledgerEntriesAtLocation(state, locationId, query = {});

validateWorldLedger(state); // historical; no content catalog dependencies
collectWorldLedgerReferences(state);
```

`append` explicitly accepts the supplied candidate. It never captures runtime
`getState`, clones root state, saves, commits, publishes, or calls arbitrary code.
Validate input/current ledger ordering/counter, build and validate a detached entry
using historical and append-only checks,
then increment/push/trim. Return an ID rather than a mutable stored record.
Do not repair a missing ledger on append: only fresh initialization/load owns that.
The transaction boundary remains the caller's responsibility.

Queries accept only:

```js
{
  type,              // one exact supported type
  actorId, targetId,
  locationId, areaId,
  since, until,      // inclusive simulation times
  afterId,           // exclusive append cursor for 'since last visit'
  minImportance,
  limit             // integer 0..WORLD_LEDGER_LIMIT, default that provisional bound
}
```

Filters combine with AND. Omitted fields do not filter; explicit null matches a
null common identity. Reject unknown fields, invalid types/ranges, and
`since > until`; a filter that finds nothing returns `[]`.

Return newest first, ordered by descending append ID. Read through the bounded
array with no persisted indexes. Return detached copies so callers cannot mutate
saved history through a query result. Queries neither advance time nor consume
entries. Catalog dependencies stay out of basic read filtering.

`ledgerEntriesForEntity` means **involvement**, not just `actorId`: match actor,
target, location, area, and typed payload references. Thus an NPC relocation is
findable from the NPC or either endpoint, and a transfer from both containers.
Never recursively search arbitrary strings; item/process IDs are not entity IDs.

`ledgerEntriesAtLocation` matches exact historical common `locationId`, not current
placement or all remote endpoints. Use involvement queries to find all endpoint
references, and `areaId` for nearby regional facts. Conflicting helper/query filters
are errors rather than silently overridden values.

`afterId` is one narrow cursor filter, not a query language. A future visitor system
can store `worldLedger.nextId - 1` in its own state. Compare a cursor with the oldest
retained ID to detect lost prefix history. With future selective pruning, internal
ID gaps also signal incomplete coverage; neither cursor metadata nor an empty
result proves completeness. Do not treat a permissible gap as corruption or an
empty result as proof that nothing happened or an entity never met someone.
If entries are empty but the counter has advanced, the ledger has no retained
coverage of those earlier IDs.

Presentation is entirely separate. Development inspection can use these copies
with `console.table` or a test harness. A debug tab/global browser hook is optional
and is not required for the ledger's acceptance.

## 10. Integration and semantic ownership

Prefer an explicitly injected writer capability at semantic operation boundaries.
Do not require the generic action registry/runtime to interpret operation results.
Existing actions return strings/undefined; preserve that public contract.

Bind `ledgerServices` once in bootstrap after catalogs exist. Supply it explicitly
to relevant action factories and semantic services. Avoid global services and
fallback construction inside each action. Pass it to `createAdditionalActions`
and simulation construction context so extensions can use the same bound writer.

For ship operations, pass the capability to `navigate` and `advanceJourneys` from
their composed handlers. Append at successful journey installation/completion,
capturing origin/destination before mutation clears them. Keep existing prose
return values/arrival messages unchanged. Existing arrival adapters already ask
for a save. Non-ledger compatibility calls can remain available without a writer;
all production gameplay entry points must receive one and be covered by tests.

Make physical resource movement and semantic transfer separate APIs now:

```text
resources.moveExact(sourceStore, destinationStore, resourceId, amount, content)
    silent exact physical movement; checks arithmetic/storage, emits nothing

worldOperations.transferResources(candidate, payload, { actorId })
    deliberate direct transfer; existing endpoint/access checks + silent movement
    + exactly one RESOURCE_TRANSFERRED, using a bound ledger writer

trade/process/reward/logistics operation
    its own legality checks + one or more silent movements
    + its own higher-level record if meaningful
```

Bind `transferResources` in `createWorldOperations`; it must not call another
recording wrapper. The player `transferLocations` action calls this semantic
operation and preserves its existing message. Retain `transferBetweenLocations`
as a silent compatibility facade, or extract its checks/movement for reuse; do
not insert an unconditional append there. Document its silence explicitly.
There is no `suppressLedger` flag: choosing the physical primitive versus the
semantic operation expresses intent directly. A trade performs silent physical
moves and appends one `TRADE_COMPLETED`; a reward/grant is not a direct transfer.

Repair appends in the repair action closure after a real health increase. Generic
`pay`, `moveExact`, `transfer`, `repairEquipment`, and quantity arithmetic remain
unaware of history. Two resource moves never automatically constitute a trade.

For entity creation/lifecycle/relocation, add `js/worldOperations.js` with composed
gameplay wrappers around the existing primitives. These wrappers capture previous
state/placement, call the primitive on the same candidate, then append facts.
Seeding, migration, and reconciliation continue calling non-recording primitives.
Expose these gameplay wrappers for future Actor Goals/Event Director callers, and
use them in effect services; do not independently record again in `applyEffects`.

- Batch creation appends one record for each successfully created identity, after
  the whole batch primitive succeeds. No per-record save or root clone.
- Lifecycle wrappers use the actual transition result and pre-transition place,
  including before terminal placement becomes unavailable to ordinary queries.
- Relocation emits only when old and new locations differ.
- Wrapper options carry a known initiator when available; unknown is null.
- Gameplay service wrappers retain their ordinary domain catalog dependencies
  when transitions need legal-operation checks or retained-label resolution.
  These dependencies do not flow into ledger historical validation or the entire
  descriptor table; append descriptors receive only their named lookup capabilities.

### Effect Dispatch Round 2 mutation-path audit

The following paths describe the pre-ledger source and its approved recording
ownership. Production effect services now use the semantic wrappers. The unit and
browser results below verify that dispatch adds no duplicate records, while
seeding, migration, reconciliation, and silent physical movements remain silent.

| Current path | Recording owner after implementation | Silent path preserved |
| --- | --- | --- |
| `effects.spawnEntity.execute` -> `createEffectServices.spawnEntity` -> `entityCreation.createEntity/createEntities` | `worldOperations.spawnEntity/spawnEntities`; batch wrapper alone appends one creation fact per entity. Single-spawn delegates to that wrapper without a second append. | `createEntity/createEntities` remain silent domain primitives. |
| `effects.activateEntity.execute` -> `createEffectServices.activateEntity` -> `entityLifecycle.activateEntity` | Semantic activation delegates to one recording transition wrapper. | `activateEntity/transitionEntity` remain silent. |
| `effects.activateLocation.execute` -> the same activation service | Same semantic activation wrapper, after the descriptor's location-type check. No separate location-activation record. | Descriptor alias adds no recording layer. |
| `effects.deactivateEntity.execute` -> deactivation service -> `deactivateEntity` | Semantic deactivation delegates to the same single transition recording owner. | Silent deactivation/transition primitives preserved. |
| `effects.relocate.execute` -> relocation service -> `npcs.relocateNpc` | Semantic `worldOperations.relocateNpc` captures source and records once if destination differs. | Domain `npcs.relocateNpc` stays silent. |
| `stateCore.createInitialState` and `migrateIdentities` -> `seedEntities` | No recording owner: initialization/migration emits no facts. | Existing seed calls and legacy lifecycle assignments unchanged. |
| `entityState.reconcileEntityInstances` -> `seedEntities`; fresh NPC/location instance assembly | No recording owner: content/load repair emits no facts. | Existing reconciliation/assembly remains silent. |
| Future gameplay destruction/retirement/batch creation | Composed semantic wrappers with one transition/batch recording owner. | Existing primitives remain usable for explicit non-gameplay repair. |

Existing item operations, dialogue choices, research rewards, and console/scene
inspection effects all use `applyEffects` with injected effect services. Route
all of these through the composed semantic wrappers, including standalone
`createEffectServices` consumers that intend gameplay recording. The production
service factory must require the supplied world operations; do not silently fall
back to non-recording primitives when that capability is missing. Explicit repair
callers use primitives directly, not gameplay services with recording disabled.

The dispatcher may forward captured provenance but never import/call append or
inspect event types. Silent primitives never import the ledger. Rejected/no-op
operations append nothing. A later failure can leave provisional records on the
discarded candidate but must produce **zero committed records**; distinguish this
from insisting the writer was never called during a failed transaction.

Implementation gates: repeat the production mutation/import search, classify
every new caller as gameplay or silent repair, and test actual item/dialogue/
research/inspection service paths. Assert committed counter deltas and event
type/target counts, not merely total entries in a heterogeneous action.

Before this implementation, effect services lost actor information: the captured
trigger had `kind/locationId/npcId`, and service methods did not receive it. Relevant
descriptors now forward an optional final trigger/context argument, and the captured
trigger includes optional `actorId`. Current player action call sites supply
`'player'`; a speaker is not automatically the actor. Leave existing
primitive signatures compatible and do not add a generic effect result binding
system. A caller without provenance produces honest null attribution.

In `executeExperiment`, record one `RESEARCH_COMPLETED` for each sorted `learned`
discovery after insight/knowledge application and before its reward effects.
This produces deterministic causal order: learning, then reward-created entities
or relocations. If any later reward/validation/save fails, all entries and state
changes are discarded. Record neither partial insight nor repeated observations.
Generic discovery grants are not necessarily experiments and emit no research event.

The ledger does not decide whether a repair, journey, or research action is legal.
Existing requirements and domain checks do that; the append validates the facts.

## 11. Shared timed persistence adapter and transaction guarantee

Retain the current power -> journeys -> contacts order. Processing later inserts
its explicitly composed step at the domain-appropriate position, likely after
power and journeys and before contact reconciliation, subject to its own design.
The ledger itself has no simulation step.

Add `withLedgerSaveRequest(step)` in `js/worldLedgerSimulation.js`. Apply it to
**every step in the final selected manifest**, after `composeSimulationSteps`
has returned and its descriptors have been checked/snapshotted, then snapshot the
wrapped descriptors for runtime. This includes custom/injected steps and future
Processing; their authors do not have to remember a ledger-specific save flag.

The wrapper preserves ID/order and the same candidate, elapsed time, context,
underlying return contract, and domain output. Its only policy is forcing a save
when the append counter changes. Domains still author other save requests and
presentation outputs. The generic runtime and simulation runner remain unchanged.

Conceptual implementation:

```js
function withLedgerSaveRequest(step) {
  return { id: step.id, advance(candidate, elapsed, context) {
    const before = candidate.worldLedger.nextId;
    const report = step.advance(candidate, elapsed, context);
    if (candidate.worldLedger.nextId === before) return report;
    if (report === undefined) return { saveRequested: true };
    // Never sanitize malformed/async reports into a successful report.
    if (!isMergeableReport(report)) return report;
    return { ...report, saveRequested: true };
  } };
}

const selected = snapshotSimulationSteps(composeSimulationSteps(defaultSteps, context));
const simulationSteps = snapshotSimulationSteps(selected.map(withLedgerSaveRequest));
```

`isMergeableReport` is a small private guard: non-null non-array synchronous
object, no thenable, and absent/boolean `saveRequested`. It is not a replacement
report validator. For reports outside that shape, return the original invalid
value so the existing runner rejects it; for mergeable objects, keep all keys
and output values so existing unknown-key/output validation still applies.
No duplicate-key/output merging logic belongs in this wrapper. Exceptions from
the original step propagate with existing participant attribution. If the original
step throws after appending, the candidate already fails and needs no report/save.

Unit-test the wrapper directly and integration-test its application after custom
composition. A custom step that appends and returns `undefined` or
`{ saveRequested: false }` must still validate/save before commit; appending then
returning a Promise/invalid report must fail rather than be sanitized into success.
Assert one wrapper application per selected step, manifest order, context identity,
and existing save/output behavior on quiet steps.

Counter comparison remains correct when FIFO length stays at its cap or retained
IDs have gaps. It assumes mutation uses the append API. Unsupported direct array
writes that do not advance the counter are outside the sanctioned mutation
contract; do not introduce arbitrary state diffing to detect them.

Construction through `buildGameSystems` always applies the wrapper. A caller
building a raw isolated runtime must use the same helper for its composed steps;
document that explicit low-level contract and test it. Do not add ledger detection
to `runtime.js`, persistent dirty markers, or writer-owned save requests. Existing
journey adapters retain their other arrival-based save/output behavior. Future
timed systems return ordinary reports; the shared wrapper covers history saving.

Ledger-bearing frames request an immediate save as a deliberate tradeoff: stronger
failure isolation can increase write frequency. Batch all transitions in a frame
into one candidate and one save; never write once per entry. If future processors
produce excessive completed batches, define meaningful domain batch aggregation
or revisit generic persistence policy explicitly. Do not sample away facts in the
ledger writer or stop validating them to reduce writes.

Writer timestamps describe the simulation time at which the operation observes
the transition. All transitions observed in a frame can share its end time; IDs
preserve deterministic execution order. No fabricated sub-frame timestamps or
cross-domain timestamp sorting initially. Determinism means the same initial state,
catalogs, and elapsed/action sequence produce the same history; it does not promise
identical histories for arbitrary different frame subdivisions.

If execution, a later step, reconciliation, validation, or saving throws, neither
ledger entries, retention trimming, next-ID increments, nor gameplay mutations
reach committed state. Existing frame pause/action recovery behavior is retained.
No separate rollback, dirty-field persistence, transaction object, or external
effect is introduced.

## 12. State Lifecycle Registry and initialization

Add one optional generic phase: `{ id, initialize?, validate?, reconcile? }`.
`initialize` runs once on a newly assembled state, after identity seeding and
before final validation. It is not run on actions, simulation, or loads. Existing
domains need no initialization hooks and retain their current behavior/order.

This is a deliberate, small extension to the recently introduced registry. Its
earlier implementation deferred initialization; the new persistent field now
requires it to satisfy the requested absence of ledger-specific core handling.
Do not call all reconciliation hooks during fresh creation, allow missing state
in validation, or initialize inside a validator to avoid this seam.

```js
{
  id: 'world-ledger',
  initialize(state) {
    if (Object.hasOwn(state, 'worldLedger')) throw new Error('Already initialized');
    state.worldLedger = createWorldLedger();
  },
  reconcile(state) {
    if (!Object.hasOwn(state, 'worldLedger')) state.worldLedger = createWorldLedger();
  },
  validate: state => ledgerServices.validate(state)
}
```

The registry validates/freezes the optional hook, rejects thenables, and attributes
initialization failures with ID/phase/cause just like existing phases. Do not add
initialize hooks for every old domain or move all initial assembly in this round.

The new hook's scope is only a participant's fresh saved-state slice. The ledger's
hook assigns its empty record; it does not seed identities, resolve content,
grant starting items, run effects, draw RNG, migrate fields, or inspect prior
saves. Existing initial assembly stays in core/domain constructors and explicit
legacy migrations remain unchanged. No general initialization dependency graph,
default-merge framework, or new migration phase is introduced.

`stateCore.createInitialState` resolves the supplied/default lifecycle once, calls
its generic initialization phase, then passes that same lifecycle to validation.
No `worldLedger` field, writer import, event type, or ledger branch enters core.
Preserve positional public signatures. Bootstrap and `state.js` wrappers continue
to use the same default composition. Document the hook contract for explicitly
supplied lifecycle implementations.

Add `world-ledger` after research and before `entity-references` in the default
manifest; all existing validators retain their relative order. Its load hook
only supplies an absent empty field and emits no events/notices. Entity-instance,
dialogue, and research reconciliation retain their order. Ledger validation runs
before its collector is traversed by the reference-validation phase.

## 13. Save compatibility

### Project-wide save-version policy

The inspected repository has explicit versioned migrations for interpretation
changes (quantity conversion and persistent identity), and same-version content
reconciliation for compatible defaults. It did not previously state a general
rule for every new root field. This revision adopts and documents the rule in
`ARCHITECTURE.md`, rather than claiming an exact-schema policy already existed.

`SAVE_VERSION` is the **non-additive migration boundary**, not a fingerprint of
every current required field. A version identifies a family of on-disk saves
that can be normalized to the current canonical runtime shape without changing
their existing meanings. Load reconciliation precedes canonical validation.

An additive field may keep the version only when its absence unambiguously means
an empty/neutral default, no existing field is reinterpreted, existing progress/
assets/RNG/history are preserved, and defaulting cannot replay gameplay/rewards
or conceal malformed-present data. Reconciliation must be deterministic and
idempotent and validated through the standard lifecycle.

Renaming/removing authoritative fields, changing units or identity meanings,
reinterpreting saved progress, or needing a non-neutral/data-dependent conversion
requires explicit migration. Structural/interpretation migrations use a new save
version; content-balance migrations may use existing explicit domain contracts
when appropriate. Merely calling a change "additive" does not waive these rules.

The ledger meets the same-version conditions: absence means no recorded recent
history, its default grants nothing, and current truth is unchanged. Thus keep
`SAVE_VERSION = 8`; older and newer v8 encodings normalize to one required runtime
schema. Direct validation requires that normalized schema; it is not an on-disk
compatibility detector. This project-wide policy is documented in `ARCHITECTURE.md`
and used by the implemented ledger participant; its compatibility tests pass.

| Input | Behavior |
| --- | --- |
| New game | Generic initialization creates `{ nextId: 1, entries: [] }`; normal final validation requires it. No authored-spawn history. |
| Existing v8, absent field | Current clone/reconcile path adds the empty ledger, then validates. Do not invent past events from current state. |
| Existing v8, valid ledger | Preserve entries/counter exactly; reload is idempotent. |
| Existing v8, ledger-only content ID removed/renamed | Preserve structurally valid history unchanged; no tombstone, current catalog lookup, or ledger migration. Persistent entity references remain strict. |
| Existing v8, malformed/null/present-undefined ledger | Reject and preserve the source save. Only absence qualifies for defaulting. |
| Versions 1–7 | Existing frozen migration and identity conversion run first; composed current reconciliation adds the field when absent. Preserve quantity conversion, RNG, notices, and input-save immutability. |
| Version above 8 | Keep the existing unsupported-version rejection. |

No change to `stateV7.js` or `storageMigration.js`. Test literal old fixtures and
remove the new field from test-generated legacy fixtures so they represent genuine
old formats rather than smuggling new fields through legacy conversion.

A missing-ledger v8 load is initialized in memory; the existing action, periodic,
or pagehide save persists it. Startup need not perform a new special save just for
this empty default. Reloading before that first save simply defaults again, with
no lost facts because none were recorded. Any first meaningful append is saved
with its containing transaction. Do not introduce an app-specific ledger check.

Strict current-state validation still rejects a missing ledger. Compatibility is
provided by `migrateState`, not by making every validator silently tolerate old
shapes. Future incompatible payload/quantity interpretations need explicit
migrations. Pruning retained records does not itself change validity because
strictly ordered ID gaps are supported. No generic schema-version machinery.

## 14. Upcoming Processing System contract

Updated planning guidance, 27 September 2026: the detailed
[Processing System implementation plan](PROCESSING_SYSTEM_IMPLEMENTATION_PLAN.md)
supersedes this section's earlier proposals. Processing is implemented; see
[Processing authoring](PROCESSING_AUTHORING.md) for the current domain contract.

Implement these descriptors alongside Processing's real compiled catalog and
saved run/node state. This plan reserves semantics, not invented production
machines, nickel content, or finite resource nodes.

Processing uses a globally monotonic `runId`, unique within the save, independent
of host, equipment group, entity IDs, and ledger retention. Store `nextRunId` and
live runs in Processing state. Never use a retained ledger entry as proof that a
run is active/completed. Equipment identity remains the host plus installed group.

Common Processing payload: `processId`, `runId`, and `equipmentId` when the actor
is an existing equipment host. Actor is the machine entity if one exists,
otherwise the host. Location is host; area is its historical area. Store an
optional known initiating actor separately if Processing really remembers it.

| Type / default importance | Emission boundary and facts |
| --- | --- |
| `PROCESS_STARTED` / 0.2 | Exactly when an accepted run loads refining inputs into the machine or commits an extraction claim. Payload adds bounded canonical inputs. No record for selection/preview/rejected starts, including a powered manual run unable to make initial progress. |
| `PROCESS_BLOCKED` / 0.3 | Exactly on unblocked -> blocked, including output-delivery blockage after work completes. Payload adds phase and one primary enum `reasonCode`: `HOST_INACTIVE`, `EQUIPMENT_UNAVAILABLE`, `SOURCE_UNAVAILABLE`, `NO_POWER`, or `OUTPUT_FULL`. Missing inputs and depleted sources reject starts. No per-tick repeats. |
| `PROCESS_RESUMED` / 0.2 | Exactly when a blocked working run actually advances and leaves its blocked condition; payload records `previousReasonCode`. Unloading a delivery-only wait emits no resumption. Underpowered partial work must not produce repeated resumed/blocked pairs. |
| `PROCESS_COMPLETED` / 0.2 | Once actual buffered output enters host cargo. Payload adds bounded canonical input/output lines and extracted source amount where applicable. Extraction's node debit already occurred at work finalization. Work timer reaching zero alone is insufficient for this event if delivery fails. |
| `PROCESS_ABORTED` / 0.3 | Once an authorized own-run initiator with current facility use, or equipment manager for any run, removes the run. No refunds/cargo outputs. Include phase, aborting actor/known reason, lost loaded inputs for working refining or actual staged output in delivery, without double-counting converted input stock. Already extracted reserve is never restored. |
| `RESOURCE_NODE_DEPLETED` / 0.5 | Once remaining reserve crosses positive -> zero during extraction working -> delivery, even with full cargo. Target is source location; payload identifies scoped node, resource, extracted amount, run ID, and processing host. This can precede completion by many updates or be followed by abort. Nodes are not entities in v1. |

Candidate Processing state retains phase (`working` or `delivery`), run ID,
primary block code, snapshotted execution parameters, committed inputs, pending
outputs, and extraction claims. Detect edges from that state, never from recent
ledger records. Retry of a blocked completion must not duplicate input consumption
or completion records. Working extraction holds a claim; work finalization debits
the node, releases that claim, and buffers output in delivery. Delivery runs retain
machine slots but no source claims or source-access requirement. Aborting delivery
loses the one staged batch physically held in the machine, without restoring
extracted reserve. Equipment failure/disabled state blocks working only, not
unloading staged output; delivery blockers are host inactivity or full storage.
This adds no buffer/unload event family or second inventory. Extracting a nondepleting
batch must also request persistence at this phase boundary; no ledger fact is
required to make that authoritative source/buffer change save immediately.

When a blocked reason changes but status remains blocked, update current reason
in Processing state and emit no new blocked entry initially. Record the previous
active block code on eventual resumption. If full block-reason history becomes
useful, add an explicitly typed reason-change event later.

Node depletion refers to a world reserve, not an empty cargo store. If the domain
supports replenishment, its state must allow a later positive -> zero transition
to generate another depletion record. It must also determine ordering within a
run: record facts in the order their semantic transitions occur, with deterministic
machine/node iteration. No pseudo node event from existing infinite salvage actions.

An illustrative completion of bulk nickel processing would store `1_000_000`
input units and `650_000` output units, not `1` and `0.65`. Counted outputs use
counts, not bulk-volume units. Exact batch ratios/rounding belong to Processing
and quantity arithmetic, not to the ledger descriptor.

Start append requires the current process/item IDs and matching quantity kinds.
Later transition appends validate the accepted run snapshot and its surviving
authoritative item/equipment references without requiring a current process
definition. Existing jobs must be able to finish after their process definition
is removed. Historical validation must not look up active runs, node reserves,
equipment availability, process definitions, or item categories. A vanished or
changed definition, later run, or repaired machine does not contradict an old fact.

Multiple completions in one elapsed update may emit multiple records and still
use one save. Do not serialize active run inventories as ledger snapshots. If a
future continuous processor's batch cadence is too frequent, its semantic batch
definition must specify aggregation before it appends.

## 15. Reuse by future systems

| Consumer/producer | Reuse and boundary |
| --- | --- |
| Trading | After a negotiated exchange actually completes all transfers/payment in one candidate, append one `TRADE_COMPLETED` with trader/counterparty, bounded resource/kind/amount lines, exact payment, and historical containers. Call silent movement primitives, not `worldOperations.transferResources`; produce no `RESOURCE_TRANSFERRED` records unless the trade design explicitly identifies a separate meaningful transfer. |
| Actor Goals | Call composed gameplay operations that already record their effects. The actor subsystem may later add typed goal-adopted/completed/failed facts where useful; do not emit goal progress ticks or repeat entity events. The ledger does not execute goals. |
| Event Director | Reads recent facts for bounded eligibility; calls ordinary gameplay operations for consequences. Persistent once-only eligibility/cooldowns remain explicit director/world state, because records can be evicted. No ledger queue or automatic reaction subscription. |
| Narrative fact providers | Combine current state, typed records, historical IDs, and labels into facts such as local arrivals, industrial completions, or NPC moves. They should not need to rerun journey/resource/processing domain logic. |
| NPC context/rumors | Start from world-truth records, then apply a separate knowledge/access model. Locality is contextual evidence, not proof of witnessing. No NPC automatically knows every record. |
| Debugging | Query by involved entity/place/time to find a transfer, relocation, lifecycle change, repair, or completed run. A quiet/evicted/unsupported operation may not appear; this is supplementary history, not a full audit log. |
| Statistics | Counts/amounts describe only the retained event window. Lifetime production/trade totals need ordinary aggregate state owned by their domains. |
| Visit/encounter context | `afterId` and historical place IDs support changes since a visit. A later contact/boarding/encounter descriptor can capture meetings. Current ship arrival alone is not proof that it met the player. Persistent relationships/encounter flags remain normal state. |

Only introduce new descriptors together with meaningful producers and validation.
Future schemas can add witnesses, participants, visibility, communication scope,
causal links, and explicit encounter IDs when their domains can populate them.
There is no such knowledge model now, so do not add guessed arrays/default-public
visibility or narrative rules. If metadata later records NPC learning, it must
distinguish occurrence time from learning time.

## 16. Implementation order and tests

### Phase A: bounded core and lifecycle

1. Add `worldLedgerTypes.js` and `worldLedger.js`: schema, separate historical/
   append-only validators, narrow current-content capabilities, append,
   retention, queries, and reference extraction.
2. Add generic optional initialization to the lifecycle registry/core and the
   `world-ledger` default descriptor. Preserve root checks and old-domain ordering.
3. Add historical reference role/collector. Bind services once in bootstrap.
4. Prove fresh/default/compatibility/custom-composition and all load paths before
   adding gameplay producers.

### Phase B: concrete existing producers

5. Wire ship departure/arrival, resource transfer, equipment repair, and research
   completion at their semantic operation boundaries.
6. Introduce gameplay creation/lifecycle/relocation wrappers and use them in effect
   services. Forward actual trigger provenance; migrate relevant direct gameplay
   callers to wrappers while retaining silent seed/load primitives.
7. Add `worldLedgerSimulation.js` and wrap the final selected manifest in bootstrap,
   including custom steps. Prove even a writer that returns no save request is
   protected. Keep terminal output unchanged and verify duplicate/no-op suppression.

### Phase C: regressions and documentation

8. Run focused suites, all unit tests, then isolated browser checks. Update current
   state-manifest assertions and relevant fixtures deliberately; do not weaken
   rollback or historical migration assertions.
9. Update architecture/module guidance and measure representative full-ledger JSON.
   Save-version policy is already documented in this design revision; keep the
   provisional retention value explicit and schedule event-rate measurement with
   the Processing implementation, without implementing a monitoring system now.
10. Processing/Trading producers follow with their actual systems; no placeholder
    gameplay implementation is needed to complete this ledger foundation.

Required test coverage:

| Area | Assertions |
| --- | --- |
| Append/counter | Sequential IDs, simulation time, authored defaults/valid overrides, same-time order, detached payloads, exhaustion before mutation, no entity-ID consumption. |
| Strict validation | Unknown type/key, malformed/null field, unsupported prototype/non-JSON value, duplicate/reordered IDs and counter at/below newest; gaps/empty high-counter windows valid. Times/ranges, stored quantity kind/fractions/overflow, zero transfers, wrong role type, missing persistent identity, payload/entry bounds. Unknown current content fails append only. |
| Retention | Initial FIFO append 201+ records yields exact newest 200; counter never reset; separately load valid pruned/gapped windows and append without ID reuse; ordinary/important events currently evict equally. Value comes from one provisional constant. |
| Queries | Newest first, AND filters, inclusive time bounds, exclusive cursor, importance, limit zero, null fields, invalid/unknown filters, involvement through payload references, historical regional context, detached results, retention gap detection. |
| Entity lifecycle | Active/inactive/destroyed/retired references validate; labels resolve through retained identity; historical references never block deactivation/retirement or close contact; moved entities still queryable at past places. |
| Initialization | Hook once before validation, never on loads/actions/frames; synchronous contract/order/errors; direct core, compatibility, bootstrap, and independently composed games; existing domains unchanged. |
| Loading | Literal v1–v6 and genuine v7; v8 absent -> empty; valid ledger reload identical; malformed-present fails without source mutation; ledger-only removed/renamed item/method/discovery/equipment IDs and changed current quantity kinds preserve history. Process-ID equivalents join Processing's tests. Subsequent unrelated action/save succeeds. No invented history, rewards, RNG draws, or notices. |
| Actions | Cargo/flags/spawn/ledger changes followed by later exception, validator failure, or save failure leave committed state and counters unchanged. Include a full ledger so failed trimming restores the old retained window. Retry creates one committed record. |
| Simulation | Shared helper automatically covers final custom manifest; sub-five-second append with undefined/false save request still validates/saves before commit. Invalid/async reports remain invalid; full/gapped ledger counter changes detected; later step/validator/save failure discards facts, pauses as today; multiple records cause one save. Quiet cadence preserved. |
| Producers | Correct stable IDs/quantities/placement; one arrival per journey, correct dock/area kind, no travel-progress/power telemetry; true relocation/repair only; one research record per newly learned discovery; rewards ordered and rolled back together. |
| Effects | Actual production service paths: spawn/activate/deactivate/relocate each adds exactly one matching committed record; activateLocation uses the same owner; batch adds one per entity; no-op/rejected operations add none. Item/dialogue/research/inspection paths, failed execution/validation/save, fresh creation, reload, content reconciliation, and direct silent repair. Unknown actor null, provenance explicit, no replay. |
| Movement ownership | Direct semantic transfer adds exactly one record; silent physical moves add zero; a composite operation uses several silent moves and emits just its one supported higher-level fact. Actual TRADE_COMPLETED/processing cases join those domains' tests. Grants never inherit unintended transfer records. |
| Historical truth | Change cargo, ownership, health, location, lifecycle, and current content definitions after valid appends. Historical validator retains plausible records, does not prove past facts from current state, and needs no catalog capabilities. Later Processing tests also change active run/node reserve without invalidating history. |
| Isolation/imports | Two composed games have independent services/candidates; no cyclic production imports; generic registry/runtime/save/quantity/resource modules have no ledger-type handling. |
| Browser | Fresh/reload startup, ignored terminal-log history, existing messages/order, hidden-time behavior, failed departure/arrival persistence and presentation, save-quota failure feedback, legacy preservation. |
| Size | Representative 200-entry state has bounded serialized size; oversize facts rejected; all payloads round-trip JSON without change. |

Verification commands:

```powershell
node --test tests/worldLedger.test.mjs tests/worldLedgerIntegration.test.mjs tests/stateLifecycle.test.mjs tests/simulationRegistry.test.mjs tests/entityLifecycle.test.mjs tests/entityMigration.test.mjs tests/storageMigration.test.mjs tests/effects.test.mjs
node --test tests/*.test.mjs
node --test tests/terminalTabs.browser.mjs
```

Use the existing isolated browser setup/dependencies. Do not open or mutate the
player's real browser save to test ledger migration. Both new focused test files
now exist and were run with the complete unit and isolated browser suites; see the
implementation results below.

Acceptance requires all initial producers on production paths, strict bounded
history, stable retained references, composed initialization/load/validation,
atomic rollback including eviction/counters, and no telemetry or prose. The
Processing acceptance additions are its actual transition/run/depletion tests
when that domain is implemented.

## 17. Expected files

| Change | Files |
| --- | --- |
| Approved design and implementation results | `WORLD_LEDGER_IMPLEMENTATION_PLAN.md` |
| New bounded storage/queries/validation/collector | `js/worldLedger.js` |
| New immutable event descriptors | `js/worldLedgerTypes.js` |
| New explicit semantic gameplay wrappers, including direct resource transfer | `js/worldOperations.js` |
| New shared automatic timed save wrapper | `js/worldLedgerSimulation.js` |
| Generic fresh-state initialization seam | `js/stateLifecycleRegistry.js`, `js/stateCore.js` — no ledger-specific imports or fields in core |
| Default state participant/service composition | `js/stateComposition.js`, `js/bootstrap.js` |
| Historical roles/reference composition | `js/entityReferences.js`, `js/entityComposition.js` |
| Existing semantic producers | `js/ships.js`, `js/locations.js`, `js/itemActions.js`, `js/research/researchActions.js` |
| Trigger provenance forwarding | `js/effects.js`; current trigger call sites in `js/dialogue.js` and the action modules above |
| New focused tests and standalone effect-service fixture | `tests/worldLedger.test.mjs`, `tests/worldLedgerIntegration.test.mjs`, `tests/worldLedgerFixtures.mjs` |
| Registry/producer/rollback fixture adjustments | `tests/stateLifecycle.test.mjs`, `tests/simulationRegistry.test.mjs`, `tests/entityFixtures.mjs`, `tests/legacyState.mjs`, and existing ship/research/entity/effect tests where expectations change |
| Browser regressions | `tests/terminalTabs.browser.mjs` |
| Extension documentation | `ARCHITECTURE.md`, `README.md`, and this plan; project-wide save-version policy and implemented ownership/API contracts |
| Later actual Processing/Trading integration | Their new domain/catalog/state/action/simulation modules and tests; names determined with those systems |

Keep `runtime.js`, `simulationRegistry.js`, `save.js`, `eventBus.js`, `resources.js`,
`quantities.js`, `equipment.js`, `knowledge.js`, `stateV7.js`, and
`storageMigration.js` unchanged for ledger behavior. `state.js` needs no signature
change because it already forwards the lifecycle. Existing entity primitives
continue to support silent initialization/migration operations.

## 18. Non-goals and future extensions

Not included: Event Director, Event Bus replacement, notifications/subscriptions,
scheduled jobs, offline simulation, state reconstruction/replay, event sourcing,
full audit/history database, generic transaction log, NPC AI/memory, witness
inference, narrative generation/dialogue rules, semantic state diffing, generic
query language, persistent query indexes, or mandatory inspection UI.

Possible later extensions: importance-aware retention, explicit knowledge records,
participants/witnesses/communications, visit cursors and encounter facts, domain
reason-change events, stable machine identities, causal/correlation IDs, bounded
domain aggregation, and label/definition history. Each requires a concrete producer,
consumer, size policy, and save-compatibility decision.

Permanent existence, relationships, rewards/completions, finite reserves, active
jobs, event cooldowns, and lifetime statistics remain normal domain state. Recent
history helps the world be remembered and described; it does not control the world.

## Implementation results — 27 September 2026

The foundation and all current semantic producers are implemented. The descriptor
table is static and immutable; each append selects only its named capabilities.
Historical validation is shared by the bound writer and the lifecycle participant
and receives no catalog services. Persistent IDs retain strict type/existence/time
checks through terminal lifecycle states. No historical check compares a recorded
place, amount, health, or lifecycle transition against its present-world value.

Production `createEffectServices` requires semantic world operations. Effects
forward captured initiators but never append. Current item/dialogue/research/
inspection services use those wrappers. Direct gameplay transfers route through
`worldOperations.transferResources`; `transferBetweenLocations` and `moveExact`
are silent. Existing compatibility action factories accept optional trailing
ledger services; production supplies them explicitly, including research and ship
operations. Standalone consumers must bind these capabilities to obtain recording.

Bootstrap wraps the complete selected simulation manifest after custom composition.
This covers a custom step that appends and returns either `undefined` or a false
save request. Invalid output/report contracts and asynchronous returns still fail.
No ledger handling was added to runtime, the generic simulation runner, the save
module, the terminal bus, or low-level resource arithmetic. The fresh `initialize`
phase has only the ledger's empty-state participant; existing seeding and explicit
legacy migration implementations were preserved.

Verification completed:

- **248 unit tests passed**, including 25 new ledger and integration tests and the
  existing import graph, migration, state lifecycle, simulation, effects, storage,
  research, and entity regressions.
- **42 isolated browser tests passed**. New coverage checks missing-v8 defaulting,
  historical content IDs absent from catalogs surviving reload and another action,
  malformed historical identity preservation on rejected startup, exactly one
  reward creation/activation owner, causal research ordering, and failed reward
  rollback.
- Unit rollback checks cover execution, validation, and persistence failures after
  a full FIFO window, preserving the committed counter and evicted entries. Timed
  failures discard the whole frame and preserve the existing pause behavior.
- A seeded fresh state serialized to **6,706 JSON characters**. With 200
  representative direct-transfer records, its ledger serialized to **55,518**
  characters and the complete save to **62,199** characters. This is a measured
  fixture, not a browser quota guarantee or Processing activity forecast.

The 200-entry constant remains provisional. Actual Processing/Trading producers,
their new descriptors and transition tests, event-rate measurements, and narrative
consumers are deferred until those domains exist. No unsupported event types,
witness semantics, NPC knowledge, or generated prose were added in advance.
