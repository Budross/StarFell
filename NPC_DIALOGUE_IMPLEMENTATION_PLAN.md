# NPC and dialogue systems — implementation plan

Status: implemented and verified on 2026-09-20. See [NPC_AUTHORING.md](NPC_AUTHORING.md)
and [DIALOGUE_AUTHORING.md](DIALOGUE_AUTHORING.md) for the implemented authoring schema.

This plan incorporates the confirmed decisions from the NPC/dialogue discussion.
It follows the existing location, ship, content, and synchronous action/save
systems. The user approved implementation of this plan, including the defaults
and UI proposal recorded below.

Review update: resolves the supplied review's seven edge cases concerning
relocation, presence, content reconciliation, targeted location flags, blocking
reasons, topic identity, and arrival notifications. Section 10 records the UI
design implemented in the People tab.

Implementation notes:

- Version-five saves hold NPC records, scoped dialogue history, and the active session. Every load reconciles content independently of version.
- peopleSystem.js composes the catalogs and supplies fresh context; domain modules remain independent of UI and persistence.
- The production demonstration adds Mira and Oren at Habitat 05. Oren's request is playable locally; Mira's relay request requires a ship supplied by future ship content. No starter vessel was added.
- The People tab, Operations shortcut, and talk/people presentation commands are implemented. The optional current-location map shortcut was not needed; map browsing remains unchanged.
- Profile selection supplies inspection without a separate saved action. Inventories remain private and exchanges remain deferred.
- Core verification: 70 unit tests pass, including 17 NPC/dialogue tests. Browser verification: 22 checks pass across the full existing suite and the added long-text check, using isolated saves and installed Chrome.
- Desktop, mobile, and departure screenshots were inspected; artifacts are in artifacts/npc-checks. Tests cover requests, stale replies, save failures, arrivals, reload/content recovery, keyboard controls, and long-text scrolling.

## 1. Goal and confirmed scope

Create two cooperating, independently authored systems:

- An NPC system defining identity, description, location, inventory, and available interactions.
- A dialogue system supplying reusable conversations through group IDs assigned to NPCs.

Both systems must remain easy to extend through content changes. Ordinary NPCs,
dialogue groups, conversations, and branches using supported behavior should not
require changes to runtime logic or display registration.

| Confirmed decision | Planned behavior |
| --- | --- |
| NPC movement | Fixed starting locations, with explicit scripted relocation. |
| Contact | Player and NPC must occupy the same site or ship. |
| NPC inventory | Define and persist inventories now; defer item exchanges. |
| Dialogue assignment | Assign groups to NPCs to supply granular, reusable dialogue. |
| Conversations | Support simple branching dialogue and conditions controlling availability. |
| Consequences | Support simple requests and lasting consequences through flags. |
| Modifiability | Make dialogue easy to edit and update in the game's content files. No external content-pack system is required. |

Outside the first implementation: autonomous NPC schedules/travel, remote
communications, trading, item delivery or rewards, personal player inventory,
relationship/reputation scores, a dedicated quest engine, combat, procedural NPC
spawning, external mod loading, and a general gameplay event engine.

## 2. Existing integration constraints

- Sites and ships are valid occupied locations; areas are containers, not occupied places.
- A ship retains its location ID while its saved area/docking state changes.
- Location inventories belong to locations. There is no personal player inventory.
- Location ownership controls asset management independently of public interactions.
- The action registry rechecks availability inside the supplied transaction.
- The application owns copy → execute → validate → save → commit. Feature logic must only mutate the candidate state.
- The current save version is four. Definitions remain separate from mutable saved state.
- Simulation advances while the page is visible, with no offline progress.
- The current event bus distributes terminal messages; it is not an authoritative gameplay trigger system.

Keep those behaviors intact. In particular, NPC dialogue must not grant access to
unowned cargo or equipment, introduce another save service, or use console text
as gameplay events.

## 3. NPC definitions and saved state

Authored NPC definitions contain a stable ID, display name, description, starting
site/ship ID, initial inventory, inventory capacities, initial NPC flags, supported
interaction IDs, dialogue group IDs, and optional presence, visibility, and
interaction conditions.

