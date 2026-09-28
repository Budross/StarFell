# Item and crafting authoring skill plan

Status: proposed design, grounded in the current project on September 20, 2026. This document plans the skill; it does not install a skill or change game content.

## 1. Purpose and invocation

Proposed name: `spacegame-item-authoring`.

Proposed description: "Author resources, components, products, recipes, and ingredient substitutions for the SpaceGameText / Habitat 05 item and crafting system. Use when adding game item content, including the location and research content needed to make it usable."

Keep normal automatic selection enabled so requests such as "create a new resource," "add a conductor component," and "make a new generator product" select the skill. Also support explicit invocation as `$spacegame-item-authoring`. Scope it to this game's project; an unrelated request to create a software component or a commercial product should not activate it.

Respect the requested deliverable: a request to brainstorm or plan produces a design; a request to add content implements and verifies it. A planning request does not authorize implementation. Updating existing item content can reuse the workflow, with additional compatibility checks.

Success means content that behaves as described, is reachable in the intended progression, works with the relevant locations and research, and preserves existing progress. Valid catalog syntax alone is insufficient.

## 2. Clarification policy

Proposed default, subject to the user's preference: ask about missing gameplay decisions and infer routine naming, formatting, and established technical conventions. Necessary supporting content in existing systems belongs to the item task; unrelated feature development does not.

The skill should instruct the assistant to:

1. Inspect the prompt and relevant existing content before asking. Reuse decisions already provided in the conversation.
2. Separate explicit requirements, facts established by the project, low-impact assumptions, and unresolved design choices.
3. Ask a small, grouped set of questions when a missing choice changes gameplay, scope, balance, progression, or compatibility. Give concrete options and explain the material difference.
4. Continue independent discovery while waiting, but do not implement content that depends on an unanswered required decision. Silence is not acceptance.
5. Infer low-impact details from nearby examples and disclose consequential assumptions in the result. If the user explicitly delegates design decisions, choose suitable defaults and explain them rather than asking for every field.
6. Once the necessary decisions are supplied, proceed within the authorized task without an extra blanket approval step.

Questions are conditional, not a mandatory form for every item:

| Missing decision | Example clarification |
| --- | --- |
| Gameplay identity | Is this raw feedstock, a manufactured ingredient, or finished equipment? What should the player use it for? |
| Acquisition | Where should it be obtainable, through gathering, fabrication, recovery, or a starting grant? |
| Progression | Should it be available immediately, require existing knowledge, or introduce a new discovery? |
| Substitution | Should it replace the standard conductor everywhere, or only in particular recipes? |
| Balance | Should it be cheaper to make, more efficient per ingredient slot, or available earlier than the closest existing item? |
| Equipment | What should installation actually do: provide a capability, generate/consume power, improve ship speed, or enable a flag-setting operation? |
| Completion scope | Should an operation complete once for the whole game or separately at each location? |
| Compatibility | Is the request an additional item or a replacement for an existing saved item? |
| Unsupported behavior | Is a supported approximation acceptable, or is implementing the new mechanic part of the request? |

For example, "Add titanium" is too ambiguous to implement without establishing category, acquisition, and intended use. A complete specification should proceed without repeating those questions. Do not force the user to know internal field names or IDs.

## 3. Current sources of truth

Read relevant authoring guides, then confirm non-obvious behavior against the implementation and tests. Historical implementation plans explain intent but do not override current behavior. If documentation and code disagree, identify the discrepancy and avoid promising behavior that has not been verified.

| Concern | Project sources |
| --- | --- |
| Item definitions and supported fields | `CONTENT_AUTHORING.md`, `js/content.js`, `js/itemCatalog.js` |
| Matching, consumption, storage, generated actions | `js/crafting.js`, `js/itemActions.js`, `js/resources.js` |
| Conditions and their actual calling context | `js/conditions.js`, `js/locations.js`, `js/craftingDisplay.js` |
| Location assignment, ownership, local assets | `LOCATION_AUTHORING.md`, `js/locationContent.js`, `js/locations.js` |
| Research and discovery grants | `RESEARCH_AUTHORING.md`, `js/research/researchContent.js`, research catalog/engine/state modules |
| Equipment used by ships | `SHIP_AUTHORING.md`, `js/ships.js` |
| Dialogue grants and flags, if relevant | `DIALOGUE_AUTHORING.md`, dialogue content and handlers |
| State compatibility and transactions | `js/state.js`, `js/app.js`, `js/playerActions.js` |
| Behavioral examples and verification | `tests/crafting.test.mjs`, location, research, ship, player-action, and browser tests |

