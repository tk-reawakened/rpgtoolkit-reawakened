import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import { createUniqueWebProjectId } from "../src/projects.ts";

test("browser project identities retry UUID collisions and remain unique", () => {
  const existing = new Set(["web:duplicate"]);
  const generated: string[] = [];
  const ids = ["duplicate", "new-project"];
  const id = createUniqueWebProjectId(existing, () => {
    const next = ids.shift();
    if (next === undefined) throw new Error("UUID generator exhausted");
    generated.push(next);
    return next;
  });
  equal(id, "web:new-project");
  deepEqual(generated, ["duplicate", "new-project"]);
});
