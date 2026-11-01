/**
 * Browser storage for the package source, on the Origin Private File System (docs/spec/engine/runners.md#install,
 * #load-modes): the temporary staging file an archive is validated from, and the durable cache a kept package lives in.
 *
 * Neither is trusted. `openPackageSource` hashes every block it reads back against what it saw on the wire, so a
 * truncated or tampered file is dropped and the network is read instead; what this module owes is to fail loudly, never
 * to hand back a short answer, and to leave nothing half-written under a name a later launch could mistake for a package.
 *
 * Save blobs never go here: they live in IndexedDB (`blob-host.ts`), and nothing in this module is reachable from a
 * service worker's Cache Storage.
 */

import type { ArchiveStaging, DurablePackageStore } from "./package-source.ts";

const PACKAGE_DIRECTORY = "tkr-packages";
const STAGING_DIRECTORY = "tkr-staging";

async function removeQuietly(directory: FileSystemDirectoryHandle, name: string): Promise<void> {
  try {
    await directory.removeEntry(name);
  } catch (cause) {
    if (!(cause instanceof DOMException) || cause.name !== "NotFoundError") throw cause;
  }
}

async function readSlice(file: File, start: number, end: number): Promise<Uint8Array> {
  const bytes = new Uint8Array(await file.slice(start, end).arrayBuffer());
  if (bytes.length !== end - start) throw new Error(`the file holds ${bytes.length} of the ${end - start} bytes asked for`);
  return bytes;
}

/**
 * A staging file in `root`. Each call makes its own uniquely named file, so two tabs validating at once never share one.
 * The writable stream is opened on the first append, so a host that cannot write (no `createWritable`) fails the open of
 * staging rather than the transfer.
 */
export function createOpfsStaging(root: FileSystemDirectoryHandle): () => Promise<ArchiveStaging> {
  return async () => {
    const directory = await root.getDirectoryHandle(STAGING_DIRECTORY, { create: true });
    const name = `${crypto.randomUUID()}.part`;
    const handle = await directory.getFileHandle(name, { create: true });
    let writable: FileSystemWritableFileStream | null = await handle.createWritable();
    let sealed: File | null = null;
    return {
      async append(chunk) {
        if (writable === null) throw new Error("the staging file is already sealed");
        // `write` takes the chunk's bytes now; the caller reuses the buffer once this settles.
        await writable.write(chunk.slice());
      },
      async seal() {
        if (writable !== null) {
          const closing = writable;
          writable = null;
          await closing.close();
        }
        sealed = await handle.getFile();
      },
      async readRange(start, end) {
        if (sealed === null) throw new Error("the staging file is not sealed yet");
        return readSlice(sealed, start, end);
      },
      async discard() {
        if (writable !== null) {
          const aborting = writable;
          writable = null;
          await aborting.abort().catch(() => undefined);
        }
        sealed = null;
        await removeQuietly(directory, name);
      },
    };
  };
}

/**
 * The durable package cache: one file per archive, named by its SHA-256, plus a completion marker holding the archive's
 * size that is written last. A file without its marker, or whose size disagrees with it, is not held: a launch that was
 * killed mid-write, or a store that ran out of room, never leaves something `readRange` would answer from.
 */
export function createOpfsPackageStore(root: FileSystemDirectoryHandle): DurablePackageStore {
  const directory = (): Promise<FileSystemDirectoryHandle> => root.getDirectoryHandle(PACKAGE_DIRECTORY, { create: true });

  async function heldFile(sha256: string): Promise<File | null> {
    const folder = await directory();
    try {
      const marker = await (await folder.getFileHandle(`${sha256}.size`)).getFile();
      const archive = await (await folder.getFileHandle(`${sha256}.tpk`)).getFile();
      return String(archive.size) === (await marker.text()) ? archive : null;
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "NotFoundError") return null;
      throw cause;
    }
  }

  async function discard(sha256: string): Promise<void> {
    const folder = await directory();
    // The marker goes first: once it is gone the archive is not held, whatever happens to the second removal.
    await removeQuietly(folder, `${sha256}.size`);
    await removeQuietly(folder, `${sha256}.tpk`);
  }

  return {
    async readRange(sha256, start, end) {
      const archive = await heldFile(sha256);
      return archive === null ? null : readSlice(archive, start, end);
    },
    async put(sha256, size, chunks) {
      const folder = await directory();
      await discard(sha256);
      try {
        const writable = await (await folder.getFileHandle(`${sha256}.tpk`, { create: true })).createWritable();
        let written = 0;
        try {
          for await (const chunk of chunks) {
            await writable.write(chunk.slice());
            written += chunk.length;
          }
        } catch (cause) {
          await writable.abort().catch(() => undefined);
          throw cause;
        }
        await writable.close();
        if (written !== size) throw new Error(`the archive came to ${written} bytes, not the ${size} it declared`);
        const marker = await (await folder.getFileHandle(`${sha256}.size`, { create: true })).createWritable();
        await marker.write(String(size));
        await marker.close();
      } catch (cause) {
        // All or nothing: whatever failed (a QuotaExceededError included), no part of the archive stays held.
        await discard(sha256).catch(() => undefined);
        throw cause;
      }
    },
    discard,
  };
}