Find the active project from its files rather than embedding this computer's absolute workspace path in the skill. Check applicable project instructions. Ignore `oldDONOTUSE` and unrelated demo directories when deriving production behavior.

## 4. Authoring workflow

### A. Discover and define

- Inventory existing item IDs, categories, roles, tags, capabilities, recipes, discoveries, action commands, and relevant locations.
- Find the closest existing content to reuse conventions and compare balance.
- Resolve material questions using the policy above.
- Form a compact design record: purpose, category, acquisition, recipe/yield, approved substitutions, unlocks, storage, equipment behavior, and expected player path. Omit inapplicable fields.
- Identify the exact files that need to change. Existing mechanics should normally require content edits, not special-case engine or UI changes.

### B. Check progression and integration

- Trace the path from accessible material and facilities to acquisition, research, crafting, and intended use. Check an appropriate fresh-game route and the route for existing saves.
- Verify that every discovery and flag prerequisite has a real producer. A condition naming a discovery does not create a way to earn it.
- Check local ownership, action assignment, capacities, equipment, and the common fabrication capability as well as recipe-specific gates.
- Expand role substitutions against existing recipes. List which recipes gain a new eligible ingredient; unrestricted role approval may change more products than intended.
- Compare total input cost, rounding, yield, research sample consumption, power costs, and useful output against analogous items. Avoid accidentally dominant substitutions and unlimited material-gain loops. Deliberate generous balance is a design choice, not automatically an error.
- Report unmet prerequisites or unsupported mechanics before implementing dependent content. A deliberately future-facing item may remain unreachable only when that intent is explicit.

### C. Implement within the requested scope

- Add authored items to `definitions.items` in `js/content.js`; do not edit compiled catalog objects.
- Add required action assignments to existing locations and discoveries to research content when included in the agreed scope. Edit a location instance rather than a shared type unless the behavior is intended for every instance of that type.
- Keep descriptive text consistent with actual effects. Do not imply rarity rolls, superior output quality, damage resistance, fuel consumption, or other unimplemented behavior through names or tags.
- Preserve released IDs, command shortcuts, existing progression, and unrelated user changes.
- Do not add new locations, ships, NPC stories, engine systems, or broad balance changes merely to finish a loosely related item idea. Establish that scope when needed.
- Update authoring documentation only when the change introduces a reusable convention or exposes inaccurate guidance; do not duplicate the catalog in documentation.

### D. Validate and deliver

- Compile the catalog and generated actions, then validate the composed world, action scopes, research, and state where affected. A catalog-only check cannot detect all location or discovery problems.
- Run the existing unit suite once after the final changes: `node --test tests/*.test.mjs`. Investigate failures and distinguish pre-existing failures from regressions.
- Add focused behavioral coverage only when the change creates a meaningful new combination or risk. Reuse existing coverage for ordinary additions rather than adding tests that merely repeat field values.
- Exercise the relevant player path, including an unmet requirement and full output storage where appropriate. Test migration using a pre-change state fixture, not only a save generated after the addition.
- Use isolated browser saves for UI checks. Browser checks matter especially for new command combinations, unusual conditions, long names, and complicated choice lists; use the existing browser suite when available and relevant. Never clear the user's actual progress to test content.
- Report what was added, how players obtain and use it, supporting changes, significant assumptions, validation performed, and any unverified limitation. A blocked mechanic must not be presented as completed content.

## 5. Content rules and edge cases

### Identity and schema

- Item IDs start with a letter and contain letters, digits, `_`, or `-`; reserved object keys are forbidden. Check utility collisions, infrastructure-group collisions, generated action IDs, and accidental duplicate source object keys that JavaScript could silently overwrite.
- Names are player-facing; IDs are persistent references. Renaming a label is different from renaming an ID.
- Item capacities, recipe yields, acquisition yields, slot quantities, and role contributions are positive safe integers. Check field-specific rules: some ordinary cost maps accept positive finite numbers, so do not invent a universal integer-cost restriction.
- Starting quantities must fit capacities. Item `initialQuantity` does not grant stock at an existing or new location; location `initialResources` supplies starting stock.
- Avoid unknown fields even where a compiler ignores them. Passing validation does not mean an extra field has behavior.

### Categories and recipes

