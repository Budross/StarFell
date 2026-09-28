# Item authoring checks

Baseline: the game inspected on 2026-09-20. Reconfirm affected behavior in the current workspace before applying these rules to an evolved engine. Use `CONTENT_AUTHORING.md` for field examples and `js/itemCatalog.js`, `js/crafting.js`, `js/itemActions.js`, and `js/resources.js` for implementation. Do not copy the entire catalog into the skill.

## Identity, fields, and examples

- Author items in `definitions.items`; the key is the stable ID. IDs start with a letter and contain letters, digits, underscores, or hyphens. Reserved object keys and item/utility collisions are invalid. Also check duplicate JavaScript object keys, which can be overwritten before validation sees them.
- Required fields are `name`, `category`, and `baseCapacity`. Categories are `resource`, `component`, and `product`; optional fields belong only where supported. Unknown metadata may be ignored rather than rejected, so passing compilation is not proof that a field does something.
- Capacities, recipe/acquisition yields, input quantities, and role contributions must be positive safe integers. Cost rules vary: some maps allow positive finite fractions. Follow the specific validator instead of imposing integer rules on every amount.
- `initialQuantity` is catalog metadata; location `initialResources` supplies starting inventory. New items receive zero at existing sites, even if starting grants are authored. See integration checks before granting stock.
- Names may change without renaming IDs. Check player-visible commands as well as catalog IDs for collisions.

Useful existing patterns: `scrap` demonstrates gathered resources, `iron` demonstrates a discovery-gated component, and `solarPanel`/`radioAntenna` demonstrate products. `CONTENT_AUTHORING.md` also shows a resource contributing a recipe and a restricted substitute. Its illustrative discovery IDs are not necessarily shipped; locate or author a grant path instead of assuming those examples work unchanged.

## Categories and recipes

| Output/category | Allowed behavior |
| --- | --- |
| Resource | Gather/recover or grant at a location; cannot be a recipe output. May own a recipe contribution that produces another component/product. |
| Component | Recipes consume resources/components; may also be recovered. Can approve ingredient roles. |
| Product | Recipes consume components only; may also be recovered. May install, operate, maintain, or upgrade equipment. Cannot serve as a crafting ingredient. |

- Product items cannot be ordinary consumable acquisition/operation/maintenance costs. Installation consumes its product through its dedicated handler. Research may separately consume a stored product as a sample.
- Utilities such as power are separate from the three categories. Recipe `cost` accepts utilities only; physical ingredients go in `inputs`. Recipes cannot output power.
- Each recipe needs a local ID, name, and nonempty input slots. The compiled ID is `ownerId:recipeId`; a `recipeContributions` entry names its output explicitly, which can differ from the owner. Avoid collisions with both normal and contributed recipes on that owner.
- A slot needs its own unique local ID, positive integer quantity, and exactly one of `item` or `role`. Verify a structurally legal candidate exists and a usable candidate is obtainable at the intended progression stage.
- A recipe has one output item type and an integer batch amount. Timed queues, byproducts, multiple output types, continuous processing, prices, and quality inheritance are not implied by this schema. Check for newer handlers before classifying them as unsupported.
- Equipment is a condition, not a consumed ingredient. Keep common fabrication requirements intact; see integration checks.

## Ingredient substitutions

- Roles explicitly approve use; tags describe properties and filter candidates. Adding a tag alone does not authorize substitution. Exact-item slots do not accept alternatives.
- Role names are shared strings without a separate registry. Reuse intended names and exact tag spellings; `electrical`, `electronic`, and `conductive` are distinct.
- Consumption for a role slot is `ceil(slot.quantity / item.roles[role].units)`; units default to one. Calculate each slot separately and combine costs for repeated selected ingredients before affordability checks.
- One item type fills a slot. Excess contribution is not carried to another slot, and the player cannot mix types within a slot.
- A role's optional `recipes` allowlist uses compiled recipe IDs. Without it, approval affects every structurally matching role slot. Enumerate new matches to detect unintended recipe changes. Product recipes still reject raw resources even if those resources have the right role.
- Required tags all need to match; any excluded tag disqualifies the candidate. `defaultItem` must be legal under the complete matching rules.
- Recipe discovery and role approval discovery are independent. An exact-item slot does not inherit the conditions on that item's role approval.
- Explicit defaults remain selected when unaffordable or locked; the player chooses a substitute. With no explicit default, candidate order and current approval conditions influence selection. Use deliberate defaults when a standard ingredient matters.
- Ingredient tags, quality, and performance do not pass to the output. Different product performance needs a separate supported product/upgrade design.

## Installed products

- Installation requires a unique infrastructure `group`; consumes one stored product; and increments that local group. Optional `limit` caps its local count. Adding a healthy unit preserves aggregate working capacity when existing units are damaged.
- Positive `powerPerSecond` generates power; negative values drain it. Quantity and health scale power. Disabled groups do not operate. Empty power does not automatically disable capabilities, and the baseline engine has no fuel-driven shutdown or day/night cycle.
- Capabilities come from enabled, healthy, nonempty installed groups. Stored products do not supply them. A capability string alone has no effect unless a consuming system checks it.
- Operations require installation. Their supported effect is `setFlag`; omitted scope is global, while `scope: "local"` uses local flags. `once: true` checks that scope. Reusing a flag can unintentionally link operations. A repeatable paid action that only sets an already-true flag may offer no benefit.
- Maintenance entries target an infrastructure group, consume components, and restore full health; the target need not be the owning product's group. Verify this deliberately. Maintenance does not consume installed equipment and hides when unnecessary.
- Upgrades consume components and apply once per installed group. New units share its upgrades. Supported changes are power and travel speed; `powerBonus` is required even for speed-only upgrades (use zero). `travelSpeedBonus` is nonnegative. Arbitrary effects, individual-instance inventories, and uninstall/recovery are not implied.
- A product does not have to define every equipment field. Do not invent an installation effect merely because an item is categorized as a product.

## Costs, storage, and balance

- Full output storage blocks acquisition/crafting before payment. Capacity is checked after subtracting consumed inputs; recipes consuming their own output can therefore be legal at full storage.
- Check effective local capacity, including overrides and whether the complete output batch fits. Global catalog capacity alone is insufficient.
- Evaluate total input cost, utility costs, rounding, sample consumption, and useful output against comparable content. Detect unintended material-gain loops and substitutions that trivialize progression; explicitly requested generous balance is not a validation error.
- Keep side effects in the existing synchronous action transaction. Do not add external effects to handlers or bypass copy/execute/validate/save. Failed actions and saves must leave inventory and progress unchanged.
