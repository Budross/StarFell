# Adding and changing NPCs

See [ENTITY_AUTHORING.md](ENTITY_AUTHORING.md) for `spawn: false` NPC templates,
runtime creation, actor authority, and lifecycle. NPC instance IDs are separate
from definition IDs; dialogue sessions and histories reference the instance.

Add an entry to `npcDefinitions` in `js/npcContent.js`, then reload. No location
resident list, UI registration, or engine edits are needed for an NPC using the
supported interactions. See [DIALOGUE_AUTHORING.md](DIALOGUE_AUTHORING.md) for speech.

```js
tess: {
  name: "Tess",
  subtitle: "Collector technician",
  description: "Tess checks each recovered part against a handwritten list.",
  initialLocationId: "habitat",
  initialInventory: { scrap: 0.03 },
  inventoryCapacities: { scrap: 0.12 },
  initialFlags: {},
  interactions: ["inspect", "talk"],
  dialogueGroups: ["habitatCrew"],
  order: 30
}
```

This example uses an existing location, item, and group. To give Tess unique
speech, add a personal group and include its ID in dialogueGroups.

## Fields

NPC inventories remain private, independent per-item stores, not part of the site's
cargo pool. Raw authored quantities and private limits compile from m³ to integer
volume units; their version-six saved counts convert once during migration. No
NPC trade or discard access is introduced by volumetric storage. Lowering a private
NPC limit below its inventory still requires explicit compatibility handling.

| Field | Meaning |
| --- | --- |
| Object key | Stable ID: letter followed by letters, numbers, underscores, or hyphens. |
| name / description | Required display name and profile description. |
| initialLifecycle | Optional `active` (default) or `inactive`; applied only to newly seeded instances. Saved lifecycle is retained. |
| subtitle | Optional short description in the roster. |
| initialLocationId | Required site/ship ID. Areas cannot be occupied. |
| initialInventory | Item-to-quantity map, default empty. Raw resources use nonnegative m³; components/products use whole counts. |
| inventoryCapacities | Private per-item limits in the same authored units as inventory. Omitted items have zero capacity. |
| initialFlags | NPC boolean flags, default empty. Missing flags read as false. |
| interactions | inspect (profile browsing) and/or talk. Default both. |
| dialogueGroups | Additive list of existing group IDs, default empty. |
| excludeConversations | Conversation IDs to exclude after group expansion, default empty. |
| presenceConditions | Whether this NPC is present, default unconditional. |
| visibilityConditions | Whether a present NPC is shown, default unconditional. |
| interactionConditions | Requirements for talking to a visible NPC. |
| blockedReason | Explanation of failed interaction requirements; required for any/not. |
| order | Finite number, default zero. Lower roster order first; ID breaks ties. |

Inventories use ordinary item IDs, not power or installed equipment. They are
private, separately saved, and have no exchange interface yet. NPC cargo is not
site storage and cannot be used by crafting.

## Location and presence

Saved NPC state owns the current location. The roster is derived from it. Talk
requires exactly the same site/ship, independently of site ownership. Sharing
an area or being at a ship's dock is insufficient. NPCs aboard a ship retain
their location ID during travel. There are no autonomous schedules or journeys.

Presence is derived from conditions, not a second enabled boolean. For example:

```js
presenceConditions: { not: { npcFlags: { speaker: ["hiding"] } } }
```

Setting this NPC's hiding flag makes them absent while retaining location and
inventory. Clearing it allows them to reappear. In NPC checks, speaker identifies
that NPC even before Talk starts. Presence, visibility, and interaction checks
must be read-only.

## Saves and extension boundaries

Version-eight saves retain NPC identities separately from their NPC/dialogue state; version-five and later historical saves migrate explicitly. Older saves migrate, and
every load reconciles new content independently of version. Newly added NPCs
receive initial inventory/flags/location once. Inactive, destroyed, and retired identities are never respawned. Existing NPCs retain saved values;
editing initial values does not replenish or move them.

Definition names, descriptions, groups, and conditions update on reload. An instance-specific display name takes precedence; retired identities retain their historical label. Keep stable IDs
when editing display names. Move an existing NPC through a relocation effect.
Removing or renaming an NPC ID, or reducing capacity below saved holdings,
requires an explicit migration; invalid saves are preserved rather than reset.

New speech using supported behavior is a content edit. A new mechanic such as
trading needs a reusable handler, validation, and UI before content can use it.
Adding a merchant group does not implement trading. The NPC core has no DOM,
storage, timer, or event-bus dependency; resolve context from each fresh candidate.

Run `node --test tests/*.test.mjs` and, with Playwright available,
`node --test tests/terminalTabs.browser.mjs` for verification.