Separate general descriptive tags from dialogue group membership. A profession
tag does not silently grant mechanics. Assigning a merchant dialogue group, for
example, supplies speech but does not enable trading.

Saved state contains the NPC's current location ID, inventory quantities, and
NPC-specific boolean flags. Presence is derived from authored presence conditions
against saved flags; there is no separate mutable enabled/present boolean.
Omitted presence conditions mean present. Visibility controls whether a present
NPC is shown; interaction conditions control whether a shown NPC can be contacted.
An absent NPC retains its location and inventory without appearing there. A flag
effect can make an NPC disappear or return, using the existing effect vocabulary.
Initial NPC flags apply once with the initial NPC record; later content edits do
not overwrite saved flags. Dialogue history and active
conversation state belong to the dialogue system rather than being duplicated in
the NPC record.

The NPC's saved location is authoritative. Derive the list of NPCs at a site from
NPC state; do not also maintain a mutable resident list on each location. Keep
catalog indexes and resolved contexts transient.

Use the existing item catalog for inventory item IDs. Inventories hold ordinary
items with nonnegative whole quantities and validated, explicit capacity rules;
do not implicitly give NPCs site utility reserves or installed infrastructure.
Inventories remain separate from location cargo and private unless a future
interaction explicitly exposes them. Empty inventory is valid. No first-version
dialogue effect adds, removes, transfers, or consumes items.

Start with named NPC definitions. Reusable NPC templates can be introduced when
actual repeated authoring needs justify them; do not build a deep inheritance
system in advance.

## 4. Location presence and relocation

Local contact requires exact equality between the player's location ID and the
NPC's current location ID, plus presence and interaction checks. Being in the
same area, docked at the NPC's site, or viewing a location on the map does not
satisfy this requirement. Talking does not require ownership of the site.

An NPC assigned to a ship remains aboard as that ship moves. Ship movement does
not rewrite NPC location IDs. Existing ship travel remains player-operated;
independent NPC ship journeys are outside scope.

Scripted relocation is an explicit state-changing effect with a validated
destination site/ship ID. It represents an authored story transition, not a new
travel simulation. Authors must establish any narrative/access prerequisites in
the effect's triggering choice. Never relocate an NPC merely because a condition
is evaluated or a screen is rendered.

Reconcile active conversations within the same transaction as relocation,
player movement, or changes to NPC availability. If local contact is lost, end
the conversation cleanly while retaining already committed choices and flags.
Aboard-ship area movement alone does not break contact.

### Relocation and farewell ordering

A choice that relocates the current speaker must explicitly end the conversation,
must not have a destination node, and must supply closing text. The validator
checks this rule after group conversations are bound to possible speakers, as
well as for a direct current-speaker target. Treat even same-location speaker
relocation as terminal for predictable authoring. Moving another NPC may continue
the conversation if contact with the current speaker remains valid.

For a terminal relocation choice, resolve closing text in the pre-effect speaker
context; apply effects and explicit completion, clear the active conversation,
validate, save, and commit. Only then show the closing text in both the dialogue
panel and action feedback/Operations log. Retain the farewell as a presentation
receipt until the player dismisses it or selects another interaction. It is not
an active node with further choices. Do not automatically redirect to another tab
or erase the panel when the speaker leaves. Do not stage relocation for later
conversation exit: there is no second, deferred effect queue.

Flag changes can indirectly invalidate presence or contact. Authors should use
a terminal choice with closing text for an intentional disappearance. Because
not all indirect invalidations can be proven statically, reconcile after effects
at runtime too: close the session and show provided closing text or a neutral
contact-ended message. Never present an interactive next node for an absent NPC.
Failed saving displays no farewell or successful departure and retains the prior
session and speaker state.

## 5. Dialogue groups and composition

Store conversation definitions separately from groups. Groups reference stable
conversation IDs; NPCs reference stable group IDs. A personal group is simply a
group assigned to one NPC, not a special runtime mechanism.

Example composition for an engineer named Mira:

| Group | Content |
| --- | --- |
| generalResident | General questions about habitat life |
| engineer | Shared technical topics |
| habitatCrew | Habitat-specific knowledge |
| miraPersonal | Mira's introduction and personal request |

