# CRT tabs implementation plan

Status: implemented. The sections below retain the design and acceptance criteria.
The existing 25 gameplay checks and the browser suite pass. See README for tab
registration and verification instructions.

## Goal and agreed layout

Add navigation inside the CRT screen. The user confirmed that Material Storage and
Fabrication & Assembly should share one **Workshop** tab. Start with two tabs:

- **Operations** (default): the existing session log and Available Directives.
- **Workshop**: Material Storage and Fabrication & Assembly, with inventory beside
  crafting when space allows and stacked above it on narrow screens.

Place the tab strip at the top of the CRT. Keep the command input, command help,
and a compact latest-result/status area below the tab content so commands and
their feedback remain accessible from either tab. Available Directives belongs
to Operations; it does not consume Workshop space.

Keep Power Reserve, Power Flow, and Installed Systems in the right-hand instrument
bay. Preserve the outer console, CRT appearance, telemetry, and existing shortcuts.

## Architecture decision

**Add a small `js/terminalTabs.js` module and extend the existing display modules
only where the new layout requires it.**

| Option | Assessment |
| --- | --- |
| Put all tab behavior in `app.js` | Fewest files, but adds navigation and accessibility rules to a file already handling startup, simulation rendering, actions, and saving. |
| Add tabs to `craftingDisplay.js` or `consoleDisplay.js` | Couples general navigation to one feature and makes future systems depend on an unrelated display. |
| Add `terminalTabs.js` | Recommended: one reusable owner for navigation, independent of game mechanics and individual feature displays. |

`craftingDisplay.js` already renders both inventory and fabrication using stable
element IDs. Move those existing elements into Workshop and retain the renderer.
A separate inventory or Workshop module is unnecessary for this first change.
Future systems can own their own displays without changing the tab controller.

## Tab registration contract

Create one controller for the CRT's tab strip and panel container. Its small public
interface should support:

- `registerTab({ id, label, panel, onActivate?, onDeactivate? })`: register an
  existing panel element and create its tab button. Registration order determines
  display order. Hooks are optional presentation callbacks.
- `activateTab(id)`: switch the selected panel without recreating it.
- `getActiveTabId()`: inspect the current selection.

Use stable IDs such as `operations` and `workshop`. Validate duplicate IDs, repeated
panel elements, empty labels, and panels outside the controller's panel container.
Reject an unknown activation without changing the active tab. Explicitly activate
Operations after startup registration.

The controller owns tab buttons, active state, panel visibility, keyboard behavior,
and focus safety. Feature modules own their panel markup, event handlers, and
rendering. `app.js` constructs the controller and registers the initial panels.

Future-system integration consists of creating a panel, initializing its display,
registering it once, and connecting its state rendering in `app.js` as needed.
No edits to `terminalTabs.js` should be required. This is explicit startup
registration; runtime removal, unlock rules, lazy loading, routing, and plugin
discovery can wait for an actual feature that needs them.

## Interaction and state

- Keep registered panels mounted and hide inactive panels with `hidden`. Include
  a scoped CSS rule that ensures layout styles cannot override hidden panels.
- Preserve recipe choices, ingredient controls, command text, and each panel's
  scroll position when switching. Avoid rebuilding panel DOM on activation.
- Keep the active tab in UI memory and reopen Operations on reload. Tab selection
  is not a game action and does not require save-schema changes or a save write.
- Continue the existing game/render loop while Workshop is selected. An inactive
  CRT panel is different from a hidden browser page; existing browser-visibility
  pause behavior remains in effect.
- Continue rendering inventory and crafting while hidden for the initial small
  UI. Defer rendering optimizations until their cost is demonstrated.
- Keep commands and shortcuts using the existing action registry and transaction.
  Do not add numeric tab shortcuts that conflict with directives 1–9.
- Extend the existing feedback path to update the shared status area as well as
  the session log. Craft success, unavailable actions, and save errors must be
  visible from Workshop without automatically changing tabs.
- Keep the console's event subscription active while Operations is hidden. Adapt
  its scroll handling to remember whether the player was following the newest
  entry before hiding; hidden-element measurements must not reset that decision.
  On return, follow new entries only if the player was already at the bottom.
  Continue the existing 100-entry limit, preserving the reading position where
  possible when older entries are trimmed.

