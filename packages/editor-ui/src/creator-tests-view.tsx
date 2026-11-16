import { useEffect, useRef, useState } from "preact/hooks";
import type { CreatorTestsController } from "./creator-tests-controller.ts";
import { useDocumentSnapshot } from "./use-document.ts";

export interface CreatorTestsViewProps {
  readonly controller: CreatorTestsController;
}

/** Saved TOOL-5 specs, their real engine observation and source-revision reports; no simulation belongs to this view. */
export function CreatorTestsView({ controller }: CreatorTestsViewProps) {
  const state = useDocumentSnapshot(controller);
  const [seed, setSeed] = useState("0");
  const [name, setName] = useState("");
  const [drawError, setDrawError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const busy = state.phase === "preparing" || state.phase === "running";
  useEffect(() => {
    setDrawError(null);
    const frame = state.frame;
    const element = canvas.current;
    if (frame === null || element === null) return;
    try {
      const context = element.getContext("2d");
      if (context === null) { setDrawError("This host cannot draw the captured engine frame."); return; }
      const data = frame.rgba.buffer instanceof ArrayBuffer
        ? new Uint8ClampedArray(frame.rgba.buffer, frame.rgba.byteOffset, frame.rgba.byteLength)
        : new Uint8ClampedArray(frame.rgba);
      const image = new ImageData(data, frame.width, frame.height);
      context.putImageData(image, 0, 0);
    } catch (error) {
      setDrawError(`The captured engine frame could not be displayed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [state.frame]);
  let passed = 0;
  let failed = 0;
  if (state.report !== null) for (const file of state.report.files) for (const test of file.cases) {
    if (test.ok) passed += 1;
    else failed += 1;
  }
  const status = state.phase === "preparing" ? "Saving accepted edits and reading saved test files…"
    : state.phase === "running" ? "Running saved tests on the real engine…"
    : state.phase === "closed" ? "This project's saved-test session is closed."
    : state.phase === "failed" ? "Saved tests could not complete."
    : state.report === null ? "No saved tests have run yet."
    : state.report.files.length === 0 ? "No *.spec.prg files were found in this project."
    : `${state.report.failures.length > 0 ? "Failed" : "Passed"}: ${passed} passing cases, ${failed} failing cases, ${state.report.skipped.length} skipped cases.`;
  return (
    <section class="tkr-creator-tests" aria-label="Saved RPGCode tests">
      <h2>Saved tests</h2>
      <p>Run this project's saved <code>*.spec.prg</code> files with the same framework as the command line. Accepted edits are saved first; a failed or racing save starts nothing.</p>
      <p>Keep test-only boards, characters and graphics under <code>.tkr-tests/</code>. They are not included in game packages.</p>
      <form onSubmit={(event) => { event.preventDefault(); void controller.run({ seed: Number(seed), name }); }}>
        <label>Seed <input name="creator-test-seed" type="number" min="0" max="4294967295" step="1" required value={seed} disabled={busy} onInput={(event) => setSeed(event.currentTarget.value)} /></label>
        <label>Case name contains <input name="creator-test-name" value={name} disabled={busy} onInput={(event) => setName(event.currentTarget.value)} /></label>
        <button type="submit" disabled={busy || state.phase === "closed"}>Run saved tests</button>
      </form>
      <p role="status">{status}</p>
      {state.message === null ? null : <p role="alert">{state.message}</p>}
      {drawError === null ? null : <p role="alert">{drawError}</p>}
      {state.frame === null ? null : (
        <figure>
          <canvas ref={canvas} width={state.frame.width} height={state.frame.height} aria-label="Last real fixture engine frame" />
          <figcaption>Actual fixture engine frame at tick {state.frame.tick}. Drawing changes no input or state hash.</figcaption>
        </figure>
      )}
      {state.report === null ? null : (
        <>
          <p>These results describe the saved revisions below. Later edits do not change this run; run saved tests again to test them.</p>
          {state.report.warnings.length === 0 ? null : <ul aria-label="Test warnings">{state.report.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          {state.report.skipped.length === 0 ? null : <ul aria-label="Skipped tests">{state.report.skipped.map((skipped) => <li key={skipped}>{skipped}</li>)}</ul>}
          <ul class="tkr-creator-test-files" aria-label="Saved test files">
            {state.report.files.map((file) => (
              <li key={file.file}>
                <h3><button type="button" onClick={() => { void controller.openSource(file.file, 1, 1); }}>{file.file}</button></h3>
                {file.failures.length === 0 ? null : <ul aria-label={`Failures in ${file.file}`}>{file.failures.map((failure, index) => <li key={index}>{failure}</li>)}</ul>}
                <ul aria-label={`Cases in ${file.file}`}>
                  {file.cases.map((test, caseIndex) => (
                    <li key={caseIndex}>
                      <h4>{test.ok ? "Pass" : "Fail"}: {[...test.groups, test.name].join(" > ")}</h4>
                      <table>
                        <thead><tr><th scope="col">Result</th><th scope="col">Check</th><th scope="col">Expected</th><th scope="col">Actual</th><th scope="col">Source</th><th scope="col">Fixture context</th></tr></thead>
                        <tbody>{test.outcomes.map((outcome, index) => (
                          <tr key={index} data-outcome={outcome.kind}>
                            <td>{outcome.kind}</td><td>{outcome.label}</td><td><code>{outcome.expected}</code></td><td><code>{outcome.actual}</code></td>
                            <td><button type="button" title={`${outcome.sourcePath}:${outcome.line}:${outcome.column}`} onClick={() => { void controller.openSource(outcome.sourcePath, outcome.line, outcome.column); }}>Line {outcome.line}, column {outcome.column}</button></td>
                            <td>{outcome.context === undefined ? "No gameplay fixture" : (
                              <>
                                Tick {outcome.context.tick}; board {outcome.context.board ?? "not entered"}; {outcome.context.lastAction === null ? "no action completed yet" : `after ${outcome.context.lastAction.action} for ${outcome.context.lastAction.ticks} ticks, completed at tick ${outcome.context.lastAction.completedTick}`}.
                              </>
                            )}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                      <p>Final state hash: <code>{test.stateHash}</code></p>
                      {test.run === undefined ? null : (
                        <>
                          <details><summary>Saved run snapshot and fixture</summary><pre>{JSON.stringify(test.run.snapshot, null, 2)}</pre></details>
                          <details><summary>Consumed input, checkpoints and loaded files</summary><pre>{JSON.stringify({ actionLog: test.run.actionLog, checkpoints: test.run.checkpoints, loaded: test.run.loaded, ticks: test.run.ticks }, null, 2)}</pre></details>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <details><summary>Saved file revisions supplied to the framework</summary><pre>{JSON.stringify(state.report.sources, null, 2)}</pre></details>
        </>
      )}
    </section>
  );
}
