import { deepEqual, equal } from "node:assert/strict";
import { test } from "node:test";
import {
  advanceScriptTick,
  commandDocumentation,
  createGameState,
  createScriptServices,
  hashState,
  startProgram,
  type BuiltinSpec,
  type PluginDefinition,
  validateCommandDocumentation,
} from "../src/index.ts";
const call = () => ({ value: null });

function plugin(command: BuiltinSpec, doc?: PluginDefinition["doc"]): PluginDefinition {
  return { id: "fixture.docs", version: "1.0.0", commands: [command], ...(doc === undefined ? {} : { doc }) };
}

function resolved(definition: PluginDefinition) {
  return [{ definition }];
}

test("projection copies extended docs, params and aliases as plain data", () => {
  const definition = plugin({
    name: "measure",
    aliases: ["m"],
    params: [{
      name: "distance",
      optional: false,
      byRef: false,
      variadic: false,
      doc: {
        summary: "Distance to measure.",
        unit: "pixels",
        tags: ["legacy"],
        support: { headless: { level: "full" }, harness: { level: "partial", note: "Uses the harness clock." } },
        default: "Zero pixels when omitted.",
        ifOmitted: "No by-reference write occurs when omitted.",
        range: { min: 0, max: 100, note: "Fixture measurement range." },
        values: [{ value: "0", summary: "No distance." }],
        type: "number",
        since: "1.0",
      },
    }],
    call,
    doc: {
      summary: "Measure a distance.",
      behaviour: "Returns the distance in pixels without waiting.",
      examples: [{ code: "x = measure(4)", caption: "Measure four pixels.", result: "4" }],
      groups: ["fixtures", "measurement"],
      returns: { summary: "The measured distance.", unit: "pixels" },
      throws: [{ code: "bad-arg", when: "The distance is not numeric." }],
      see: ["measure", "docs/spec/engine/rpgcode-functions.md#fixtures"],
      since: "1.0",
      waits: { kind: "never", summary: "Never waits." },
      effects: ["ui"],
      todo: ["Add a fractional example."],
      author: "Fixture Author",
      license: "MIT",
      tags: ["legacy", "deprecated"],
      replacedBy: { kind: "command", name: "measure" },
      reason: "Use the newer measurement spelling.",
      support: { headless: { level: "full" }, renderer: { level: "none", note: "Rendering is not implemented." } },
    },
  });
  const entries = commandDocumentation(resolved(definition));
  deepEqual(entries.map((entry) => `${entry.name}:${entry.tags.join(",")}`), ["measure:legacy,deprecated", "m:legacy,deprecated,alias"]);
  equal(entries[0]?.plugin, null);
  deepEqual(entries[0]?.groups, ["fixtures", "measurement"]);
  deepEqual(entries[0]?.replacedBy, { kind: "command", name: "measure" });
  deepEqual(entries[0]?.examples, [{ code: "x = measure(4)", caption: "Measure four pixels.", result: "4" }]);
  deepEqual(entries[0]?.returns, { summary: "The measured distance.", unit: "pixels" });
  deepEqual(entries[0]?.params[0], {
    name: "distance", optional: false, byRef: false, variadic: false,
    summary: "Distance to measure.", unit: "pixels", tags: ["legacy"],
    support: { headless: { level: "full" }, harness: { level: "partial", note: "Uses the harness clock." } },
    default: "Zero pixels when omitted.", ifOmitted: "No by-reference write occurs when omitted.",
    range: { min: 0, max: 100, note: "Fixture measurement range." },
    values: [{ value: "0", summary: "No distance." }], type: "number", since: "1.0",
  });
  equal("call" in (entries[0] as object), false);
  equal(JSON.parse(JSON.stringify(entries[0])).name, "measure");
});

test("projection copies plugin documentation and internal access", () => {
  const definition = plugin({ name: "hidden", aliases: [], params: [], call, doc: { summary: "Hidden command.", behaviour: "Does not wait.", access: "internal" } }, {
    summary: "Fixture plugin.",
    groups: [{ id: "fixtures", name: "Fixtures", summary: "Fixture commands." }],
    requires: ["fixture.docs"],
  });
  const entry = commandDocumentation(resolved(definition))[0]!;
  equal(entry.access, "internal");
  deepEqual(entry.plugin, { summary: "Fixture plugin.", groups: [{ id: "fixtures", name: "Fixtures", summary: "Fixture commands." }], requires: ["fixture.docs"] });
});

test("missing transitional documentation is explicit null output and allowlist-exempt", () => {
  const definition = plugin({ name: "oldcommand", aliases: [], params: [], call });
  const entries = commandDocumentation(resolved(definition));
  equal(entries[0]?.summary, null);
  equal(entries[0]?.behaviour, null);
  deepEqual(entries[0]?.tags, []);
  equal(entries[0]?.support, null);
  equal(validateCommandDocumentation(resolved(definition), [], ["fixture.docs/oldcommand"]).length, 0);
  equal(validateCommandDocumentation(resolved(definition), [], []).some((item) => item.code === "doc.required"), true);
});