## Accessibility and layout

Use linked `tablist`, `tab`, and `tabpanel` semantics, unique DOM IDs,
`aria-controls`, `aria-labelledby`, and `aria-selected`. Only the selected tab
button participates in the normal Tab sequence. Left/Right arrows cycle through
tabs and activate them; Home/End select the first/last tab. Bind these keys to the
tab strip so inputs and recipe selectors retain their normal behavior.

Keep focus on the selected tab during keyboard navigation. If programmatic
navigation would hide the currently focused control, move focus to the newly
selected tab. Hidden panels must not retain keyboard-accessible descendants.
Provide visible focus and selected states beyond color alone.

Use a CRT grid with rows for the tab strip, a shrinking content area, and the
shared command area. Preserve internal scrolling with `min-height: 0` and
`min-width: 0` where required. Operations retains its log/directive scroll areas;
Workshop gets a scrollable content area. Allow the tab strip to scroll horizontally
as future tabs are added, and bring the selected tab into view.

Check desktop, short viewports, and the existing 850px/520px responsive breakpoints.
The added navigation must not clip the command input or crafting controls.

## File changes and implementation order

1. **Resolve the current render blocker.** `app.js` queries `.constraint-banner`,
   `.constraint-heading`, `.constraint-symbol`, `#bottleneck`, and
   `#repair-requirement`, but these elements are absent from `index.html`.
   Unconditional writes can stop the first render before the animation loop starts.
   Remove stale display wiring for these removed elements; use the existing
   header/instrument status and shared status area for relevant feedback. Ensure
   load failures display a message without writing to the missing `#bottleneck`,
   replacing the original error, or overwriting the stored save.
2. **Add `terminalTabs.js`.** Implement registration, activation, visibility,
   keyboard handling, focus safety, and optional presentation hooks.
3. **Restructure `index.html`.** Add the strip and Operations/Workshop panels, move
   the existing storage and fabrication elements intact, and separate the shared
   command form/help from the Operations-only directive list. Keep unique IDs.
4. **Wire `app.js` and adapt `consoleDisplay.js`.** Register tabs once, retain the
   existing crafting/actions renderers and action transaction, provide shared
   feedback, and connect log visibility/scroll hooks. Keep display initialization
   independent from tab activation so no duplicate listeners are created.
5. **Update `style.css`.** Add tab/focus styles, panel sizing, shared command-area
   styling, Workshop columns, and responsive rules. Adapt the existing
   `.command-zone` height/overflow rules to its new responsibilities.
6. **Verify and document.** Add focused tab-behavior checks, run existing gameplay
   tests, perform browser checks, and update README module boundaries and play
   instructions with the Workshop location and future-tab registration example.

No changes to crafting rules, the item catalog, simulation, or saved game format
are required by the tab feature.

## Acceptance checks

- Startup opens Operations; Workshop contains exactly one inventory and one
  fabrication panel. Neither panel remains duplicated in the instrument bay.
- Mouse and keyboard activation show exactly one panel with correct selected/focus
  state; hidden controls cannot receive focus through normal navigation.
- Repeated switching retains recipe/ingredient selections and scroll position,
  does not duplicate listeners, and does not execute or save a game action.
- Salvaging, refining, repairing, fabricating, assembling, and installing still use
  the existing action path. Quantities and requirements stay current across tabs.
- Feedback and errors are readable in Workshop. Returning to Operations shows
  messages received while hidden with appropriate scroll behavior.
- Simulation continues in either CRT tab and pauses when the browser page is
  hidden. Existing saves load without migration, and failed loads preserve saves.
- A test-only third panel can be registered and navigated without changing the
  controller or crafting display. Duplicate/invalid registrations fail clearly.
- Desktop and mobile layouts keep the tab strip, command input, and all Workshop
  controls reachable, including with a long inventory and additional tab labels.
- Existing `node --test tests/*.test.mjs` checks pass. Use focused DOM/browser
  checks for navigation, focus, hidden panels, and third-panel integration;
  gameplay unit tests alone do not verify these UI behaviors.
