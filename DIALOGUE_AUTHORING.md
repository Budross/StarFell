# Authoring dialogue

Edit `dialogueDefinitions` in `js/dialogueContent.js`, then reload. Groups reference
conversations; NPCs reference groups. Supported branches/text need no UI or engine
edits. See [NPC_AUTHORING.md](NPC_AUTHORING.md) for NPC definitions.

## A complete personal topic

Add a group under `groups`:

```js
tessPersonal: { conversations: ["tessIntroduction"] }
```

Add this entry under `conversations`, and assign tessPersonal to Tess:

```js
tessIntroduction: {
  role: "topic", topicId: "personalIntroduction", label: "Ask about Tess",
  repeat: "once", scope: "npc", entryNode: "intro",
  nodes: {
    intro: {
      text: "I'm {speaker}. I used to maintain the collectors.",
      choices: [
        { id: "ask", text: "What stopped construction?", destinationNode: "answer" },
        { id: "thanks", text: "Good to meet you.", destinationNode: "goodbye" }
      ]
    },
    answer: { text: "The instructions stopped coming. Nobody told us why.", ending: true },
    goodbye: { text: "You too. Stay safe out there.", ending: true }
  }
}
```

Conversation/node/choice IDs start with a letter and contain letters, numbers,
underscores, or hyphens. Choice IDs must be unique within a node. Text is literal,
not HTML or executable expressions. `{speaker}` substitutes the current NPC name.

## Selection and progress

| Conversation field | Contract |
| --- | --- |
| role | Required greeting or topic. |
| topicId / label | Required for topics. Same-topic alternatives compete. Greetings omit topicId and compete for one greeting slot. |
| priority | Finite number, default zero; highest wins, then stable conversation ID. |
| order | Finite number, default zero; lower comes first, then topic ID. |
| entryConditions | Read-only eligibility filter checked on entry. |
| visibilityConditions | Read-only filter hiding the conversation. |
| requirements / blockedReason | Keep the selected topic visible but unavailable with an explanation. |
| repeat | repeatable (default) or once; once means completed, not merely opened. |
| scope | npc (default), global, or npcLocation; controls progress/history scope. |
| entryNode / nodes | Required starting node and node definitions. |

Groups form a deduplicated union followed by NPC exclusions. Group order never
sets priority. Filter entry/visibility/repeat eligibility, then choose a variant
per topic/greeting. A blocked high-priority topic stays blocked; it does not fall
through to a lower variant. Use entryConditions for intentional fallback.

An active branch retains its selected conversation even if accepting a request
makes its entryConditions false. Current choices and NPC contact are rechecked.
Talk starts an eligible greeting, or the topic menu. The greeting is not replayed
on every return to topics in the same session.

A node has required text and choices, or ending: true with no choices. Entering
an ending records completion once. Continue to topics acknowledges it. Restoring
an ending does not replay effects. Choices need id, text, destinationNode, and
optionally visibilityConditions, requirements, blockedReason, and effects.
Links can loop. A terminal choice instead has terminal: true, required closingText,
no destinationNode, and optionally complete: true.

Return to topics and End conversation preserve committed effects but do not
complete an unfinished branch. They remain available when all replies are hidden
or blocked. Effects execute only on a successfully saved choice.

## Conditions

Fields within one object combine with AND. Empty/omitted conditions pass.
Positive flag lists require every listed flag true; missing flags read as false.

| Field | Value/context |
| --- | --- |
| locations | Location ID list; player occupies any listed ID. |
| flags / localFlags | Required global flags / flags at the occupied location. |
| locationFlags | Map of explicit location IDs to required flag-key lists. |
| npcFlags | Map of NPC IDs (or speaker) to required flag-key lists. |
| discoveries | Required global discovery keys. |
| equipment / capabilities | Required active equipment/capabilities at the occupied location. |
| met | NPC IDs with whom the player has started Talk. Browsing does not count. |
| completed | Conversation IDs completed in their declared scope for this speaker/location. |
| all / any | Nonempty lists of child conditions, AND/OR respectively. |
| not | A single child condition, inverted. |

For example, a report-back topic can use:

```js
entryConditions: {
  all: [
    { npcFlags: { speaker: ["requestAccepted"] } },
    { not: { npcFlags: { speaker: ["requestCompleted"] } } }
  ]
},
requirements: { locationFlags: { derelict: ["examined:manifest"] } },
blockedReason: "Inspect the construction manifest at the derelict relay first."
```