- Resources are not recipe outputs. A resource may contribute a recipe that outputs a component or product.
- Component recipes may consume resources and components. Product recipes may consume components only. Products cannot be crafting ingredients or ordinary consumable action costs.
- Acquisition can recover a resource, component, or product without changing its category.
- Utilities such as power are separate from item categories. Recipe `cost` is utility-only; ingredient consumption belongs in input slots.
- A recipe produces one item type. Multi-output recipes, byproducts, timed queues, trade pricing, fuel-processing machinery, and automatic quality inheritance require mechanics beyond the current schema.
- Recipes are identified as `ownerId:recipeId`, including contributed recipes. A contribution's owner is not necessarily its output.
- Inputs require exactly one of an exact item or an approved role. At least one structurally legal ingredient must exist, but also check that a usable ingredient is obtainable when the recipe should become usable.

### Substitutions

- Tags describe properties and filter candidates; roles explicitly approve substitutions. Exact-item slots never accept alternatives automatically.
- Existing role names and tag spellings matter. `electrical`, `electronic`, and `conductive` are different tags.
- Role contribution consumes `ceil(slot.quantity / role.units)` inventory units. Round each slot independently and aggregate costs for repeated ingredients before checking affordability.
- Only one item type fills each slot. Surplus role contribution is not carried into another slot, and different ingredients cannot jointly fill one slot.
- Recipe unlock and role approval unlock are separate. An explicitly fixed ingredient does not acquire the approval conditions attached to that item's role.
- Recipe restrictions on a role use fully qualified recipe IDs. Required/excluded tags and category rules still apply.
- An explicit `defaultItem` remains selected even when unavailable; the player must choose another approved option. Without an explicit default, candidate ordering can affect selection, so use a deliberate standard ingredient when stability matters.
- Ingredient properties do not change the resulting product's stats. Use a separately defined product or supported upgrade for a genuinely different result.

### Location and condition behavior

- Gathering actions require explicit location assignment and player ownership. A `locations` condition alone does not assign an action.
- Equipment/crafting collections can expose new generated actions at multiple sites and ships. Check inherited collections, removals, and unintended scope expansion.
- Costs, storage, equipment, and installation limits are local. Shared discoveries and global flags are not local inventories.
- Every recipe inherits `definitions.recipeCapabilities`, currently `fabrication`. Setting a recipe's own capability list to empty does not exempt it.
- Capabilities require installed, enabled equipment with positive count and health. A product in storage is insufficient; another site's equipment and passenger access do not grant ownership or local management rights.
- Recipes can be visible while equipment requirements block execution. Top-level equipment/capability gates are intentionally omitted from recipe-list visibility; nesting those gates can affect visibility differently and needs an explicit check.
- The shared condition validator supports more than the basic item guide lists. Item calls do not supply dialogue completion callbacks or a current speaker: `completed` and `npcFlags.speaker` cannot be assumed to work for items just because validation accepts them. Verify advanced conditions in the actual item context and use explicit, supported flags where appropriate.
- Action IDs are globally unique. Names, aliases, and shortcuts are checked after normalization at each effective location; mutually exclusive visibility conditions do not resolve a scope-level command collision. Preserve existing shortcuts 1-3.

### Research and reachability

- Reuse an existing discovery when appropriate; create a new one only when it represents the intended progression. Do not invent unearnable discovery IDs or auto-grant knowledge to conceal a missing route.
- Essential unlocks need sufficient reachable baseline evidence without random bonuses, accounting for repetition limits and consumed samples. Catalog warnings and structural checks are not a proof of playable reachability.
- Detect self-locks: knowledge requiring its own locked component, equipment requiring research available only on that equipment, and a repair chain needing power that cannot yet be generated.
- New tags can cause an item to satisfy existing research rules and affinities. Review those effects alongside recipe substitutions.
- Stored products can be consumed as research samples even though they cannot be crafting ingredients. Do not assume every product is immune to consumption or introduce an unsupported per-item exemption.
- Production currently grants no ship. A remote-only resource is not reachable merely because its destination exists; verify the necessary transport route without silently granting a ship.

### Products, operations, and storage

- Only products can define installation, operations, maintenance, and upgrades. A product may be recoverable or storable without having every equipment field.
- Installation consumes one product and creates/increments a unique infrastructure group. Limits apply per local group; adding units preserves aggregate working capacity rather than resetting existing damage.
- Positive power rates generate and negative rates drain reserves. Power exhaustion does not automatically disable capability providers; the current engine does not model fuel-driven shutdown or a day/night cycle.
- Operations currently set flags. An omitted effect scope is global; local scope makes completion independent per location. Reusing a flag can unintentionally link operations, and repeatable paid operations that only set an already-true flag may provide no further benefit.
- Maintenance consumes components and restores a target group's health. Its target need not be the product's own installation group; verify that target deliberately.
- Upgrades apply once per installed group, consume components, and change supported power/speed values. New units share existing group upgrades. `powerBonus` is still required for a speed-only upgrade; use zero when appropriate. Arbitrary per-instance upgrades and uninstall/recovery behavior are not implied.
- Full output storage blocks acquisition/crafting before payment. Capacity is checked after consumed inputs are subtracted, which matters for recipes consuming their own output item.
- Check per-location capacity overrides and whether an entire output batch can fit. A legal global capacity can still leave a recipe unusable at its intended site.
- Keep effects inside the existing copy/validate/save action transaction. Failed actions and saves must not consume materials or commit flags, upgrades, or discoveries.

