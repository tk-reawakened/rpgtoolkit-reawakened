import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createVscodeFileSystemWithPort, vscodeCapabilities, type VscodeFileSystemPort } from "@tk-reawakened/host-vscode/testing";

interface Uri { readonly path: string }
const root: Uri = { path: "/project" };
test("VS Code reports only capabilities backed by its workspace adapter", () => {
  deepEqual(new Set(vscodeCapabilities(true)), new Set(["folderWrite", "fileWatch", "stableProjectHandle", "backup", "pickFile"]));
  deepEqual(new Set(vscodeCapabilities(false)), new Set(["folderWrite", "stableProjectHandle", "backup", "pickFile"]), "a browser VS Code claims no live change detection");
});
const original = new Uint8Array([1, 2, 3]);
const files = new Map([["/project/Main.gam", original.slice()]]);
const permission = Object.assign(new Error("read-only project"), { code: "NoPermissions" });
const notFound = Object.assign(new Error("missing"), { code: "FileNotFound" });
const port: VscodeFileSystemPort<Uri> = {
  isSymbolicLink: (type) => (type & 64) !== 0,
  isDirectory: (type) => (type & 2) !== 0,
  joinPath: (base, ...parts) => ({ path: `${base.path}/${parts.join("/")}` }),
  parent: (uri) => ({ path: uri.path.slice(0, uri.path.lastIndexOf("/")) }),
  async readDirectory(uri) { return uri.path === root.path ? [["Main.gam", 1], ["linked", 66]] : []; },
  async readFile(uri) { const bytes = files.get(uri.path); if (!bytes) throw notFound; return bytes.slice(); },
  async createDirectory() {},
  async writeFile() { throw permission; },
  async stat(uri) { if (uri.path === "/project/linked") return { type: 66, size: 0, mtime: 0 }; const bytes = files.get(uri.path); if (!bytes) throw notFound; return { type: 1, size: bytes.length, mtime: 1 }; },
  async delete(uri) { files.delete(uri.path); },
  async rename(source, target) { const bytes = files.get(source.path); if (!bytes) throw notFound; files.set(target.path, bytes); files.delete(source.path); },
  async watch() { return { dispose() {} }; },
  errorCode(error) { return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined; },
};

test("VS Code workspace filesystem rejects traversal and preserves old bytes on failed writes", async () => {
  files.set("/project/Main.gam", original.slice());
  const fs = createVscodeFileSystemWithPort(root, port, "file:///project");
  const listed = await fs.list("");
  ok(listed.ok);
  if (listed.ok) deepEqual(listed.value, [{ name: "Main.gam", kind: "file" }, { name: "linked", kind: "link" }]);
  const linkedStat = await fs.stat("linked");
  ok(linkedStat.ok && linkedStat.value.kind === "link");
  const invalid = await fs.read("../outside.gam");
  equal(invalid.ok, false);
  if (!invalid.ok) equal(invalid.error.code, "invalid-path");
  const rejected = await fs.write("Main.gam", new Uint8Array([4, 5]));
  equal(rejected.ok, false);
  if (!rejected.ok) equal(rejected.error.code, "permission-denied");
  deepEqual(files.get("/project/Main.gam"), original);
  const missing = await fs.read("missing.gam");
  equal(missing.ok, false);
  if (!missing.ok) equal(missing.error.code, "not-found");
});
