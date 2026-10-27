// Minimal, module-only declarations for the Node environment the core tests
// run in. core's own tsconfig keeps `types: []` and no host globals (G2); this
// file is only seen by tsconfig.test.json and declares no ambient value globals
// beyond `process`.
declare module "node:fs" {
  export function readdirSync(path: string): string[];
  export function readdirSync(path: string, options: { recursive: true }): string[];
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readFileSync(path: string): Uint8Array;
  export function existsSync(path: string): boolean;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string): string;
}

declare module "node:module" {
  export function createRequire(url: string): { resolve(id: string): string };
}

declare module "node:child_process" {
  export function spawnSync(
    file: string,
    args: readonly string[],
    options: { encoding: "utf8"; cwd?: string },
  ): { status: number | null; stdout: string; stderr: string };
}

declare module "node:util" {
  export class TextEncoder {
    encode(input?: string): Uint8Array;
  }
  export class TextDecoder {
    constructor(label?: string);
    decode(input?: Uint8Array): string;
  }
}

declare module "node:perf_hooks" {
  export const performance: { now(): number };
}

declare module "node:buffer" {
  export const Buffer: { from(bytes: Uint8Array): { toString(encoding: "base64"): string } };
}

declare const process: { execPath: string };

// `lib: ["ES2022"]` has no `ImportMeta.url` (that lives in the DOM lib), so
// the tests' `import.meta.url` needs it declared here.
interface ImportMeta {
  readonly url: string;
}

declare module "node:process" {
  export const env: Record<string, string | undefined>;
}

declare module "node:console" {
  export function log(...data: unknown[]): void;
}
