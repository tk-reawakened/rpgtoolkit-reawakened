#!/usr/bin/env node
/** Candidate-only editor palette and WCAG 2.2 contrast utilities. Never imported by a shipped package. */
export const themes = Object.freeze({
  dark: Object.freeze({
    app: "#0d121d", panel: "#151e31", document: "#101722", elevated: "#202b40", stage: "#242424",
    text: "#f2eee4", muted: "#b4bed0", disabled: "#9ba6b9", border: "#596984", strongBorder: "#8291aa",
    accent: "#f4c85b", accentText: "#28200d", accentSubtle: "#493c20", focus: "#f4c85b",
    dirty: "#f4c85b", saving: "#83c9e8", saved: "#84c99b", error: "#ff8b95", warning: "#ffd17a", success: "#84c99b", info: "#83c9e8",
  }),
  light: Object.freeze({
    app: "#f3f5f8", panel: "#ffffff", document: "#ffffff", elevated: "#ffffff", stage: "#e8e8e8",
    text: "#202938", muted: "#4c5a6d", disabled: "#59677a", border: "#68778b", strongBorder: "#46566c",
    accent: "#805900", accentText: "#ffffff", accentSubtle: "#f5e8c5", focus: "#005fcc",
    dirty: "#805900", saving: "#005d83", saved: "#17632d", error: "#a30c2a", warning: "#654200", success: "#17632d", info: "#005d83",
  }),
  highContrast: Object.freeze({
    app: "#000000", panel: "#000000", document: "#000000", elevated: "#000000", stage: "#000000",
    text: "#ffffff", muted: "#ffffff", disabled: "#d0d0d0", border: "#ffffff", strongBorder: "#ffffff",
    accent: "#ffff00", accentText: "#000000", accentSubtle: "#222200", focus: "#00ffff",
    dirty: "#ffff00", saving: "#00ffff", saved: "#00ff00", error: "#ff8080", warning: "#ffff00", success: "#00ff00", info: "#00ffff",
  }),
});

const channels = (hex) => {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new TypeError(`Expected #RRGGBB, got ${hex}`);
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
};
const linear = (channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
export function luminance(hex) {
  const [r, g, b] = channels(hex).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrastRatio(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export const candidateStyles = `
:root {
  --tkr-bg-app: var(--design-app); --tkr-bg-panel: var(--design-panel); --tkr-bg-surface: var(--design-document);
  --tkr-bg-elevated: var(--design-elevated); --tkr-bg-stage: var(--design-stage); --tkr-bg-control: var(--design-panel);
  --tkr-bg-control-hover: var(--design-elevated); --tkr-fg-primary: var(--design-text); --tkr-fg-muted: var(--design-muted);
  --tkr-fg-disabled: var(--design-disabled); --tkr-border-subtle: var(--design-border); --tkr-border-strong: var(--design-strong-border);
  --tkr-accent: var(--design-accent); --tkr-accent-fg: var(--design-accent-text); --tkr-accent-subtle: var(--design-accent-subtle);
  --tkr-focus-ring: var(--design-focus); --tkr-dirty: var(--design-dirty); --tkr-danger: var(--design-error); --tkr-success: var(--design-success);
}
.tkr-web-body, .tkr-web-shell, .tkr-web-workspace { background: var(--design-app); color: var(--design-text); }
.tkr-web-topbar, .tkr-web-project-bar { background: var(--design-panel); color: var(--design-text); border-color: var(--design-border); }
.tkr-editor-pane { background: var(--design-document); color: var(--design-text); }
.tkr-web-body :where(button:not([style*="background"]), input:not([type="color"]):not([type="checkbox"]):not([type="radio"]), select, textarea):where(:not(.monaco-editor *)) {
  background: var(--design-panel) !important; color: var(--design-text) !important; border: 1px solid var(--design-strong-border) !important; min-block-size: 1.5rem; font-family: var(--tkr-font-sans); font-size: var(--tkr-text-sm);
}
.tkr-web-body input[readonly] { opacity: 1 !important; cursor: text; border-style: dashed !important; }
.tkr-web-body :where([aria-pressed="true"], [aria-selected="true"]):where(:not(.monaco-editor *)) { background: var(--design-accent) !important; color: var(--design-accent-text) !important; }
.tkr-web-body :where(button, input, select, textarea, [role="button"], [tabindex]):where(:not(.monaco-editor *)):focus-visible { outline: 2px solid var(--design-focus) !important; outline-offset: 2px; }
.tkr-web-body [aria-invalid="true"] { border-color: var(--design-error) !important; }
@media (forced-colors: active) {
  :root { --tkr-bg-stage: Canvas; }
  .tkr-web-body :where(button, input, select, textarea, [role="button"], [tabindex]):where(:not(.monaco-editor *)):focus-visible { outline: 2px solid Highlight !important; }
  .tkr-web-body :where([aria-pressed="true"], [aria-selected="true"]):where(:not(.monaco-editor *)) { border: 1px solid Highlight !important; }
}
`;

const rolePairs = [
  ["body text / document", "text", "document", 4.5], ["muted text / panel", "muted", "panel", 4.5],
  ["disabled text / panel", "disabled", "panel", 4.5], ["accent label / accent", "accentText", "accent", 4.5],
  ["error text / document", "error", "document", 4.5], ["warning text / document", "warning", "document", 4.5],
  ["success text / document", "success", "document", 4.5], ["info text / document", "info", "document", 4.5],
  ["control boundary / panel", "strongBorder", "panel", 3], ["focus / document", "focus", "document", 3],
  ["selection boundary / document", "accent", "document", 3],
];
export function auditPalette(palette) {
  return rolePairs.map(([role, foreground, background, minimum]) => {
    const ratio = contrastRatio(palette[foreground], palette[background]);
    return { role, foreground: palette[foreground], background: palette[background], minimum, ratio: Number(ratio.toFixed(2)), pass: ratio >= minimum };
  });
}
export function assertPalettesReadable(palettes = themes) {
  const failures = Object.entries(palettes).flatMap(([theme, palette]) => auditPalette(palette).filter((pair) => !pair.pass).map((pair) => ({ theme, ...pair })));
  if (failures.length) throw new Error(`Candidate palette contrast failure:\n${failures.map((item) => `  ${item.theme}: ${item.role} ${item.ratio}:1 < ${item.minimum}:1`).join("\n")}`);
  return Object.entries(palettes).flatMap(([theme, palette]) => auditPalette(palette).map((pair) => ({ theme, ...pair })));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const results = assertPalettesReadable();
  for (const { theme, role, ratio, minimum, pass } of results) console.log(`${pass ? "PASS" : "FAIL"} ${theme.padEnd(12)} ${role.padEnd(34)} ${ratio}:1 (min ${minimum}:1)`);
}