Recommended composition rules:

1. Group membership supplies an additive set of eligible conversations.
2. Deduplicate by conversation ID even when several groups reference it.
3. Evaluate each conversation's conditions for the current speaker and context.
4. Allow explicit NPC-level conversation exclusions for shared-content exceptions.
5. Treat distinct topics as additive; apply priority only to alternative versions of the same topic or greeting.
6. Resolve equal-priority alternatives deterministically by stable ID, and warn authors about potentially competing alternatives.
7. Never make group declaration order an implicit override rule.

Formal selection fields:

| Field | Contract |
| --- | --- |
| role | Required: greeting or topic. |
| topicId | Required for topic conversations; alternatives sharing it compete within the current speaker's supplied dialogue. Not used for greetings. |
| label | Required player-facing label for topic entries. |
| priority | Finite number, default zero; higher wins within one topic or the speaker's single greeting slot. |
| order | Finite presentation order for distinct topics, default zero; stable topic ID breaks ties. |

Filter candidates by visibility, repeat eligibility, and entry conditions before
selecting a winner. Requirements that deliberately disable a visible topic are
checked on the selected winner; a blocked high-priority variant must not silently
fall through to a lower-priority variant. Authors use entry conditions when a
fallback is intended. Priority never hides unrelated topic IDs. Once a topic is
started, keep its selected conversation ID until completion, interruption, or
explicit exit; changing flags must not swap the current passage to a different
variant mid-conversation.

Keep groups flat initially. Adding a shared topic requires editing its group;
changing its wording requires editing the conversation once. Both changes reach
all eligible speakers after reload without copying dialogue into NPC entries.

## 6. Conversations, nodes, and choices

Each conversation defines a stable ID, role, topicId/label where applicable,
entry node, entry conditions, visibility/requirements, priority, repeat policy,
and named nodes, using the selection contract in section 5.

Nodes contain speaker text and explicit choices or an explicit ending. Choices
contain stable IDs, player-facing text, optional visibility and requirement
conditions, an optional destination node, and a list of supported effects.
Allow links back to an existing node so authors can build topic menus without
duplicating passages. Require explicit completion separately from interruption
or choosing to leave.

Keep these meanings separate:

- Visibility: whether the player sees a topic or choice.
- Availability: whether a visible choice can be selected, with an authored or generated blocking reason.
- Effects: changes committed when that choice is successfully selected.

Render text as text, using a small validated set of substitutions such as the
speaker's name if needed. Content must not contain executable expressions or
arbitrary callbacks. Local text substitutions are not a localization framework.

Recommended first-version effect timing: attach authored gameplay effects to
choice selection. Starting a conversation and advancing nodes can record
dialogue progress, but rendering and restoring a saved node never apply effects.
Avoid implicit on-render or on-load effects.

Conversation entry conditions are checked when starting that conversation, not
used as ongoing contact requirements. Accepting a request may deliberately make
its offer ineligible without cancelling the remainder of the accepted branch.
Recheck NPC contact and the current choice's requirements on subsequent steps.
Once an end node is reached, show it until acknowledged; completion occurs once
on the committed transition into that explicit ending. A terminal choice with
closing text instead produces the receipt described in section 4.

## 7. Conditions, triggers, and flag-based requests

Extract the existing condition evaluation into a shared, UI-independent module,
preserving the current item/location condition syntax and behavior. Preserve
existing callers through a compatibility wrapper if useful during implementation.
Keep domain reference validation with the catalog/domain that owns those IDs.

Provide shared all/any/not composition and a bounded initial vocabulary:

- Existing location, discovery, global/local flag, equipment, and capability checks.
- Explicit true/false checks, with an unset boolean flag treated as false.
- NPC-specific flag checks, defaulting to the current speaker when explicitly documented.
- Whether the player has met an NPC or completed a specified conversation in its declared scope.

The condition context identifies the player location, speaker, NPC state, and
dialogue progress. Location checks use the current occupied location; NPC flags
use the named NPC. Because contact is local, speaker and player occupy the same
location during conversation. Keep the distinction explicit for future extensions.

### Targeted flags and blocking reasons

