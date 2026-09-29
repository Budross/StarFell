import { getActions as legacyGetActions } from "./playerActions.js";

export default function playerActionsDisplay(onSelect, selector = "#player-actions", getActions = legacyGetActions) {
  const container = document.querySelector(selector);
  const help = document.querySelector("#command-help");
  const buttons = new Map();
  let selectedGathering = null;
  let repeating = false;
  if (!container) throw new Error(`Action display target not found: ${selector}`);

  container.addEventListener("click", event => {
    const button = event.target.closest("[data-action]");
    if (button && container.contains(button) && !button.disabled) onSelect(button.dataset.action, true);
  });

  function updateRepeatState() {
    for (const [id, button] of buttons) {
      const selected = id === selectedGathering && !button.disabled;
      button.classList.toggle("repeat-ready", selected);
      button.classList.toggle("repeating", selected && repeating);
      if (button.dataset.gathering) button.setAttribute("aria-pressed", String(selected && repeating));
    }
  }

  function renderActions() {
    const visible = getActions("directives").filter(action => action.visible);
    const visibleIds = new Set(visible.map(action => action.id));
    for (const [id, button] of buttons) {
      if (!visibleIds.has(id)) {
        if (button === document.activeElement) container.focus();
        button.remove();
        buttons.delete(id);
      }
    }

    visible.forEach((action, index) => {
      let button = buttons.get(action.id);
      if (!button) {
        button = document.createElement("button");
        button.type = "button";
        button.dataset.action = action.id;
        const hotkey = document.createElement("span");
        hotkey.className = "hotkey";
        button.append(hotkey, document.createElement("span"), document.createElement("small"));
        buttons.set(action.id, button);
      }
      // Preserve button identity and keyboard focus across animation frames.
      if (container.children[index] !== button) container.insertBefore(button, container.children[index] ?? null);
      const texts = [action.shortcut ? `[${action.shortcut}]` : "", action.name,
        action.reason || action.description];
      texts.forEach((text, i) => {
        if (button.children[i].textContent !== text) button.children[i].textContent = text;
      });
      button.disabled = !action.available;
      button.title = action.reason || action.description || action.name;
      if (action.gathering) button.dataset.gathering = "true";
      else delete button.dataset.gathering;
    });
    updateRepeatState();

    if (help) {
      const text = visible.length
        ? visible.map(action => `${action.shortcut ? `[${action.shortcut}] ` : ""}${action.name.toLowerCase()}`).join(" / ")
        : "No directives available here.";
      if (help.textContent !== text) help.textContent = text;
    }
  }
  renderActions.setRepeatState = (actionId, active) => {
    selectedGathering = actionId;
    repeating = active;
    updateRepeatState();
  };
  return renderActions;
}
