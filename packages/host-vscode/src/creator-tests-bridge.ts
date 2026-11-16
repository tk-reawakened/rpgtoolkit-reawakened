export type CreatorTestsBridgeRequest = {
  readonly id: string;
  readonly method: "run" | "openSource" | "invalid";
  readonly args: readonly unknown[];
};

const MAX_NAME = 256;
const MAX_SOURCE_PATH = 1024;

/** Decode the untrusted webview request envelope once, preserving invalid known requests for an explicit host response. */
export function parseCreatorTestsBridgeRequest(value: unknown, nonce: string): CreatorTestsBridgeRequest | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (item.type !== "creator-tests:request" || item.nonce !== nonce || typeof item.id !== "string" || !/^[a-f0-9]{24}$/.test(item.id)) return undefined;
  const invalid = (): CreatorTestsBridgeRequest => ({ id: item.id as string, method: "invalid", args: [] });
  if (!Array.isArray(item.args)) return invalid();
  if (item.method === "run" && item.args.length === 1) {
    const args = item.args[0];
    if (typeof args !== "object" || args === null || Array.isArray(args)) return invalid();
    const request = args as Record<string, unknown>;
    if (Object.keys(request).some((key) => key !== "seed" && key !== "name") || !Number.isSafeInteger(request.seed)
      || (request.seed as number) < 0 || (request.seed as number) > 0xffffffff || typeof request.name !== "string" || request.name.length > MAX_NAME) return invalid();
    return { id: item.id, method: "run", args: [request] };
  }
  if (item.method === "openSource" && item.args.length === 3) {
    const [path, line, column] = item.args;
    if (typeof path !== "string" || typeof line !== "number" || typeof column !== "number" || !isValidCreatorTestsSourceLocation(path, line, column)) return invalid();
    return { id: item.id, method: "openSource", args: [path, line, column] };
  }
  return invalid();
}

export function isValidCreatorTestsSourceLocation(path: string, line: number, column: number): boolean {
  return path.length > 0 && path.length <= MAX_SOURCE_PATH && !path.startsWith("/")
    && !path.includes("\\") && path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..")
    && /\.(?:prg|rnc)$/i.test(path) && Number.isSafeInteger(line) && line >= 1 && line <= 1_000_000
    && Number.isSafeInteger(column) && column >= 1 && column <= 100_000;
}