### Existing saves

- New item IDs and installed groups start empty at existing sites. Changed initial grants do not refill those sites; newly introduced locations receive their own starting assets.
- Preserve stable item, recipe, slot, installation, upgrade, discovery, and action references where persisted or referenced by other content. Inspect selected recipes and saved ingredient choices when changing compatibility.
- Removal, renaming, category/role changes, and capacity reductions need a compatibility assessment; use explicit migration when old valid state would become invalid or change meaning.
- Research stores mechanical contracts for used discoveries. Altering thresholds, eligibility, or evidence mechanics can require coordinated migration; preserving the discovery ID alone is insufficient. New additive content and retirement should follow the research guide.
- Never resolve compatibility by resetting player progress, deleting saved research, or overwriting malformed saves.

## 6. Skill packaging and implementation phases

Use a small entry point with detail loaded as needed:

```text
spacegame-item-authoring/
  SKILL.md
  agents/openai.yaml
  references/
    authoring-checklist.md
    integration-and-compatibility.md
```

`SKILL.md` should contain invocation boundaries, source discovery, clarification policy, workflow, and links to the references. The first reference holds category, recipe, substitution, and equipment checks. The second covers locations, research, state compatibility, and verification. Point to maintained project guides rather than copying their entire schemas or the live catalog.

Keep examples few and useful: a gathered resource with a contributed recipe, a discovery-gated substitute component, and an installable product. Prefer current project examples; do not copy illustrative, unshipped discovery IDs as if they already exist.

Do not add scripts initially just to duplicate existing validators. If repeated use demonstrates a gap, add a small read-only audit that composes existing validators and reports missing integration; do not claim a static audit can prove balance or reachability.

Implementation sequence after this plan is accepted:

1. Incorporate the user's clarification and supporting-content preferences.
2. Create the skill using the skill-creator initializer, with only the resources above.
3. Write concise instructions and UI metadata; preserve automatic invocation.
4. Validate the skill using `quick_validate.py`; inspect links and remove all scaffold placeholders.
5. Exercise the behavioral scenarios below in isolated fixtures and revise demonstrated weaknesses.
6. Install the discoverable skill in `$CODEX_HOME/skills` (or `~/.codex/skills` if unset), subject to filesystem permissions, and verify the files at the installed location. Avoid hardcoding this workspace path in the skill.

## 7. Behavioral acceptance scenarios

These evaluate decisions and observable results, not matching exact generated wording.

| Scenario | Required outcome |
| --- | --- |
| "Add titanium" | Ask focused gameplay questions before dependent implementation. |
| Fully specified gathered resource | Add the item and intended location action; acquisition works and respects capacity/ownership. |
| New conductor with two role units | Correct per-slot rounding, intended substitutions only, usable unlock, no duplicated inventory spending. |
| Resource contributing an alternate recipe | Correct owner-qualified ID, valid non-resource output, preserved existing recipe. |
| New generator with operation and upgrade | Installation, local power, flag scope, limits, and group upgrade behavior match the request. |
| Product assembled from raw ore | Explain the category constraint and resolve the component stage; do not silently relabel ore. |
| Continuous ore processor or multi-output recipe | Identify unsupported behavior and resolve scope; do not add inert fields. |
| New research-gated material | Demonstrate a reachable unlock without luck or circular equipment requirements. |
| Resource only at a remote unowned site | Surface ownership and transport constraints before claiming it is playable. |
| Duplicate alias or a dialogue-only condition | Catch integration failure beyond the catalog compiler. |
| Addition loaded into a pre-change save | Preserve holdings, damage, selected content, and research; new assets remain empty at existing sites. |
| "Design three products, but don't edit files" | Produce only the requested designs and questions. |
| "Create a React component" in an unrelated project | Do not route into this game-content skill. |

Completion criteria: correct invocation, focused clarification, supported behavior, complete intended integration, proportionate verification, and honest reporting of unresolved decisions or unsupported mechanics.