Add a concrete locationFlags condition field: an object mapping location IDs to
arrays of required-true flag keys. For the manifest example, the derelict entry
contains the flag key examined:manifest. All listed flags must be true. Use not
around a leaf condition for an unset/false check; each missing flag reads as false.
Keep localFlags as the existing shorthand for current-location flags.

Targeted checks read the requested location's saved flags from root state; they
must not read the player's current localFlags adapter or switch player context.
Validate each location ID at catalog compilation, with no requirement that the
player currently knows or can enter that location. Hidden story checks do not
grant travel, reveal location details, or expose private assets in the UI.

Flag keys are not location/entity IDs. In particular, accept existing generated
keys such as examined:manifest, whose colon is rejected by the current location
condition ID validator. Validate safe nonempty flag keys separately, preserving
generated inspection keys and rejecting unsafe property names. Keep compatible
rules for reading, writing, and saving these keys.

Separate condition truth from explanation generation. Define all as AND, any as
OR, and not as negation of one condition. Reject empty all/any lists, malformed
not operands, unknown operators, and excessive nesting at catalog compilation;
retain the existing empty legacy condition object as unconditional.

For player-visible requirements containing any or not, require a nonempty
authored blockedReason during content validation. Visibility-only conditions do
not need explanations. Preserve existing generated reasons for simple leaves;
all can use the first failing child's valid explanation unless overridden.
Never negate a positive requirement's generated sentence. A generic
"This option is not available right now" is the defensive runtime fallback for
an unexpected missing explanation, not permission for incomplete authored data.
Reasons must not disclose secret branch conditions.

Simple requests are authored as dialogue plus flags; they do not create a
separate quest journal or lifecycle engine. For example:

1. Mira asks the player to inspect the relay manifest.
2. Accepting sets an NPC-scoped requestAccepted flag.
3. The existing inspection outcome supplies a location flag that can be checked with an explicit location target.
4. Back at Mira's location, a report-back topic requires acceptance, the inspection flag, and an unset requestCompleted flag.
5. Reporting back sets requestCompleted and optionally a global story flag.
6. Later greetings or topics use those flags to reflect the outcome.

This example requires read-only checks of explicitly named locations' flags as
well as current-location flags. It does not require remote interaction or asset
access. Validate every explicit target reference. Decide in the authored request
whether investigation performed before acceptance is sufficient; the example
above permits it.

Allow alternative choices to set different flags for lasting consequences, such
as accepting or declining a request, promising help, or revealing information.
An ordinary flag check is not an event detector: it describes the current state.

First-version triggers mean conditional greetings, topics, and choices when the
player talks to an NPC. Reevaluate them after state changes and before execution.
Automatic interruptions, queued unsolicited conversations, timed barks, and
cooldowns are deferred recommended scope boundaries, not needed for these requests.

## 8. Effects and transaction safety

Provide a small validated effect vocabulary: set/clear a boolean flag in an
explicit global, location, or NPC scope; record a discovery; and relocate an NPC.
Dialogue completion is tracked by the dialogue runtime. Each domain owns the
operation that changes its state; the integration layer supplies those handlers
to dialogue rather than embedding ship, inventory, or future quest mechanics in it.

Execute a choice, all of its effects, its progress update, and any conversation
closure within one existing action transaction. Do not call executeAction from
inside an effect and create a nested save transaction. Failed validation or saving
must leave flags, position, conversation progress, and inventories unchanged.

Recheck NPC contact, active conversation identity, current node, choice validity,
and current requirements on every selection. Include a saved session/revision
token in submitted choices so a stale click or double submission cannot apply an
old choice again, including a choice that loops back to the same node.

The display sends identifiers, never trusted text or effect payloads. Resolve
effects from the validated catalog. Present outcome messages and navigate the UI
only after a successful commit.

Keep the action registry's current return contract of a synchronous string or
undefined. Terminal closing text is returned as that string; the application
uses the successful result for the visible dialogue receipt and terminal log.
Any presentation-only speaker snapshot is captured from trusted context and
published only after executeAction returns successfully. Do not start returning
structured objects from registered actions without a separate contract change.

