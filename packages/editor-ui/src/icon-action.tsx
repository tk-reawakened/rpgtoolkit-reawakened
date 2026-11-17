import type { JSX } from "preact";
import { useState } from "preact/hooks";

// Original, currentColor line icons; no font, image asset or third-party dependency.
const PATHS = {
  draw: "m4 16-1 5 5-1L20 8l-4-4Z M14 6l4 4",
  select: "M4 9V4h5 M15 4h5v5 M20 15v5h-5 M9 20H4v-5",
  flood: "m4 11 7-7 8 8-7 7Z M8 3l8 8 M4 21h12 M20 15s-2 3-2 4a2 2 0 0 0 4 0c0-1-2-4-2-4",
  erase: "m3 15 10-11 8 7-9 10H8Z M8 10l8 7 M12 21h9",
  rectangle: "M4 5h16v14H4Z",
  dropper: "m14 3 7 7 M17 6l-3 3 M13 8 4 17l-1 4 4-1 9-9Z",
  scroll: "M8 12V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v9c0 4-3 6-6 6h-2c-2 0-3-1-4-3l-4-6a2 2 0 0 1 3-2l1 2",
  zoom: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6 M7 10h6 M10 7v6",
  undo: "m8 4-5 5 5 5 M3 9h11a6 6 0 0 1 0 12h-3",
  redo: "m16 4 5 5-5 5 M21 9H10a6 6 0 0 0 0 12h3",
  minus: "M5 12h14",
  plus: "M5 12h14 M12 5v14",
  grid: "M3 3h18v18H3Z M9 3v18 M15 3v18 M3 9h18 M3 15h18",
  save: "M4 3h13l4 4v14H3V3Z M7 3v7h10V3 M7 21v-7h10v7",
} as const;

type IconActionProps = JSX.IntrinsicElements["button"] & {
  readonly icon: keyof typeof PATHS;
  readonly label: string;
  readonly shortcut?: string;
}

export function IconAction({ icon, label, shortcut, ...props }: IconActionProps) {
  const [dismissed, setDismissed] = useState(false);
  const tooltip = shortcut === undefined ? label : `${label} (${shortcut})`;
  return <span class="tkr-icon-action" onPointerEnter={() => setDismissed(false)} onFocusIn={() => setDismissed(false)}
    onKeyDown={(event) => { if (event.key === "Escape") setDismissed(true); }}>
    <button {...props} type="button" aria-label={label} aria-keyshortcuts={shortcut} title={tooltip}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d={PATHS[icon]} /></svg>
    </button>
    <span class="tkr-action-tooltip" role="tooltip" hidden={dismissed}>{tooltip}</span>
  </span>;
}
