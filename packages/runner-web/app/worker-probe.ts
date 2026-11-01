import {
  askWorkerVersion,
  PLAYER_PAGE_URL,
  PLAYER_SCOPE,
  PRECACHE_MANIFEST_URL,
  registerPlayerWorker,
  shouldRegisterServiceWorker,
  WORKER_SCRIPT_URL,
} from "../src/register-worker.ts";

export interface ProbeState {
  readonly shouldRegisterServiceWorker: typeof shouldRegisterServiceWorker;
  readonly registerPlayerWorker: typeof registerPlayerWorker;
  readonly askWorkerVersion: typeof askWorkerVersion;
  readonly constants: {
    readonly PLAYER_PAGE_URL: string;
    readonly PLAYER_SCOPE: string;
    readonly WORKER_SCRIPT_URL: string;
    readonly PRECACHE_MANIFEST_URL: string;
  };
}

declare global {
  interface Window {
    __probe?: ProbeState;
  }
}

window.__probe = {
  shouldRegisterServiceWorker,
  registerPlayerWorker,
  askWorkerVersion,
  constants: {
    PLAYER_PAGE_URL,
    PLAYER_SCOPE,
    WORKER_SCRIPT_URL,
    PRECACHE_MANIFEST_URL,
  },
};
