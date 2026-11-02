import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { equal, ok } from "node:assert/strict";

const here = resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");

function read(relative: string): string {
  return readFileSync(resolve(here, relative), "utf8");
}

test("browser player page has a strict Content-Security-Policy", () => {
  const html = read("packages/runner-web/app/index.html");
  const csp = html.match(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i);
  if (csp === null) throw new Error("no Content-Security-Policy meta tag found");
  const policy = csp[1] ?? "";
  ok(!/unsafe-eval/.test(policy), "CSP must not allow unsafe-eval");
  ok(/script-src 'self'/.test(policy), "CSP must restrict scripts to same origin");
});

test("desktop player page has a strict Content-Security-Policy", () => {
  const html = read("packages/runner-desktop/app/player.html");
  const csp = html.match(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i);
  if (csp === null) throw new Error("no Content-Security-Policy meta tag found");
  const policy = csp[1] ?? "";
  ok(!/unsafe-eval/.test(policy), "CSP must not allow unsafe-eval");
  ok(/script-src 'self'/.test(policy), "CSP must restrict scripts to same origin");
});

test("desktop main process uses the event-object console-message listener", () => {
  const source = read("packages/runner-desktop/src/main.ts");
  const deprecated = source.match(/\.on\("console-message"\s*,\s*\(_event,\s*level,\s*message\)/);
  equal(deprecated, null, "console-message listener must not use the deprecated positional signature");
  ok(
    /\.on\("console-message"\s*,\s*\(event\)\s*=>\s*console\.error\(`renderer\[\$\{event\.level\}\]:\s*\$\{event\.message\}`\)/.test(source),
    "console-message listener must read level and message from the event object",
  );
});
