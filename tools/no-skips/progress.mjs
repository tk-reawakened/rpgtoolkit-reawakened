// Execution-ordered events identify work still active if a CI shard stalls.
// This reporter supplements, rather than replaces, the spec, TAP and LCOV reports.
export default async function* progress(source) {
  for await (const event of source) {
    if (event.type !== "test:dequeue" && event.type !== "test:complete") continue;
    const { file, line, name } = event.data;
    yield `test-progress ${event.type === "test:dequeue" ? "start" : "finish"} ${JSON.stringify({ file: file ?? null, line: line ?? null, name })}\n`;
  }
}
