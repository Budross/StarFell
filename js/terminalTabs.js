// Presentation-only navigation. Panels and their renderers remain mounted.
export default function terminalTabs({ tabList, panelContainer }) {
  if (!tabList || !panelContainer) throw new Error("Terminal tabs require a tab list and panel container.");
  const document = tabList.ownerDocument;
  const tabs = new Map();
  let activeId = null;
  tabList.setAttribute("role", "tablist");

  function registerTab({ id, label, panel, onActivate, onDeactivate }) {
    if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new Error("Tab IDs must start with a lowercase letter and contain only letters, numbers, or hyphens.");
    }
    if (tabs.has(id)) throw new Error(`Duplicate tab ID: ${id}`);
    if (typeof label !== "string" || !label.trim()) throw new Error(`Tab ${id} needs a label.`);
    if (!panel || panel.parentElement !== panelContainer) throw new Error(`Tab ${id} needs a panel directly inside its container.`);
    if ([...tabs.values()].some(tab => tab.panel === panel)) throw new Error("Panel is already registered.");
    for (const hook of [onActivate, onDeactivate]) {
      if (hook !== undefined && typeof hook !== "function") throw new Error("Tab hooks must be functions.");
    }
    const buttonId = `terminal-tab-${id}`;
    const panelId = panel.id || `terminal-panel-${id}`;
    if (document.getElementById(buttonId) || (document.getElementById(panelId) && document.getElementById(panelId) !== panel)) {
      throw new Error(`Tab ${id} would create duplicate DOM IDs.`);
    }
    const button = document.createElement("button");
    button.id = buttonId;
    button.type = "button";
    button.textContent = label.trim();
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", panelId);
    button.setAttribute("aria-selected", "false");
    button.tabIndex = -1;
    panel.id = panelId;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", buttonId);
    panel.tabIndex = 0;
    panel.hidden = true;
    tabs.set(id, { button, panel, onActivate, onDeactivate });
    button.addEventListener("click", () => activateTab(id));
    button.addEventListener("keydown", event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const ids = [...tabs.keys()];
      const index = ids.indexOf(id);
      const destination = {
        ArrowRight: ids[(index + 1) % ids.length],
        ArrowLeft: ids[(index - 1 + ids.length) % ids.length],
        Home: ids[0],
        End: ids[ids.length - 1]
      }[event.key];
      if (!destination) return;
      event.preventDefault();
      activateTab(destination);
      tabs.get(destination).button.focus({ preventScroll: true });
    });
    tabList.append(button);
  }

  function activateTab(id) {
    const next = tabs.get(id);
    if (!next) throw new Error(`Unknown terminal tab: ${id}`);
    if (activeId === id) return;
    const previous = tabs.get(activeId);
    const moveFocus = previous && (previous.panel.contains(document.activeElement) || previous.button === document.activeElement);
    // Let features capture scroll position before their panel loses layout.
    previous?.onDeactivate?.();
    if (previous) {
      previous.panel.hidden = true;
      previous.button.setAttribute("aria-selected", "false");
      previous.button.tabIndex = -1;
    }
    activeId = id;
    next.panel.hidden = false;
    next.button.setAttribute("aria-selected", "true");
    next.button.tabIndex = 0;
    if (moveFocus) next.button.focus({ preventScroll: true });
    // Scroll only the strip; scrollIntoView could move the whole mobile page.
    const stripBounds = tabList.getBoundingClientRect();
    const buttonBounds = next.button.getBoundingClientRect();
    if (buttonBounds.left < stripBounds.left) tabList.scrollLeft += buttonBounds.left - stripBounds.left;
    else if (buttonBounds.right > stripBounds.right) tabList.scrollLeft += buttonBounds.right - stripBounds.right;
    next.onActivate?.();
  }

  return { registerTab, activateTab, getActiveTabId: () => activeId };
}