Run contact reconciliation on candidate state after relevant actions and after
simulation advancement. If simulation closes or changes a saved conversation,
force validation and saving that frame before committing or displaying the
closure, just as ship arrival does. Read-only render functions never clear saved
sessions or trigger saves. An attempted action that throws commits nothing.

## 9. Memory, repetition, saving, and editing content

Default dialogue history to per NPC, so exhausting a shared introduction with one
engineer does not exhaust it for all engineers. Allow explicit global and
per-NPC-per-location completion scope where content requires it. The conversation
definition owns its repeat policy; group membership does not reset history.

Support repeatable conversations and once-completed conversations. Persist
completion and consequential choice history using stable IDs. Do not mark a
conversation completed solely because it was opened or interrupted.

Recommended default: save one active conversation with speaker, conversation,
node, bound contact location, and session/revision identifiers. Reload restores
the passage without replaying effects. Tab switching preserves it. Simulation
continues during dialogue and the existing no-offline-progress rule remains.

The active interaction has an explicit topic-menu, node, or ending phase.
Conversation/node identifiers are nullable only in the topic-menu phase. Starting
Talk creates the speaker session and starts the eligible greeting if any;
otherwise it opens the topic menu. A greeting ending returns to topics after
acknowledgment. The greeting is not rerun on every return to topics within the
same session. Each phase transition advances the revision token. Once-per-NPC-
per-location history uses the bound contact location captured at topic entry.

No eligible topics or no currently usable branch choices must leave an available
End conversation control. Display a neutral empty state, never invent a next
node or automatic completion. Returning to topics is an explicit exit from an
unfinished branch and retains already committed effects; it does not undo a
choice or mark that branch complete.

Add a new save version, expected to be five if no intervening feature changes it.
Initialize new NPC/dialogue state without changing existing location assets or
progress. Existing NPC records retain their saved location, inventory, and flags;
authored starting grants are applied only to newly introduced NPC records.

### Reconciliation on every load

Use this load order on a cloned save: validate basic structure and supported
version → perform version migrations → reconcile current content → reconcile
contact → strict full-state validation → save/commit through the existing startup
path. Run content reconciliation for current-version saves too, before any strict
check requiring every current NPC or a current active node. The existing loader
already calls migrateState on every load and reconciles location additions
outside version branches; extend that pattern rather than putting all NPC work
inside a saveVersion-less-than-five branch.

Content reconciliation initializes missing new NPCs once, adds newly introduced
item IDs with zero holdings where a dense inventory representation needs them,
and checks the active session against current NPC group assignments, exclusions,
conversation/node references, and structural requirements. A retired active
conversation/node, removed assignment, or incompatible active phase closes the
session with a notice and retains history. Saved choice history referring to
retired choices remains inert; it is not a reason to reset unrelated progress.

Do not rerun entry conditions on restored active topics: earlier choices may
legitimately have made those conditions false. Recheck contact and current choices
instead. Initialize defaults only for missing content records; do not silently
repair malformed existing records. Removing NPC IDs or violating inventory
constraints remains an explicit migration case, not a purge that loses assets.
Reconciliation is idempotent and side-effect-free outside the candidate; no new
starting grant, flag reset, or dialogue effect repeats on later loads. A failed
load or save preserves the previously stored save.

Normal wording, description, and label edits require no migration. Renaming a
display name must not change its ID. Branch edits should retain IDs for the same
semantic choice; a materially different consequence warrants a new ID.

Define content-update recovery separately from malformed-save handling. If an
otherwise valid active conversation references a retired node/choice, close it
with a notice and preserve completed history and consequences. Do not restart a
rewarding or consequential branch automatically. Renaming/removing NPC IDs or
changing saved inventory constraints requires an explicit migration. Retired
dialogue history may remain as inert stable-ID records. Invalid saves remain
preserved under the existing startup failure policy.

## 10. Actions and UI proposal

### Placement and entry points

Add a fourth terminal tab, People, after Operations, Workshop, and Locations,
using the existing terminalTabs controller. The tab remains available when no
NPCs are present and shows a clear empty state. Its content always refers to the
occupied site/ship, independent of the location selected in the map browser.

