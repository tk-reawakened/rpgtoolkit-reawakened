import { createRunHandle, launchUnavailable, platformError, platformOk, prepareRun, prepareSceneLaunch, type FileSystemService, type Launch, type RunDiagnostic, type RunHandle, type RunService, type RunStartGuard, type RunStatus } from "@tk-reawakened/platform-services";

function isDiagnostic(value: unknown): value is RunDiagnostic {
  return typeof value === "object" && value !== null
    && "code" in value && typeof value.code === "string"
    && "file" in value && typeof value.file === "string"
    && "line" in value && typeof value.line === "number"
    && "message" in value && typeof value.message === "string";
}

/** Launch saved project bytes in the same-origin live player. The frame is host chrome; it owns no editor state. */
export function createWebRunService(fs: FileSystemService, projectId: string, playerUrl: string): RunService {
  const start = async (launch: Launch, guard?: RunStartGuard) => {
      if (launch.kind === "board") return launchUnavailable("board", "the fresh-state board runner is not yet connected.");
      const prepared = await prepareRun(fs, launch, { projectId, runner: "runner-web" });
      if (!prepared.ok) return prepared;
      const scene = launch.kind === "game" ? null : prepareSceneLaunch(launch, prepared.value.files);
      if (scene !== null && !scene.ok) return scene;
      const url = new URL(playerUrl, window.location.href);
      if (url.origin !== window.location.origin) return platformError("unavailable", "The game player must be hosted on the editor's origin.");
      url.searchParams.set("editor", "1");
      const allowed = guard?.();
      if (allowed !== undefined && !allowed.ok) return allowed;
      const frame = document.createElement("iframe");
      frame.title = "Running game";
      frame.width = "800";
      frame.height = "600";
      frame.src = url.href;
      const channel = new MessageChannel();
      const { handle, report } = createRunHandle(prepared.value.snapshot, () => {
        channel.port1.postMessage("stop");
        channel.port1.close();
        window.removeEventListener("message", onReady);
        frame.remove();
      });
      const onReady = (event: MessageEvent<unknown>): void => {
        if (event.origin !== url.origin || event.source !== frame.contentWindow) return;
        if (typeof event.data === "object" && event.data !== null && "type" in event.data && event.data.type === "tkr-player-error"
          && "message" in event.data && typeof event.data.message === "string") {
          report({ state: "failed", message: event.data.message });
          window.removeEventListener("message", onReady);
          channel.port1.close();
          frame.remove();
          return;
        }
        if (event.data !== "tkr-player-ready") return;
        window.removeEventListener("message", onReady);
        const stillAllowed = guard?.();
        if (stillAllowed !== undefined && !stillAllowed.ok) {
          report({ state: "failed", message: stillAllowed.error.message });
          channel.port1.close();
          frame.remove();
          return;
        }
        frame.contentWindow?.postMessage("tkr-editor-connect", url.origin, [channel.port2]);
        channel.port1.postMessage({ main: launch.main, project: projectId, projectFolder: launch.projectFolder, seed: launch.seed ?? 0, files: prepared.value.files, ...(scene === null ? {} : { scene: scene.value }) });
      };
      channel.port1.onmessage = (event: MessageEvent<unknown>) => {
        const value = event.data;
        if (typeof value !== "object" || value === null || !("state" in value)) return;
        const state = value.state;
        if (state !== "running" && state !== "stalled" && state !== "ended" && state !== "failed") return;
        const next: Partial<RunStatus> = {
          state,
          ...("tick" in value && typeof value.tick === "number" ? { tick: value.tick } : {}),
          ...("board" in value && (typeof value.board === "string" || value.board === null) ? { board: value.board } : {}),
          ...("stateHash" in value && typeof value.stateHash === "string" ? { stateHash: value.stateHash } : {}),
          ...("stalledOn" in value && (typeof value.stalledOn === "string" || value.stalledOn === null) ? { stalledOn: value.stalledOn } : {}),
          ...("message" in value && (typeof value.message === "string" || value.message === null) ? { message: value.message } : {}),
          ...("diagnostics" in value && Array.isArray(value.diagnostics) ? { diagnostics: value.diagnostics.filter(isDiagnostic) } : {}),
        };
        report(next);
        if (state === "ended" || state === "failed") {
          channel.port1.close();
          frame.remove();
        }
      };
      window.addEventListener("message", onReady);
      document.body.append(frame);
      return platformOk<RunHandle>(handle);
    };
  return {
    unavailable: { board: "the fresh-state board runner is not yet connected." },
    startGame: start,
    startProgram: start,
  };
}
