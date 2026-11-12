import type { DirectoryEntry, FileChange, FileStat, FileSystemService } from "@tk-reawakened/platform-services";
import { bindProjectFileSystem, platformError, platformOk, type PlatformResult } from "@tk-reawakened/platform-services";

/** File System Access-backed project storage. The root handle is never exposed outside this adapter. */
export function createWebFileSystem(root: FileSystemDirectoryHandle, projectId: string): FileSystemService {
  const valid = (path: string, allowRoot = false): string[] | null => {
    if (path === "" && allowRoot) return [];
    if (!path || path.startsWith("/") || path.includes("\\")) return null;
    const parts = path.split("/");
    return parts.some((part) => !part || part === "." || part === "..") ? null : parts;
  };
  const fail = (error: unknown, path: string): PlatformResult<never> => {
    const name = error instanceof DOMException ? error.name : "";
    const code = name === "NotFoundError" ? "not-found" : name === "IsADirectoryError" ? "is-a-directory" : name === "TypeMismatchError" ? "not-a-directory" : name === "NotAllowedError" || name === "SecurityError" ? "permission-denied" : "io-error";
    return platformError(code, `${path}: ${error instanceof Error ? error.message : String(error)}`);
  };
  const dir = async (parts: readonly string[], create = false): Promise<FileSystemDirectoryHandle> => {
    let handle = root;
    for (const part of parts) handle = await handle.getDirectoryHandle(part, { create });
    return handle;
  };
  const file = async (parts: readonly string[], create = false): Promise<FileSystemFileHandle> => {
    if (!parts.length) throw new DOMException("Project root is a directory", "TypeMismatchError");
    const parent = await dir(parts.slice(0, -1), create);
    try {
      return await parent.getFileHandle(parts[parts.length - 1]!, { create });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TypeMismatchError") {
        throw new DOMException(error.message, "IsADirectoryError");
      }
      throw error;
    }
  };
  const fs = bindProjectFileSystem(projectId, {
    async list(path) {
      const parts = valid(path, true); if (!parts) return platformError("invalid-path", `Invalid project path: ${path}`);
      try { const result: DirectoryEntry[] = []; for await (const [name, entry] of (await dir(parts)).entries()) result.push({ name, kind: entry.kind }); return platformOk(result); }
      catch (error) { return fail(error, path || "."); }
    },
    async read(path) {
      const parts = valid(path); if (!parts) return platformError("invalid-path", `Invalid project path: ${path}`);
      try { const target = await file(parts); const source = await target.getFile(); return platformOk(new Uint8Array(await source.arrayBuffer())); }
      catch (error) { return fail(error, path); }
    },
    async write(path, bytes) {
      const parts = valid(path); if (!parts) return platformError("invalid-path", `Invalid project path: ${path}`);
      try { const target = await file(parts, true); const writable = await target.createWritable({ keepExistingData: false }); const buffer = new ArrayBuffer(bytes.byteLength); new Uint8Array(buffer).set(bytes); await writable.write(buffer); await writable.close(); return platformOk(undefined); }
      catch (error) { return fail(error, path); }
    },
    async stat(path) {
      const parts = valid(path, true); if (!parts) return platformError("invalid-path", `Invalid project path: ${path}`);
      try { if (!parts.length) return platformOk({ kind: "directory", size: 0, modifiedMs: 0 }); const target = await dir(parts.slice(0, -1)); try { const handle = await target.getFileHandle(parts.at(-1)!); const entry = await handle.getFile(); return platformOk({ kind: "file", size: entry.size, modifiedMs: entry.lastModified }); } catch (error) { if (!(error instanceof DOMException) || error.name !== "TypeMismatchError") throw error; await target.getDirectoryHandle(parts.at(-1)!); return platformOk({ kind: "directory", size: 0, modifiedMs: 0 }); } }
      catch (error) { return fail(error, path || "."); }
    },
    async delete(path) { const parts = valid(path); if (!parts) return platformError("invalid-path", `Invalid project path: ${path}`); try { await (await dir(parts.slice(0, -1))).removeEntry(parts.at(-1)!, { recursive: true }); return platformOk(undefined); } catch (error) { return fail(error, path); } },
    async rename(from, to) { const source = valid(from); const target = valid(to); if (!source || !target) return platformError("invalid-path", `Invalid project path: ${!source ? from : to}`); return platformError("unavailable", "File System Access does not provide a portable atomic rename."); },
    async watch(_path, _onChange) { return platformError("unavailable", "This browser cannot watch project changes."); },
  });
  return fs;
}