Add a compact People here count/link to Operations rather than duplicating a
large NPC list among directives. A current-location detail view in Locations may
offer the same shortcut; remote map selections must not reveal a live roster.
When a session is open off-tab, show a quiet Resume conversation link identifying
the speaker and an accessible active-session marker on People. Do not introduce
a remote contacts directory or unread-message system.

Opening People, browsing an NPC description, and expanding text are presentation
actions; they do not start conversations, set met flags, or save. The Talk button
starts the saved interaction. An optional reserved talk/people command is handled
as UI navigation before game-action resolution, with startup conflict checking;
do not force presentation-only navigation through a save transaction. Free-form
NPC-name parsing is deferred.

### Desktop layout

Within the existing CRT panel, use a narrow local roster on the left and a larger
profile/conversation area on the right, approximately 30/70 when space permits.
Use the panel's available width rather than viewport width to decide whether
both columns fit. Keep the current instrument bay and shared command bar.

Roster rows show the authored display name, optional short descriptive subtitle,
selection state, and an explicit busy/unavailable label when visible interaction
requirements fail. Use a stable authored order with ID tie-breaking. NPCs sharing
a name remain distinct by ID and descriptive context. Do not show inventory,
internal flags, group names, raw condition strings, or undiscovered identities.

Before Talk, the main area shows the NPC name, readable description, and available
interaction buttons. For the first version these are supported inspection and
Talk behavior; no disabled Trade/Quest/Reputation placeholders. An unavailable
Talk button has an adjacent human-readable reason.

During conversation, show a compact speaker/location header and End conversation
control, readable speech with the speaker's name, a scrollable record of this
open session's passages and player replies, and full-width choice buttons below
the current passage. Previous replies remain readable but cannot be clicked to
rewind. Render text immediately; no typewriter timing or automatic progression.

The topic menu shows resolved topic labels. Within a branch, show only the current
node's authored replies plus explicit Return to topics and End conversation
controls. Return to topics exits an unfinished branch without undoing effects or
marking completion. An ending passage has a Continue to topics control. A terminal
departure instead retains its farewell receipt with a Back to people control.

Only one NPC session is active. Browsing another profile does not replace it;
show Resume current conversation and require explicitly ending it before Talk
with someone else. No confirmation modal is needed. Profile browsing, tab
switching, and returning to the roster must never silently abandon dialogue.

### Mobile layout

Use one column when the CRT panel is too narrow for the roster plus readable
dialogue, initially around 640 CSS pixels of panel width and verified in browser
checks. First show the local roster; selecting an NPC opens the profile or active
conversation at full width. A labelled Back to people control changes the view
without ending the session. Keep a separate End conversation control.

Use wrapping choice text and touch targets at least 44 CSS pixels high. Prefer
one scrolling content area on narrow screens, with the session controls readily
reachable and no fixed overlay covering choices or the command input. Test with
long descriptions, many choices, text zoom, and the software keyboard.

### Lifecycle, notifications, and errors

| Event | UI behavior |
| --- | --- |
| Switch to Workshop/Locations | Preserve session, scroll, and current branch; show Resume conversation. |
| Reload with a valid saved session | Preserve the existing startup default of Operations; show Resume conversation, which restores the current passage and choices. Earlier presentation-only transcript entries need not return. |
| Ship arrives with a conversation active | Save arrival, update navigation status, and publish a nonblocking arrival notice/Operations message; do not switch tabs or move focus. Apply the same active-session guard to navigation-triggered tab changes while contact survives. |
| Player boards/disembarks away from speaker | Commit movement and session closure together; log contact ended. Explicit player navigation may retain its normal post-navigation tab behavior. |
| Speaker relocates/disappears through a choice | Show the committed farewell/closure receipt in place, with no further dialogue choices and no forced tab switch. |
| A requirement changes while reading | Keep the current passage and focus stable; update affected option availability and reason, then recheck on click. |
| No local people or no topics | Explain the empty state; keep navigation and End conversation usable as applicable. |
| Stale choice | Reject without effects; display a brief inline notice and refresh the current valid choices. |
| Save/action failure | Keep the previous passage and session, show the error beside the choices, and do not append a successful reply or receipt. |

