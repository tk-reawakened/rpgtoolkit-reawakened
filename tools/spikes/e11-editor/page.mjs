// The spike's page and file responses, shared by the HTTP server (Chromium) and the Electron app:// handler.
// `/b/<bundle>.html?csp=<policy>&nonce=<n>&root=<dock|editor>` returns a page whose only policy is the
// `<meta http-equiv="Content-Security-Policy">` given (the way both editor hosts deliver theirs), loading
// `/b/<bundle>.css` (when it exists) and `/b/<bundle>.js`, with the nonce on both tags when one is given. Every other
// `/b/*` path is a built file. Nothing is inlined: no inline script, no style attribute, no `<style>`.
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { outDir } from "./env.mjs";

const bundles = join(outDir, "bundles");
const types = { ".js": "text/javascript", ".css": "text/css", ".ttf": "font/ttf", ".html": "text/html" };
const escape = (text) => text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

/** `{ status, type, body }` for a request URL. */
export function respond(url) {
  if (url.pathname === "/health") return { status: 200, type: "text/plain", body: "ok" };
  if (!url.pathname.startsWith("/b/")) return { status: 404, type: "text/plain", body: "" };
  const name = normalize(url.pathname.slice(3)).replace(/^(\.\.[/\\])+/, "");
  if (name.endsWith(".html")) {
    const bundle = name.slice(0, -".html".length);
    const csp = url.searchParams.get("csp") ?? "";
    const nonce = url.searchParams.get("nonce");
    const root = url.searchParams.get("root") ?? "dock";
    const nonceAttr = nonce ? ` nonce="${escape(nonce)}"` : "";
    const css = existsSync(join(bundles, `${bundle}.css`)) ? `<link rel="stylesheet" href="${bundle}.css"${nonceAttr}>` : "";
    return {
      status: 200,
      type: "text/html",
      body:
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escape(csp)}"><title>${escape(bundle)}</title>${css}</head>` +
        `<body><div id="${escape(root)}"></div><script${nonceAttr} src="${bundle}.js"></script></body></html>`,
    };
  }
  const file = join(bundles, name);
  if (!file.startsWith(bundles) || !existsSync(file)) return { status: 404, type: "text/plain", body: "" };
  return { status: 200, type: types[extname(file)] ?? "application/octet-stream", body: readFileSync(file) };
}
