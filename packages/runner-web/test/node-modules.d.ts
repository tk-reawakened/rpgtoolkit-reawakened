// Module-only declarations for the Node built-ins the sink tests read. G2 keeps `types: []` in every package's test
// project, so these stand in for @types/node exactly as `packages/synth/test/node-modules.d.ts` does.

interface ImportMeta {
  readonly url: string;
}

declare module "node:fs" {
  export function readFileSync(path: string): Uint8Array;
  export function readFileSync(path: string, encoding: "utf8"): string;
}
declare module "node:path" {
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
}
declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
