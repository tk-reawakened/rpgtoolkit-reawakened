import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { join, relative, resolve, sep } from "node:path";
import { StringDecoder } from "node:string_decoder";

/** A private test-only filesystem; the fixture remains outside the browser workbench. */
export async function startPersistentFs(directory, allowedOrigin, maxBodyBytes = 16 * 1024 * 1024) {
  const root = await realpath(directory);
  const token = randomBytes(32).toString("hex");
  const workspaceId = randomBytes(16).toString("hex");
  const workbench = new URL(allowedOrigin);
  const events = [];
  const server = createServer(async (request, response) => {
    const origin = request.headers.origin;
    let allowed = origin === allowedOrigin;
    if (!allowed && typeof origin === "string") {
      try {
        const candidate = new URL(origin);
        allowed = candidate.protocol === workbench.protocol && candidate.port === workbench.port
          && /^v--[a-z0-9]+\.localhost$/.test(candidate.hostname);
      } catch { /* A malformed origin is denied. */ }
    }
    if (!allowed) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Headers", "content-type");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.setHeader("Vary", "Origin");
    if (request.method === "OPTIONS") {
      response.writeHead(204).end();
      return;
    }
    if (request.method !== "POST" || request.url !== `/${token}`) {
      response.writeHead(403).end();
      return;
    }
    try {
      const input = JSON.parse(await readRequestBody(request, maxBodyBytes));
      let result;
      if (input.op === "trace") {
        if (!["command", "save", "revert"].includes(input.kind) || typeof input.value !== "string") throw Object.assign(new Error("Invalid trace event"), { code: "EINVAL" });
        events.push({ kind: input.kind, value: input.value });
        result = null;
      } else {
        result = await perform(root, input);
      }
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ result }));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: error.code ?? "EINVAL", message: error.message }));
    }
  });
  await new Promise((resolveListen, reject) => server.listen(0, "127.0.0.1", resolveListen).once("error", reject));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not bind test filesystem bridge");
  return {
    authority: `${workspaceId}.${address.port}`,
    token,
    events: () => events.slice(),
    close: () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())),
  };
}

export async function readRequestBody(request, maxBodyBytes) {
  let body = "";
  let size = 0;
  const decoder = new StringDecoder("utf8");
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw Object.assign(new Error("Request too large"), { code: "EFBIG" });
    body += decoder.write(chunk);
  }
  return body + decoder.end();
}

async function checkedPath(root, path, allowMissing = false) {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("\\") || path.includes("\0")) throw Object.assign(new Error("Invalid path"), { code: "EINVAL" });
  const segments = path === "/" ? [] : path.slice(1).split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) throw Object.assign(new Error("Invalid path segment"), { code: "EINVAL" });
  const target = resolve(root, ...segments);
  const within = relative(root, target);
  if (within === ".." || within.startsWith(`..${sep}`)) throw Object.assign(new Error("Path escapes workspace"), { code: "EACCES" });
  let current = root;
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index]);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw Object.assign(new Error("Symlinks are not allowed"), { code: "EACCES" });
    } catch (error) {
      if (error.code !== "ENOENT" || !allowMissing || (allowMissing !== "parents" && index !== segments.length - 1)) throw error;
    }
  }
  return target;
}

async function perform(root, input) {
  if (!input || typeof input !== "object") throw Object.assign(new Error("Invalid request"), { code: "EINVAL" });
  const missing = input.op === "createDirectory" ? "parents" : ["writeFile", "rename"].includes(input.op);
  const target = await checkedPath(root, input.path, missing);
  switch (input.op) {
    case "stat": {
      const entry = await stat(target);
      return { type: entry.isDirectory() ? 2 : 1, ctime: entry.ctimeMs, mtime: entry.mtimeMs, size: entry.size };
    }
    case "readDirectory": {
      const entries = await readdir(target, { withFileTypes: true });
      return entries.filter((entry) => !entry.isSymbolicLink()).map((entry) => [entry.name, entry.isDirectory() ? 2 : 1]);
    }
    case "readFile": {
      const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { return (await file.readFile()).toString("base64"); } finally { await file.close(); }
    }
    case "writeFile": {
      if (typeof input.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)) throw Object.assign(new Error("Invalid bytes"), { code: "EINVAL" });
      if (!input.create && !input.overwrite) {
        await lstat(target);
        throw Object.assign(new Error("File exists"), { code: "EEXIST" });
      }
      let flags = constants.O_WRONLY | constants.O_NOFOLLOW;
      if (input.create) flags |= constants.O_CREAT;
      if (!input.overwrite) flags |= constants.O_EXCL;
      flags |= constants.O_TRUNC;
      const { file, created } = await openProofFile(target, flags, input.create, input.overwrite);
      try { await file.writeFile(Buffer.from(input.data, "base64")); } finally { await file.close(); }
      return { created };
    }
    case "createDirectory": await mkdir(target, { recursive: true }); return null;
    case "delete":
      if (target === root) throw Object.assign(new Error("Cannot delete workspace root"), { code: "EACCES" });
      await rm(target, { recursive: Boolean(input.recursive) }); return null;
    case "rename": {
      const destination = await checkedPath(root, input.destination, true);
      if (target === root || destination === root) throw Object.assign(new Error("Cannot rename workspace root"), { code: "EACCES" });
      if (!input.overwrite) {
        try { await lstat(destination); throw Object.assign(new Error("Destination exists"), { code: "EEXIST" }); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      await rename(target, destination); return null;
    }
    default: throw Object.assign(new Error("Unknown operation"), { code: "EINVAL" });
  }
}

export async function openProofFile(target, flags, create, overwrite, openFile = open) {
  if (!create) return { file: await openFile(target, flags, 0o600), created: false };
  for (;;) {
    try {
      return { file: await openFile(target, flags | constants.O_EXCL, 0o600), created: true };
    } catch (error) {
      if (error.code !== "EEXIST" || !overwrite) throw error;
    }
    try {
      return { file: await openFile(target, flags & ~constants.O_CREAT, 0o600), created: false };
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}