Outside an active conversation, retain the existing arrival-tab behavior unless
a separate UI decision changes it. Implement the guard in app.js, which owns tab
navigation; ships.js stays unaware of dialogue presentation.

The session transcript, roster selection, scroll positions, and farewell receipt
are presentation state. Saved gameplay state owns the active phase and history
needed for consequences. Important outcomes, departures, and arrival messages
also appear in Operations. Avoid logging generic internal action names such as
selectDialogueChoice for every click; use committed authored messages for human
feedback while retaining the action/save transaction.

### Input and accessibility

Use a small set of saved interaction actions for starting a speaker session,
opening a topic, selecting a choice, returning to topics, acknowledging an ending,
and leaving. Parameterized actions carry IDs and revision tokens. Do not register
every node or choice as a permanent command or static location action. Global
dispatcher registration follows the navigation pattern but still enforces local
contact and session requirements on every execution.

Choices use ordinary Tab navigation and Enter/Space activation; do not assign
digits to dialogue replies or change the existing 1–3 directive meanings. Ignore
the application's global digit shortcuts when focus is inside the dialogue
interaction panel so typing a number while reading cannot accidentally salvage
or craft. Explicit commands typed in the shared command input keep their normal
meaning and go through normal reconciliation. Do not hijack Escape globally.

On an intentional transition, announce the new passage once and place focus at
its readable heading or choice group; preserve focus on routine simulation
updates and tab restoration. Never put the whole transcript in a repeatedly
updated live region. Blocked choices expose their disabled state and associated
reason accessibly. When a focused choice disappears, move focus to a stable
conversation control and announce the change. Preserve the terminal's existing
keyboard tab-navigation behavior and prevent duplicate announcements between
dialogue and global feedback. Follow current amber/green monospace styling with
comfortable line height, visible focus, and no dependence on color alone.

Keep panels mounted and update DOM only when relevant displayed values change.
Append committed transcript entries once, keyed by session/revision. Preserve
the reading position when reviewing earlier lines; autoscroll only when already
at the bottom or after the player's own deliberate reply. Browsing text must not
run conditions with side effects or change saved progress.

## 11. Module boundaries and authoring workflow

Proposed files, to be finalized during implementation:

| Module/document | Responsibility |
| --- | --- |
| js/npcContent.js | Authored NPC definitions |
| js/npcs.js | NPC catalog validation, initial state, derived presence queries, relocation, and inventory validation |
| js/dialogueContent.js | Authored groups and conversations, with explicit imports if later split by character/topic |
| js/dialogue.js | Catalog validation, composition, topic selection, transitions, and history |
| js/conditions.js | Shared condition evaluation/composition; domain checks supplied through explicit context/handlers |
| js/dialogueActions.js | Adapters to the existing action registry and domain effect handlers |
| js/dialogueDisplay.js | People tab, local roster/profiles, conversation presentation, transcript, and closure receipts |
| NPC_AUTHORING.md and DIALOGUE_AUTHORING.md | Exact supported fields, editable examples, scope rules, and troubleshooting |

Existing state.js integrates initialization, migration, and validation. Existing
app.js composes catalogs/services, actions, displays, and contact reconciliation
within its existing transaction and simulation boundaries. Location and ship
cores do not import dialogue content or own dialogue state.

index.html and style.css supply the People panel and responsive styling;
terminalTabs.js should need no feature-specific logic. app.js owns the arrival
tab guard, presentation command routing, and focus-aware directive shortcut
guard. Shared conditions support targeted flag reads without requiring changes
to the ship domain's navigation responsibilities.

Content is ordinary editable data in the existing JavaScript-module style.
Editing text or adding supported branches requires content changes and reload,
not new engine handlers. New kinds of gameplay effects require one deliberate,
reusable handler and its validation before content may use them.

Validate unknown groups, conversations, nodes, choices, targets, conditions, and
effect types; duplicate IDs; malformed quantities; and invalid initial placements.
Warn about unreachable nodes and branches without a usable exit. Error messages
should identify the NPC/conversation/node/choice involved. Provide a development
explanation of why a topic is excluded or blocked without exposing hidden topics
in the normal player UI. No external editor, package loader, or override system
is required.

## 12. Implementation sequence and acceptance criteria

