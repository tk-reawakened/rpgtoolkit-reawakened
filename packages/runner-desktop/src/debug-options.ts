/** Per-run desktop display overrides (docs/spec/engine/display-input-audio.md#e-05). */
export type DesktopDebugOptions = {
  readonly drawVectorsFlags: number | null;
  readonly pathColor: { readonly r: number; readonly g: number; readonly b: number } | null;
  readonly forceFps: boolean;
  readonly diagnostics: boolean;
};

export function parseDesktopDebugOptions(argv: readonly string[]): DesktopDebugOptions {
  const names: Readonly<Record<string, number>> = { board: 1, sprite: 2, path: 4, destination: 8 };
  let flags = 0;
  let selected = false;
  for (const [argument, bit] of [["--debug-vectors", 1], ["--debug-sprites", 2], ["--debug-path", 4], ["--debug-destination", 8]] as const) {
    if (argv.includes(argument)) { flags |= bit; selected = true; }
  }
  let pathColor: DesktopDebugOptions["pathColor"] = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--debug") {
      const value = argv[++i];
      if (value === undefined || value === "") throw new Error("--debug requires a comma-separated overlay list");
      for (const name of value.split(",")) {
        const bit = Object.hasOwn(names, name) ? names[name] : undefined;
        if (bit === undefined) throw new Error(`Unknown --debug overlay: ${name}`);
        flags |= bit;
      }
      selected = true;
    } else if (argv[i] === "--debug-colour") {
      const value = argv[++i];
      if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error("--debug-colour requires #rrggbb");
      pathColor = { r: Number.parseInt(value.slice(1, 3), 16), g: Number.parseInt(value.slice(3, 5), 16), b: Number.parseInt(value.slice(5, 7), 16) };
    }
  }
  return { drawVectorsFlags: selected ? flags : null, pathColor, forceFps: argv.includes("--fps"), diagnostics: argv.includes("--diagnostics") };
}
