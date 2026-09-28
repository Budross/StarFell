---
name: spacegame-item-authoring
description: Author or revise resources, components, products, recipes, and ingredient substitutions for the SpaceGameText / Habitat 05 game. Use when the user requests new item or crafting content, including supporting location assignments and research unlocks. Does not apply to unrelated software components, commercial products, or general game engine development.
---

# SpaceGame item authoring

Create content that players can obtain and use through the intended progression, with supported behavior and compatible saved progress. Honor the requested mode: brainstorming or planning produces a design; a request to add content implements it.

## Find the project and current contract

Locate the active game workspace using `CONTENT_AUTHORING.md`, `js/content.js`, and `js/itemCatalog.js`. Follow applicable project instructions. If the project is unavailable or multiple workspaces are ambiguous, ask for its location before dependent work. Do not assume the installed skill folder is the game workspace, hardcode a computer-specific path, or use `oldDONOTUSE` and unrelated demos as production examples.

Read `CONTENT_AUTHORING.md` and relevant current definitions. Confirm unusual behavior against implementation and tests; historical plans and this skill's baseline notes do not override newer implemented behavior. Identify documentation/code discrepancies rather than promising unverified effects.

Read [authoring-checklist.md](references/authoring-checklist.md) for category, recipe, substitution, equipment, and storage checks. Read relevant sections of [integration-and-compatibility.md](references/integration-and-compatibility.md) when acquisition, location access, unlocks, equipment, saved state, or validation is involved. Those references identify additional project guides to load only as needed.

## Clarify gameplay decisions

Before editing dependent content, distinguish explicit requirements, established project facts, low-impact assumptions, and missing gameplay decisions. Ask only questions whose answers matter and cannot be inferred from the request or prior conversation.

- Ask about unclear purpose/category, acquisition location and method, progression stage, recipe or substitution intent, balance tradeoffs, equipment effects, local/global completion, and replacement versus addition.
- Group a few focused questions, offer meaningful choices where useful, and explain them in gameplay terms. The user need not know internal IDs or schema names.
- Infer routine formatting and naming conventions from existing content. For unspecified costs, yields, capacities, or performance, ask about intended balance or propose a coherent design for review rather than silently choosing consequential numbers.
- If the user explicitly delegates design choices, choose reasonable values by comparison with existing content and report significant assumptions. Do not ask for every field.
- Continue independent inspection while waiting, but leave work depending on a required answer pending. Silence does not resolve a required choice.
- Reuse answers already supplied. Once necessary decisions are clear, proceed within the authorized request without another blanket confirmation.

For example, "Add titanium" calls for questions about its role and acquisition. A fully specified resource with a named gathering site and yield should proceed directly. "Make a machine that continuously refines ore" requires checking mechanic support and resolving scope, not adding an ignored field.

## Author the complete content path

1. **Inspect related content.** Identify existing IDs, roles, tags, capabilities, recipes, discoveries, commands, and locations relevant to the request. Find the closest working examples.
2. **Define intended behavior.** Form a compact design record covering purpose, category, acquisition, recipe/yield, substitutions, unlocks, storage, and equipment behavior as applicable. This can be an internal working record; do not create a separate document unless useful or requested.
3. **Check reachability and balance.** Trace acquisition through research/fabrication to actual use. Verify prerequisite producers, local facilities and ownership, usable storage, and fresh/existing-save routes. Expand role matches against existing recipes and account for rounded consumption. Compare costs/effects with existing content; identify unintended dominant substitutions, material-gain loops, and circular prerequisites.
4. **Implement supported content.** Author items in `definitions.items` in `js/content.js`, not generated catalog objects. Include necessary assignments at existing locations and research unlocks using existing systems when they follow from the request. Ask about unclear supporting design choices. Do not silently expand into new locations, ships, NPC stories, engine systems, or broad rebalancing. Unsupported mechanics require an explicit scope decision unless already authorized.
5. **Verify integration and compatibility.** Use the verification section of the integration reference. Catalog validity alone does not prove that an action is assigned, a discovery can be earned, or a player can reach the item. Keep transactions and saved progress intact.
6. **Deliver a concise result.** State what changed, how players obtain/use it, meaningful supporting changes, consequential assumptions, and actual validation results. Identify unresolved limitations. Never describe unsupported or unreachable behavior as implemented; deliberately deferred content must be labeled as such.

Keep game-facing descriptions consistent with actual effects. Preserve existing IDs, shortcuts, progression, and unrelated user changes. Update project authoring guidance only when correcting a demonstrated discrepancy or documenting a reusable new convention.