1. Define the supported content schema and examples; establish validators and shared condition behavior without changing existing semantics.
2. Add NPC catalog/state, inventory validation, local presence, scripted relocation, and save migration.
3. Add group composition, conversation transitions, repeat scopes, flags/effects, and active-session persistence.
4. Integrate actions and contact reconciliation with the existing transaction; add the people/conversation display.
5. Add a small demonstration and authoring guides, then verify the complete flow and existing-system regressions.

Use two NPCs sharing a group and each having personal dialogue. Demonstrate a
conditional greeting, a branching request, acceptance/decline consequences,
investigation elsewhere, report-back completion, and scripted relocation. Use
test fixtures for ships and inaccessible locations; do not add a starter ship or
choose a ship-acquisition mechanic as part of this feature.

Acceptance checks:

- Adding a third NPC and a shared topic using supported behavior needs only content edits.
- Shared conversations deduplicate correctly, with deterministic topic/greeting selection and isolated NPC history.
- Same-area and dockside contact are rejected; same-site and same-ship contact work regardless of site ownership.
- NPCs aboard ships retain identity and location through area changes; separation ends conversations without losing committed outcomes.
- Conditions and scoped flags produce the intended accepted, declined, in-progress, and completed request branches.
- Unset flags, negation, all/any composition, and explicit remote-location flag reads have documented behavior.
- Hidden/blocked choices cannot be executed through stale or manually supplied identifiers.
- Double clicks, repeated choices, reload, and save failure do not duplicate consequences.
- NPC inventories remain separate, valid, and unchanged by dialogue; starting grants are not replayed.
- Existing saves migrate without losing resources, locations, discoveries, ship journeys, or flags.
- Wording edits display after reload; retired active dialogue references recover predictably without erasing history.
- Existing crafting, ownership, action commands, ship travel, and save rollback checks still pass.
- Browser checks cover keyboard/mobile use, tab persistence, live state changes, reload, and error presentation using isolated saves.

Additional review and UI acceptance cases:

- A speaker-relocation choice with a destination node is rejected at compilation; a valid terminal relocation displays its farewell after commit even though active dialogue becomes null.
- A relocation save failure preserves the speaker and prior node and emits no successful farewell; relocating a different NPC can continue normally.
- Presence is derived only from conditions, and flag-driven disappearance closes dialogue with a readable receipt.
- Current-version saves gain new NPCs and recover retired active nodes/assignments on every load, idempotently, while malformed existing records still fail safely.
- The exact generated examined:manifest flag at derelict unlocks report-back at habitat; a matching habitat flag alone does not.
- Missing targeted locations fail catalog validation, and generated colon-containing flag keys remain valid without weakening entity ID checks.
- Visible any/not requirements need authored blocking reasons, and negation never produces a backwards positive explanation.
- Same-topic alternatives compete by priority; distinct topics remain additive; a selected branch is not replaced when its own acceptance effect changes entry eligibility.
- A blocked high-priority variant stays blocked unless authored entry conditions select another variant; equal priorities resolve deterministically.
- Ship arrival during an active conversation saves progress and reports arrival without changing tab, focus, or passage; simulation-triggered contact loss is saved before being displayed.
- A no-choice state retains End conversation; explicit return/leave preserves effects without falsely completing the branch.
- Topic-menu, greeting, node, ending, and terminal-receipt UI states behave consistently across tab changes and reload, with no greeting/effect replay.
- Selecting another NPC profile or using Back to people does not abandon the session; new Talk requires ending the current session.
- Browsing People creates no save or met flag; starting Talk does. Remote map browsing exposes no roster or private inventory.
- Digit keys inside the dialogue panel do not invoke directives; shared explicit commands, terminal tab keys, and fixed directive meanings remain intact.
- Long dialogue and choices fit narrow panels and text zoom; routine rerenders preserve focus/scroll and do not duplicate transcript lines or announcements.
- Inline errors leave prior committed dialogue readable, and farewell receipts remain visible until dismissed or replaced deliberately.

Verification commands are node --test tests/*.test.mjs and, with Playwright
available to Node, node --test tests/terminalTabs.browser.mjs. The implementation
and focused regression checks described above have been completed.
