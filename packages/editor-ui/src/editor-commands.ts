import type { CommandRegistry, WorkbenchCommand } from "@tk-reawakened/editor-model";

const SURFACE = "[data-tkr-editor]";
const CONTROLS = "button, select, input[type=checkbox], input[type=radio], input[type=color], summary";

function available(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  for (let parent: HTMLElement | null = element; parent !== null; parent = parent.parentElement) {
    const computed = getComputedStyle(parent);
    if (computed.display === "none" || computed.visibility === "hidden") return false;
  }
  return true;
}

function disabled(element: HTMLElement): boolean {
  return element.matches(':disabled') || element.closest('[aria-disabled="true"]') !== null;
}

function nameOf(element: HTMLElement): string {
  const labelled = element.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "").join(" ");
  const labels = element instanceof HTMLInputElement || element instanceof HTMLSelectElement
    ? Array.from(element.labels ?? []).map((label) => label.textContent).join(" ") : "";
  return (labelled || element.getAttribute("aria-label") || labels || element.textContent || "").replace(/\s+/g, " ").trim();
}

/**
 * Adapt the focused editor's accessible controls to commands, preserving their single action handler.
 * Data cells and asset choices are not commands. A field command reveals/focuses its native picker.
 * docs/editor-features.md#focused-editor-actions
 */
export function connectEditorCommands(scope: HTMLElement, registry: CommandRegistry): () => void {
  let active: HTMLElement | null = null;
  let unregister = (): void => {};
  let previous: { element: HTMLElement; label: string; disabled: boolean; shortcut: string | null }[] = [];
  let sequence = 0;
  let initialized = false;
  const ids = new WeakMap<HTMLElement, number>();
  let disposed = false;

  const refresh = (): void => {
    if (disposed) return;
    if (active === null || !scope.contains(active) || !available(active)) {
      active = Array.from(scope.querySelectorAll<HTMLElement>(`.tkr-editor-slot ${SURFACE}`)).find(available) ?? null;
    }
    const root = active;
    const title = root?.getAttribute("data-tkr-editor") ?? "Editor";
    const next = root === null ? [] : Array.from(root.querySelectorAll<HTMLElement>(CONTROLS))
      .filter((element) => element.closest(SURFACE) === root
        && element.closest('[role=grid], [role=listbox], [role=tree], [data-editor-commands="exclude"]') === null
        && (element.hasAttribute("data-editor-save") || available(element)))
      .map((element) => ({ element, label: nameOf(element), disabled: disabled(element), shortcut: element.getAttribute("aria-keyshortcuts") }))
      .filter((entry) => entry.label !== "");
    if (initialized && next.length === previous.length && next.every((entry, i) => {
      const old = previous[i]!;
      return entry.element === old.element && entry.label === old.label && entry.disabled === old.disabled && entry.shortcut === old.shortcut;
    })) return;
    initialized = true;
    previous = next;
    unregister();
    const commands = next.map((entry): WorkbenchCommand => {
      const { element } = entry;
      if (!ids.has(element)) ids.set(element, ++sequence);
      const save = element.hasAttribute("data-editor-save");
      const field = element instanceof HTMLSelectElement || (element instanceof HTMLInputElement && element.type === "color");
      return {
        id: save ? "file.save" : `editor.action.${ids.get(element)}`,
        category: save ? "File" : "Edit",
        label: save ? "Save Active Document" : `${title}: ${field ? "Change " : ""}${entry.label}${field ? "…" : ""}`,
        disabled: entry.disabled,
        ...(save ? { shortcut: "Ctrl+S" } : entry.shortcut === null ? {} : { shortcut: entry.shortcut }),
        run: () => {
          // Commands captured before a focus/tab/state change can never act on a background document.
          if (disposed || active !== root || root === null || !scope.contains(root) || !root.contains(element) || !(save ? available(root) : available(element)) || disabled(element)) return;
          for (let parent = element.parentElement; parent !== null && parent !== root; parent = parent.parentElement) {
            if (parent instanceof HTMLDetailsElement) parent.open = true;
          }
          if (!save) element.focus();
          if (!field) element.click();
        },
      };
    });
    if (!commands.some((command) => command.id === "file.save")) commands.push({ id: "file.save", category: "File", label: "Save Active Document", shortcut: "Ctrl+S", disabled: true, run: () => {} });
    unregister = registry.registerMany(commands);
  };
  const onFocus = (event: Event): void => {
    const root = event.target instanceof Element ? event.target.closest<HTMLElement>(SURFACE) : null;
    if (root !== null && scope.contains(root)) { active = root; refresh(); }
    else if (event.target instanceof Element && event.target.closest('[role="tab"]')) { active = null; refresh(); }
  };
  scope.addEventListener("focusin", onFocus);
  scope.addEventListener("pointerdown", onFocus);
  const observer = new MutationObserver(refresh);
  observer.observe(scope, { subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ["disabled", "hidden", "inert", "aria-disabled", "aria-hidden", "aria-label", "aria-labelledby", "aria-keyshortcuts", "class", "style", "data-tkr-editor"] });
  refresh();
  return () => {
    disposed = true;
    observer.disconnect();
    scope.removeEventListener("focusin", onFocus);
    scope.removeEventListener("pointerdown", onFocus);
    unregister();
  };
}
