// Runs the one host conformance suite of story 11.3 against every host: the browser host and VS Code, as its desktop
// build (which watches files) and its browser build (which does not). Each case is defined once in
// `../conformance/suite.ts`; a failure names the host and the case.
import { readFileSync } from "node:fs";
import { after, before, describe, test } from "node:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { CONFORMANCE_CASES, type ConformanceHost } from "../conformance/suite.ts";
import type { Act } from "../conformance/view.ts";

const fixture = new Uint8Array(readFileSync(new URL("../../../docs/spec/examples/game/Main/example.gam", import.meta.url)));

let act: Act;
let hosts: readonly { readonly name: string; readonly make: () => ConformanceHost }[] = [];

before(async () => {
  GlobalRegistrator.register();
  // Preact and the hosts read the DOM when they render, so they are imported once the shim is in place.
  const { act: preactAct } = await import("preact/test-utils");
  // One act at a time: a case can press Save and type while the save is held, and two overlapping acts would each
  // swap Preact's render scheduling out from under the other.
  let queue: Promise<void> = Promise.resolve();
  act = (callback) => {
    const run = queue.then(() => preactAct(callback));
    queue = run.catch(() => undefined);
    return run;
  };
  const { createWebConformanceHost } = await import("../conformance/web-host.ts");
  const { createVscodeConformanceHost } = await import("../conformance/vscode-host.ts");
  hosts = [
    { name: "browser host", make: () => createWebConformanceHost(fixture, act) },
    { name: "VS Code desktop", make: () => createVscodeConformanceHost(true, fixture, act) },
    { name: "VS Code for the Web", make: () => createVscodeConformanceHost(false, fixture, act) },
  ];
});

after(() => GlobalRegistrator.unregister());

for (const host of ["browser host", "VS Code desktop", "VS Code for the Web"]) {
  describe(`host conformance: ${host}`, () => {
    for (const conformance of CONFORMANCE_CASES) {
      test(conformance.name, async () => {
        const entry = hosts.find((candidate) => candidate.name === host);
        if (entry === undefined) throw new Error(`no ${host} driver`);
        document.body.replaceChildren();
        await conformance.run(entry.make(), fixture);
      });
    }
  });
}
