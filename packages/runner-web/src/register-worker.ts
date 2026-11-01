/**
 * Page-side registration helper for the offline player service worker (issue #934).
 *
 * Scoped to the player page (`/packages/runner-web/app/index.html`) so it controls the player
 * and any query-parameter launches, while leaving sibling test pages (`storage.html`, `audio.html`, etc.)
 * untouched and uncontrolled.
 *
 * Explicitly guards against registering in desktop environments (protocol `app:` for Electron)
 * or non-http(s) mobile runtimes (Capacitor `capacitor:`, `file:`, etc.).
 */

import {
  ALLOWED_SCOPE_HEADER,
  PLAYER_PAGE_URL,
  PLAYER_SCOPE,
  PRECACHE_MANIFEST_URL,
  WORKER_SCRIPT_URL,
} from "./service-worker-core.ts";

export { ALLOWED_SCOPE_HEADER, PLAYER_PAGE_URL, PLAYER_SCOPE, PRECACHE_MANIFEST_URL, WORKER_SCRIPT_URL };

export interface LocationLike {
  readonly protocol?: string;
  readonly origin?: string;
  readonly href?: string;
}

export interface ServiceWorkerRegistrationLike {
  readonly scope: string;
  readonly active: unknown;
  readonly installing: unknown;
  readonly waiting: unknown;
  update(): Promise<unknown>;
  unregister(): Promise<boolean>;
}

export interface NavigatorLike {
  readonly serviceWorker?: {
    register(
      scriptURL: string | URL,
      options?: { scope?: string; updateViaCache?: "all" | "imports" | "none" },
    ): Promise<ServiceWorkerRegistrationLike>;
    readonly controller?: unknown;
  } | null;
}

export interface WindowLike {
  readonly location?: LocationLike | null;
  readonly navigator?: NavigatorLike | null;
}

export type RegistrationResult =
  | { readonly registered: true; readonly registration: ServiceWorkerRegistrationLike }
  | { readonly registered: false; readonly reason: string };

/**
 * Returns false when:
 * - protocol is `app:` (Electron desktop shell)
 * - protocol is non-http(s) (such as Capacitor's `capacitor:` or `file:`)
 * - `navigator.serviceWorker` is absent (unsupported browser or insecure context)
 */
export function shouldRegisterServiceWorker(
  location?: LocationLike | null,
  navigatorLike?: NavigatorLike | null,
): boolean {
  if (!location || typeof location.protocol !== "string") return false;
  if (!navigatorLike || !navigatorLike.serviceWorker) return false;
  const proto = location.protocol.toLowerCase();
  if (proto === "app:") return false;
  if (proto !== "http:" && proto !== "https:") return false;
  return true;
}

/** Determine the specific blocker reason if registration should not proceed. */
export function registrationBlocker(
  location?: LocationLike | null,
  navigatorLike?: NavigatorLike | null,
): string | null {
  if (!location || typeof location.protocol !== "string") return "no-location";
  const proto = location.protocol.toLowerCase();
  if (proto === "app:") return "desktop-app-scheme";
  if (proto !== "http:" && proto !== "https:") return `unsupported-protocol: ${proto}`;
  if (!navigatorLike || !navigatorLike.serviceWorker) return "no-service-worker";
  return null;
}

export interface RegisterOptions {
  /** Override the registration scope (defaults to PLAYER_SCOPE). */
  readonly scope?: string;
}

/**
 * Register the player's service worker (`/apps/service-worker.js`).
 * Uses `updateViaCache: 'none'` so script updates are always checked against the network.
 *
 * Never throws: returns `{ registered: false, reason }` on failure.
 */
export async function registerPlayerWorker(
  win?: WindowLike | null,
  options?: RegisterOptions,
): Promise<RegistrationResult> {
  const targetWin = win ?? (typeof window !== "undefined" ? (window as unknown as WindowLike) : null);
  if (!targetWin) {
    return { registered: false, reason: "no-window" };
  }

  const blocker = registrationBlocker(targetWin.location, targetWin.navigator);
  if (blocker !== null) {
    return { registered: false, reason: blocker };
  }

  const scope = options?.scope ?? PLAYER_SCOPE;
  try {
    const registration = await targetWin.navigator!.serviceWorker!.register(WORKER_SCRIPT_URL, {
      scope,
      updateViaCache: "none",
    });
    return { registered: true, registration };
  } catch (error) {
    return {
      registered: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface WorkerMessengerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

/**
 * Query a service worker for its content-derived version string via `{ type: 'version' }` message.
 */
export async function askWorkerVersion(worker: WorkerMessengerLike, timeoutMs = 5000): Promise<string> {
  if (typeof MessageChannel === "undefined") {
    throw new Error("MessageChannel is unavailable in this environment");
  }
  const channel = new MessageChannel();
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      channel.port1.close();
      channel.port2.close();
      reject(new Error(`Timed out waiting for worker version after ${timeoutMs}ms`));
    }, timeoutMs);

    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      const data = event.data;
      if (data && typeof data === "object" && "version" in data && typeof data.version === "string") {
        resolve(data.version);
      } else {
        reject(new Error(`Invalid worker version response: ${JSON.stringify(data)}`));
      }
    };

    worker.postMessage({ type: "version" }, [channel.port2]);
  });
}
