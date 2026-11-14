import { createRunHandle, launchUnavailable, platformError, platformOk, prepareRun, type FileSystemService, type RunDiagnostic, type RunHandle, type RunService, type RunStatus } from "@tk-reawakened/platform-services";

function isDiagnostic(value: unknown): value is RunDiagnostic {
  return typeof value === "object" && value !== null
    && "code" in value && typeof value.code === "string"
    && "file" in value && typeof value.file === "string"
    && "line" in value && typeof value.line === "number"
    && "message" in value && typeof value.message === "string";
}

/** Launch saved project bytes in the same-origin live player. The frame is host chrome; it owns no editor state. */
export function createWebRunService(fs: FileSystemService, projectId: string, playerUrl: string): RunService {
  const unavailable = {
    board: "the live player cannot yet start a board with an explicit position and party.",
    program: "the live player cannot yet apply a program fixture.",
  } as const;
  return {
    unavailable,
    async startGame(launch) {
      if (launch.kind !== "game") return launchUnavailable("board", unavailable.board);
      const prepared = await prepareRun(fs, launch, { projectId, runner: "runner-web" });
      if (!prepared.ok) return prepared;
      const url = new URL(playerUrl, window.location.href);
      if (url.origin !== window.location.origin) return platformError("unavailable", "The game player must be hosted on the editor's origin.");
      url.searchParams.set("editor", "1");
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
        frame.contentWindow?.postMessage("tkr-editor-connect", url.origin, [channel.port2]);
        channel.port1.postMessage({ main: launch.main, project: projectId, projectFolder: launch.projectFolder, seed: launch.seed ?? 0, files: prepared.value.files });
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
    },
    startProgram: async () => launchUnavailable("program", unavailable.program),
  };
}
