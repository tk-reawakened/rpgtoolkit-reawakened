// The keyboard and focus layer ADR 0025 decision 7 says we must own, prototyped on dockview's MIT API.
// dockview 8.9.0 MIT already gives each tab strip roving focus (arrows, Home, End), Enter/Space to activate and
// Delete/Backspace to close with focus kept in the tab strip. What it lacks, and this adds:
//   F6 / Shift+F6            move focus to the next / previous group's active tab, in reading order (global)
//   Alt+Shift+Arrow          on a tab: move that panel to the adjacent group in that direction, or split towards it
//   Ctrl+Shift+Arrow         on a tab: grow (Right/Down) or shrink (Left/Up) that panel's group
//   Enter (second press)     on the active tab: move focus into the panel's first focusable control
//   Delete on the last tab   focus goes to the adjacent group's active tab instead of being lost
// Every change is announced in a polite live region. Only F6 is global; the other keys act only while a dock tab
// has focus, so they cannot collide with an editor (Monaco) that has focus.

const STEP = 48;
const directions = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
const positions = { left: "left", right: "right", up: "top", down: "bottom" };

export function installKeyboardLayer(getApi, root) {
  const status = document.createElement("div");
  status.id = "spike-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  document.body.append(status);
  const announce = (text) => {
    status.textContent = text;
  };

  const activeTab = (group) => group.element.querySelector('[role="tab"][aria-selected="true"]');
  const panelForTab = (tab) => getApi().panels.find((panel) => tab.contains(panel.view.tab.element));
  const readingOrder = () =>
    [...getApi().groups]
      .filter((group) => group.api.location.type === "grid" && group.panels.length > 0)
      .sort((a, b) => {
        const ra = a.element.getBoundingClientRect();
        const rb = b.element.getBoundingClientRect();
        return Math.abs(ra.top - rb.top) > 4 ? ra.top - rb.top : ra.left - rb.left;
      });
  const focusPanelTab = (panel) => {
    panel.api.setActive();
    const tab = activeTab(panel.group);
    if (tab) {
      tab.tabIndex = 0;
      tab.focus();
    }
  };

  // Focus after a close: dockview keeps it in the same tab strip; when the strip is gone, go to the nearest group.
  let lastFocusedGroup;
  root.addEventListener("focusin", (event) => {
    const tab = event.target.closest?.('[role="tab"]');
    const panel = tab && panelForTab(tab);
    if (panel) lastFocusedGroup = panel.group;
  });
  const restoreFocusAfterRemoval = () => {
    if (root.contains(document.activeElement) && document.activeElement !== root) return;
    const groups = readingOrder();
    const target = groups.find((group) => group === lastFocusedGroup) ?? groups[0];
    if (target?.activePanel) {
      focusPanelTab(target.activePanel);
      announce(`Focus moved to ${target.activePanel.title}`);
    }
  };

  document.addEventListener("keydown", (event) => {
    if (event.key !== "F6" || event.ctrlKey || event.altKey || event.metaKey) return;
    const groups = readingOrder();
    if (groups.length === 0) return;
    const current = groups.findIndex((group) => group.element.contains(document.activeElement));
    const next = current === -1 ? 0 : (current + (event.shiftKey ? groups.length - 1 : 1)) % groups.length;
    event.preventDefault();
    focusPanelTab(groups[next].activePanel);
    announce(`${groups[next].activePanel.title}, group ${next + 1} of ${groups.length}`);
  });

  root.addEventListener(
    "keydown",
    (event) => {
      const tab = event.target.closest?.('[role="tab"]');
      if (!tab) return;
      const panel = panelForTab(tab);
      if (!panel) return;
      const direction = directions[event.key];
      if (direction && event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        const api = getApi();
        const target = api.adjacentGroupInDirection(panel.group, direction);
        if (target) panel.api.moveTo({ group: target, position: "center" });
        else if (panel.group.panels.length > 1) panel.api.moveTo({ group: panel.group, position: positions[direction] });
        else return announce(`${panel.title} cannot move ${direction}`);
        focusPanelTab(panel);
        announce(`Moved ${panel.title} ${direction}`);
        return;
      }
      if (direction && event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        const horizontal = direction === "left" || direction === "right";
        const grow = direction === "right" || direction === "down" ? STEP : -STEP;
        const { width, height } = panel.group.api;
        panel.group.api.setSize(horizontal ? { width: width + grow } : { height: height + grow });
        const after = horizontal ? panel.group.api.width : panel.group.api.height;
        announce(`${panel.title} ${horizontal ? "width" : "height"} ${Math.round(after)} pixels`);
        return;
      }
      if (event.key === "Enter" && tab.getAttribute("aria-selected") === "true" && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const control = panel.view.content.element.querySelector("input, button, select, textarea, [tabindex]:not([tabindex='-1'])");
        if (control) {
          event.preventDefault();
          event.stopPropagation();
          control.focus();
        }
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") setTimeout(restoreFocusAfterRemoval, 0);
    },
    true,
  );
}
