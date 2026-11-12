import type { DirectoryEntry, FileChange, FileSystemService, PlatformResult } from "@tk-reawakened/platform-services";
import { platformError, platformOk } from "@tk-reawakened/platform-services";

export interface VscodeUriLike { readonly path: string }

export interface VscodeFileSystemPort<Uri extends VscodeUriLike> {
  isDirectory(type: number): boolean;
  joinPath(root: Uri, ...segments: string[]): Uri;
  parent(uri: Uri): Uri;
  readDirectory(uri: Uri): Promise<readonly (readonly [string, number])[]>;
  readFile(uri: Uri): Promise<Uint8Array>;
  createDirectory(uri: Uri): Promise<void>;
  writeFile(uri: Uri, bytes: Uint8Array): Promise<void>;
  stat(uri: Uri): Promise<{ readonly type: number; readonly size: number; readonly mtime: number }>;
  delete(uri: Uri): Promise<void>;
  rename(source: Uri, target: Uri): Promise<void>;
  watch(uri: Uri, onChange: (change: FileChange) => void): Promise<{ dispose(): void }>;
  errorCode(error: unknown): string | undefined;
}

/** Shared validation and result mapping, exercised with a deterministic workspace.fs port in tests. */
export function createVscodeFileSystemWithPort<Uri extends VscodeUriLike>(root: Uri, port: VscodeFileSystemPort<Uri>): FileSystemService {
  const path = (value: string): Uri | null => {
    if (!value || value.startsWith("/") || value.includes("\\") || value.split("/").some((part) => !part || part === "." || part === "..")) return null;
    return port.joinPath(root, ...value.split("/"));
  };
  const failure = (error: unknown, name: string): PlatformResult<never> => {
    const code = port.errorCode(error);
    const mapped = code === "FileNotFound" ? "not-found"
      : code === "FileIsADirectory" ? "is-a-directory"
      : code === "FileNotADirectory" ? "not-a-directory"
      : code === "NoPermissions" ? "permission-denied" : "io-error";
    return platformError(mapped, `${name}: ${error instanceof Error ? error.message : String(error)}`);
  };
  const invalid = (value: string) => platformError("invalid-path", `Invalid project path: ${value}`);
  return {
    async list(value) {
      const uri = value === "" ? root : path(value);
      if (!uri) return invalid(value);
      try {
        const entries: DirectoryEntry[] = (await port.readDirectory(uri)).map(([name, type]) => ({ name, kind: port.isDirectory(type) ? "directory" : "file" }));
        return platformOk(entries);
      } catch (error) { return failure(error, value || "."); }
    },
    async read(value) {
      const uri = path(value);
      if (!uri) return invalid(value);
      try { return platformOk(await port.readFile(uri)); }
      catch (error) { return failure(error, value); }
    },
    async write(value, bytes) {
      const uri = path(value);
      if (!uri) return invalid(value);
      try { await port.createDirectory(port.parent(uri)); await port.writeFile(uri, bytes); return platformOk(undefined); }
      catch (error) { return failure(error, value); }
    },
    async stat(value) {
      const uri = value === "" ? root : path(value);
      if (!uri) return invalid(value);
      try { const info = await port.stat(uri); return platformOk({ kind: port.isDirectory(info.type) ? "directory" : "file", size: info.size, modifiedMs: info.mtime }); }
      catch (error) { return failure(error, value || "."); }
    },
    async delete(value) {
      const uri = path(value);
      if (!uri) return invalid(value);
      try { await port.delete(uri); return platformOk(undefined); }
      catch (error) { return failure(error, value); }
    },
    async rename(from, to) {
      const source = path(from);
      const target = path(to);
      if (!source || !target) return invalid(!source ? from : to);
      try { await port.rename(source, target); return platformOk(undefined); }
      catch (error) { return failure(error, `${from} → ${to}`); }
    },
    async watch(value, onChange) {
      const uri = value === "" ? root : path(value);
      if (!uri) return invalid(value);
      try { return platformOk(await port.watch(uri, onChange)); }
      catch (error) { return failure(error, value || "."); }
    },
  };
}
