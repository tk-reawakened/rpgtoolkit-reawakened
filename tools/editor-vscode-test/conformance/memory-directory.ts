// A case-sensitive in-memory folder with the File System Access calls the browser host makes, for running the real
// `host-web` adapter in Node. Only the native layer is replaced: every path check, error mapping and lifecycle rule is
// the host's own code. A test can refuse or hold writes, and change files behind the host's back.

interface StoredFile {
  readonly kind: "file";
  bytes: Uint8Array;
  modified: number;
}

export interface WriteControl {
  refuse: boolean;
  hold: Promise<void> | null;
  tick: number;
}

export class MemoryDirectory {
  readonly kind = "directory";
  readonly name: string;
  readonly children = new Map<string, MemoryDirectory | StoredFile>();
  readonly #control: WriteControl;

  constructor(name: string, control: WriteControl) {
    this.name = name;
    this.#control = control;
  }

  async getDirectoryHandle(name: string, options?: { readonly create?: boolean }): Promise<MemoryDirectory> {
    const existing = this.children.get(name);
    if (existing instanceof MemoryDirectory) return existing;
    if (existing !== undefined) throw new DOMException(`${name} is not a folder`, "TypeMismatchError");
    if (options?.create !== true) throw new DOMException(`${name} was not found`, "NotFoundError");
    const child = new MemoryDirectory(name, this.#control);
    this.children.set(name, child);
    return child;
  }

  async getFileHandle(name: string, options?: { readonly create?: boolean }): Promise<unknown> {
    let file = this.children.get(name);
    if (file instanceof MemoryDirectory) throw new DOMException(`${name} is a folder`, "TypeMismatchError");
    if (file === undefined) {
      if (options?.create !== true) throw new DOMException(`${name} was not found`, "NotFoundError");
      file = { kind: "file", bytes: new Uint8Array(0), modified: (this.#control.tick += 1) };
      this.children.set(name, file);
    }
    const stored = file;
    const control = this.#control;
    return {
      kind: "file",
      name,
      getFile: async () => ({ size: stored.bytes.length, lastModified: stored.modified, arrayBuffer: async () => stored.bytes.slice().buffer }),
      createWritable: async () => {
        if (control.refuse) throw new DOMException("The folder refuses writes", "NotAllowedError");
        let pending = stored.bytes.slice();
        return {
          write: async (data: ArrayBuffer) => { pending = new Uint8Array(data.slice(0)); },
          close: async () => {
            if (control.hold !== null) await control.hold;
            stored.bytes = pending;
            stored.modified = (control.tick += 1);
          },
        };
      },
    };
  }

  async *entries(): AsyncGenerator<[string, { readonly kind: "file" | "directory" }]> {
    for (const [name, entry] of this.children) yield [name, { kind: entry.kind }];
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.children.delete(name)) throw new DOMException(`${name} was not found`, "NotFoundError");
  }

  /** The bytes at a `/` path, or `null`; read behind the host's back. */
  read(path: string): Uint8Array | null {
    const parts = path.split("/");
    let folder: MemoryDirectory = this;
    for (const part of parts.slice(0, -1)) {
      const next = folder.children.get(part);
      if (!(next instanceof MemoryDirectory)) return null;
      folder = next;
    }
    const file = folder.children.get(parts.at(-1)!);
    return file === undefined || file instanceof MemoryDirectory ? null : file.bytes.slice();
  }

  /** Write or delete a file behind the host's back, as another program would. */
  put(path: string, bytes: Uint8Array | null): void {
    const parts = path.split("/");
    let folder: MemoryDirectory = this;
    for (const part of parts.slice(0, -1)) {
      let next = folder.children.get(part);
      if (next === undefined) {
        next = new MemoryDirectory(part, this.#control);
        folder.children.set(part, next);
      }
      if (!(next instanceof MemoryDirectory)) throw new Error(`${part} is a file`);
      folder = next;
    }
    const name = parts.at(-1)!;
    if (bytes === null) folder.children.delete(name);
    else folder.children.set(name, { kind: "file", bytes: bytes.slice(), modified: (this.#control.tick += 1) });
  }
}