test("validator reports replacement, conflict, see, waits and parameter failures", () => {
  const definition = plugin({
    name: "obsolete",
    aliases: ["old"],
    params: [{ name: "value", optional: false, byRef: false, variadic: false, doc: { summary: "Value", tags: ["alias"], support: { headless: { level: "none" } }, range: { min: 2, max: 1 }, values: [{ value: "", summary: "" }], type: "" } }],
    call,
    doc: { summary: "Obsolete.", behaviour: "It does something.", tags: ["obsolete", "experimental"], see: ["missing"], waits: { kind: "ticks", summary: "Waits briefly." } },
  });
  const diagnostics = validateCommandDocumentation(resolved(definition), [
    { name: "obsolete", purpose: "Obsolete.", obsolete: true, section: "Test" },
    { name: "old", purpose: "Obsolete.", aliasOf: "obsolete", obsolete: true, section: "Test" },
  ], []);
  equal(diagnostics.some((item) => item.code === "doc.tag-conflict"), true);
  equal(diagnostics.some((item) => item.code === "doc.replacement"), true);
  equal(diagnostics.some((item) => item.code === "doc.see"), true);
  equal(diagnostics.some((item) => item.code === "doc.waits"), true);
  equal(diagnostics.some((item) => item.code === "param.range"), true);
  equal(diagnostics.some((item) => item.code === "param.tag" || item.code === "doc.tag"), true);
  equal(diagnostics.some((item) => item.code === "support.note"), true);
  equal(diagnostics.some((item) => item.code === "param.value"), true);
  equal(diagnostics.some((item) => item.code === "param.type"), true);
});

test("projection preserves host-request waits and syntax replacement targets", () => {
  const definition = plugin({
    name: "continuation",
    aliases: [],
    params: [],
    call,
    doc: {
      summary: "Continue a host request.",
      behaviour: "Resume after the host replies; this command waits for the host request.",
      waits: { kind: "host-request", summary: "Resumes only after the host asset request replies." },
      tags: ["obsolete"],
      replacedBy: { kind: "syntax", text: "host continuation syntax" },
      reason: "Fixture replacement syntax.",
    },
  });
  const entry = commandDocumentation(resolved(definition))[0]!;
  deepEqual(entry.waits, { kind: "host-request", summary: "Resumes only after the host asset request replies." });
  deepEqual(entry.replacedBy, { kind: "syntax", text: "host continuation syntax" });
});

test("validator enforces native and plugin-owned groups", () => {
  const definition = plugin({ name: "grouped", aliases: [], params: [], call, doc: { summary: "Grouped.", behaviour: "Does not wait.", groups: ["wrong"] } }, {
    summary: "Fixture plugin.",
    groups: [{ id: "declared", name: "Declared", summary: "Owned group." }],
  });
  const diagnostics = validateCommandDocumentation(resolved(definition), [{ name: "grouped", purpose: "Grouped.", section: "Test Section" }], []);
  equal(diagnostics.some((item) => item.code === "doc.group-unknown"), true);
  equal(diagnostics.some((item) => item.code === "native.group"), true);
});

test("projection preserves plugin and declaration order including overridden layers", () => {
  const first = plugin({ name: "same", aliases: [], params: [], call, doc: { summary: "First", behaviour: "First." } });
  const second: PluginDefinition = { ...plugin({ name: "same", aliases: [], params: [], call, doc: { summary: "Second", behaviour: "Second." } }), id: "fixture.second" };
  deepEqual(commandDocumentation([...resolved(first), ...resolved(second)]).map((item) => `${item.pluginId}/${item.name}`), [
    "fixture.docs/same",
    "fixture.second/same",
  ]);
});

test("documentation metadata never enters the state hash", () => {
  const withoutDocs = plugin({ name: "doccommand", aliases: [], params: [], call });
  const withDocs = plugin({
    name: "doccommand",
    aliases: [],
    params: [],
    call,
    doc: { summary: "Run a documented command.", behaviour: "Returns no value and does not wait.", tags: ["deprecated"], replacedBy: { kind: "command", name: "doccommand" }, reason: "Fixture replacement.", support: { headless: { level: "full" } } },
  });
  const run = (definition: PluginDefinition) => {
    const state = createGameState({ seed: 4 });
    startProgram(state.vm, { kind: "inline", text: "doccommand()\nend()\n", ir: "1" });
    advanceScriptTick(state, createScriptServices(state, resolved(definition)));
    return state;
  };
  equal(hashState(run(withDocs)), hashState(run(withoutDocs)));
});