The generated inspection key examined:manifest includes a colon. Flag keys allow
it; entity IDs do not. Target locations must exist. Targeted flag reads grant no
travel or asset access and expose no hidden location details. Requirements using
any/not need an authored blockedReason; visibility/entry filters need no reason.
Do not reveal secret outcomes in explanations. Simple leaves can use generated
reasons. Nesting is limited to 16 levels.

## Effects

These are the supported effects; all effects and dialogue progress save atomically:

```js
{ type: "setFlag", scope: "global", flag: "relayMysteryKnown", value: true }
{ type: "setFlag", scope: "npc", target: "speaker", flag: "requestAccepted", value: true }
{ type: "setFlag", scope: "location", target: "habitat", flag: "briefed", value: true }
{ type: "discover", id: "relayOrigin" }
{ type: "relocate", npcId: "speaker", destinationId: "derelict" }
{ type: "grantItem", itemId: "iron", amount: 1, destinationId: "current" }
{ type: "deactivateEntity", targetId: "speaker", reason: "Leaving duty" }
{ type: "activateEntity", targetId: "oren", reason: "Returning to duty" }
{ type: "activateLocation", targetId: "supplyPlatform" }
{ type: "spawnEntity", spec: { type: "npc", definitionId: "merchant", locationId: "current" } }
```

Use value: false to clear a flag. NPC targets can name a specific NPC; location
targets can use current. `current` is captured from the dialogue's source location
before the array begins; relocating the speaker never changes it. `speaker`
remains that same NPC for the entire array and is rejected outside dialogue.
Moving or deactivating the current speaker MUST use a terminal choice
with closingText and no destinationNode, even when targeting their explicit ID:

```js
{
  id: "meetLater", text: "I'll meet you there.", terminal: true, complete: true,
  closingText: "I'll arrange passage and meet you at the relay.",
  effects: [{ type: "relocate", npcId: "speaker", destinationId: "derelict" }]
}
```

The farewell remains visible after the move commits and is logged in Operations.
Relocation is an authored story transition, not simulated travel or a deferred
effect queue. Flag changes making the speaker absent also close the session;
provide closingText for intentional departure or a neutral closure is shown.
Moving a different NPC may continue if contact with the speaker survives.

`grantItem` creates cargo at an active site or ship; it never debits NPC inventory.
Omitting `destinationId` grants at `current`. Resource amounts are authored in m³;
components and products use whole counts. Capacity failure rolls back the whole
choice, including earlier effects, history, and revision. Products remain cargo;
utilities and NPC inventory grants are unsupported. `deactivateEntity` uses the
existing lifecycle blockers, preserves identity/assets, and does not force eviction.
The speaker's closing text and completion history survive successful deactivation.

Generic `discover` only grants shared knowledge; it does not run research rewards
or invent experimental progress. Unknown effect types and invalid fields are
rejected during compilation. Spawn specifications use authored quantities and
existing reusable definitions; see [ENTITY_AUTHORING.md](ENTITY_AUTHORING.md).
`current` and `speaker` also work in compatible spawn placement/authority fields.
The new entity joins normal runtime rosters after commit. Activating an entity
uses lifecycle checks and preserves its existing assets. Result bindings and
automatic event hooks remain deferred.

Item payments, trading, reputation scores, automatic interruptions,
cooldowns, and a quest journal are not implemented. Requests combine flags and
world outcomes, as demonstrated by Oren and Mira.

## Editing and troubleshooting

Keep IDs when changing wording. Use a new choice ID for a semantically different
consequence. Every load reconciles content: new NPCs initialize once; retired
active nodes/conversations/assignments close with notice while flags and history
survive. Removed NPC IDs or incompatible inventories require explicit migration.
Malformed saves are preserved and rejected, not silently reset.

The active session/passage and consequential history are saved. The on-screen
transcript is presentation state. Reload opens Operations with Resume conversation.
Rendering, tab activation, and reload never replay effects. Arrivals do not steal
the active tab during dialogue; leaving the speaker's location closes contact.

Catalog errors identify NPC/conversation/node context. Warnings cover unreachable
nodes, missing authored endings, and equal-priority variants. Development tools
and tests can call explainTopics(state, npcId, system) from dialogue.js to inspect
why supplied topics are hidden, completed, blocked, or outranked. This diagnostic
is not exposed to players. Tests in tests/dialogue.test.mjs demonstrate extensions,
requests, relocation, scoped history, and current-version content recovery.

Research can recognize ordinary NPC flags as one-time evidence during experiments.
The shipped `miraBenchAdvice` topic demonstrates this: its choice records `benchAdvice`,
and separately authored research rules read that fact. The existing `discover` effect
can also grant knowledge directly. See [RESEARCH_AUTHORING.md](RESEARCH_AUTHORING.md).
