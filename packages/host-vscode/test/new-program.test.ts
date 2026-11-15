// The new-program question of the VS Code host (story 11.7): the model makes the file, the host only asks.
import { deepEqual, equal, ok } from "node:assert/strict";
import { test } from "node:test";
import { createMemoryPlatformServices } from "@tk-reawakened/platform-services/testing";
import { runNewProgram, type NewProgramUi } from "../src/new-program.ts";

const text = (value: string): Uint8Array => Uint8Array.from(value, (ch) => ch.charCodeAt(0));

function ask(answer: string | undefined): { readonly ui: NewProgramUi; readonly seen: { value: string; prompt: string; validate: (value: string) => string | null }[] } {
  const seen: { value: string; prompt: string; validate: (value: string) => string | null }[] = [];
  return {
    seen,
    ui: {
      input: (question) => {
        seen.push({ value: question.value, prompt: question.prompt, validate: question.validate });
        return Promise.resolve(answer === undefined ? undefined : answer === "" ? question.value : answer);
      },
    },
  };
}

test("the question starts from the first free name and the file begins with the header template of the preferences", async () => {
  const host = createMemoryPlatformServices({ files: { "Prg/untitled.prg": text("x") } });
  await host.settings.set("user", "program.headerTemplate", "// {name}\n");
  const { ui, seen } = ask("");
  const outcome = await runNewProgram({ fs: host.fs, layout: { projectFolder: "" }, settings: host.settings, ui });
  deepEqual(outcome, { ok: true, path: "Prg/untitled 2.prg" });
  equal(seen[0]!.value, "Prg/untitled 2.prg");
  deepEqual(host.bytesOf("Prg/untitled 2.prg"), text("// untitled 2\r\n"));
});

test("the default header is used when no preference is set", async () => {
  const host = createMemoryPlatformServices();
  const outcome = await runNewProgram({ fs: host.fs, layout: { projectFolder: "" }, settings: host.settings, ui: ask("Prg/scene.prg").ui });
  deepEqual(outcome, { ok: true, path: "Prg/scene.prg" });
  deepEqual(host.bytesOf("Prg/scene.prg"), text("// scene.prg\r\n\r\n"));
});

test("a dismissed question creates nothing, a name that is taken is refused with the reason, and only .prg names validate", async () => {
  const host = createMemoryPlatformServices({ files: { "Prg/a.prg": text("x") } });
  const cancelled = await runNewProgram({ fs: host.fs, layout: { projectFolder: "" }, settings: host.settings, ui: ask(undefined).ui });
  ok(!cancelled.ok && cancelled.reason === "cancelled");
  const asked = ask("Prg/A.prg");
  const taken = await runNewProgram({ fs: host.fs, layout: { projectFolder: "" }, settings: host.settings, ui: asked.ui });
  ok(!taken.ok && taken.reason === "refused" && taken.message.includes("already exists"));
  deepEqual(host.bytesOf("Prg/a.prg"), text("x"));
  equal(asked.seen[0]!.validate("Prg/b.txt"), "A program's name ends in .prg.");
  equal(asked.seen[0]!.validate("Prg/b.prg"), null);
});
