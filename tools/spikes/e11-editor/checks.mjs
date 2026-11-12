// Checks shared by the spike specs (Chromium over HTTP and Electron over app://).
import { violations } from "./probe.mjs";

export const describeFocus = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return "body";
  return `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""}:${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}`;
};

/** The keyboard-only scenario for dockview plus our layer (proto/dock-keyboard.mjs). Returns one entry per step. */
export async function runKeyboardSteps(page) {
  await page.evaluate(() => window.spike.addTab());
  await page.waitForTimeout(200);
  const focus = () => page.evaluate(describeFocus);
  const status = () => page.locator("#spike-status").textContent();
  const groupOf = (id) => page.evaluate((panelId) => window.spike.api().getPanel(panelId)?.group.id, id);
  const steps = [];
  const step = async (label, keys, check) => {
    for (const key of keys) await page.keyboard.press(key);
    await page.waitForTimeout(120);
    const entry = { label, keys, focus: await focus(), status: await status() };
    entry.pass = await check(entry);
    steps.push(entry);
  };
  await page.evaluate(() => document.activeElement?.blur());
  await step("F6 enters the first group", ["F6"], (e) => /tab.*Files/.test(e.focus));
  await step("F6 goes to the next group", ["F6"], (e) => /tab.*Board view 1/.test(e.focus));
  await step("F6 again", ["F6"], (e) => /tab.*(Properties|Outline)/.test(e.focus));
  await step("Shift+F6 goes back", ["Shift+F6"], (e) => /tab.*Board view 1/.test(e.focus));
  await step("Enter on the active tab visits the panel", ["Enter"], (e) => /^input/.test(e.focus));
  await step("F6 from inside a panel returns to the dock", ["Shift+F6", "F6"], (e) => /tab.*Board view 1/.test(e.focus));
  const propertiesGroup = await groupOf("properties");
  await step("Alt+Shift+ArrowRight moves the panel into the right group", ["Alt+Shift+ArrowRight"], async (e) => /tab.*Board view 1/.test(e.focus) && (await groupOf("view-1")) === propertiesGroup);
  const groupsBefore = await page.evaluate(() => window.spike.api().groups.length);
  await step("Alt+Shift+ArrowDown splits the group downwards", ["Alt+Shift+ArrowDown"], async (e) => /tab.*Board view 1/.test(e.focus) && (await page.evaluate(() => window.spike.api().groups.length)) === groupsBefore + 1);
  const widthBefore = await page.evaluate(() => window.spike.api().getPanel("view-1").group.api.width);
  await step("Ctrl+Shift+ArrowLeft narrows the group", ["Control+Shift+ArrowLeft"], async () => (await page.evaluate(() => window.spike.api().getPanel("view-1").group.api.width)) < widthBefore);
  await step("Delete closes the last tab of a group and focus lands on another group's tab", ["Delete"], async (e) => /tab/.test(e.focus) && !(await page.evaluate(() => window.spike.panels())).includes("view-1"));
  for (let i = 0; i < 4 && !/tab.*(Properties|Outline)/.test(await focus()); i++) await page.keyboard.press("F6");
  const inPair = await focus();
  await step("Arrow keys still rove within a two-tab group", [/Outline/.test(inPair) ? "ArrowLeft" : "ArrowRight"], (e) => /tab.*(Properties|Outline)/.test(e.focus) && e.focus !== inPair);
  return steps;
}

export async function monacoChecks(page) {
  await page.waitForFunction(() => window.__monaco?.ready === true, null, { timeout: 20_000 });
  await page.waitForTimeout(500);
  const checks = {};
  checks.afterCreate = await violations(page);
  checks.render = await page.evaluate(() => {
    const tops = (selector) => {
      const nodes = [...document.querySelectorAll(selector)];
      return { count: nodes.length, distinctTops: new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().top))).size };
    };
    const keyword = [...document.querySelectorAll(".view-line span span")].find((span) => span.textContent === "method");
    const identifier = document.querySelector(".view-lines");
    const current = document.querySelector(".current-line");
    return {
      lineNumbers: tops(".line-numbers"),
      viewLines: tops(".view-line"),
      keywordColour: keyword ? getComputedStyle(keyword).color : null,
      identifierColour: identifier ? getComputedStyle(identifier).color : null,
      currentLineWidth: current ? Math.round(current.getBoundingClientRect().width) : null,
      styleElements: document.querySelectorAll("style").length,
      adoptedStyleSheets: document.adoptedStyleSheets.length,
    };
  });
  checks.render.tokensColoured = checks.render.keywordColour !== null && checks.render.keywordColour !== checks.render.identifierColour;
  checks.render.linesPositioned = checks.render.viewLines.count > 1 && checks.render.viewLines.distinctTops === checks.render.viewLines.count;

  await page.locator(".monaco-editor .view-lines").click({ position: { x: 5, y: 5 } });
  await page.evaluate(() => {
    const editor = window.__monaco.editor;
    editor.setPosition(editor.getModel().getFullModelRange().getEndPosition());
  });
  await page.keyboard.type("\ncount");
  checks.typed = await page.evaluate(() => window.__monaco.editor.getValue().endsWith("\ncount"));
  await page.keyboard.press("Control+Space");
  await page.waitForTimeout(1200);
  checks.suggest = await page.evaluate(() => {
    const widget = document.querySelector(".suggest-widget.visible");
    return { visible: !!widget, rows: widget ? widget.querySelectorAll(".monaco-list-row").length : 0, labels: widget ? [...widget.querySelectorAll(".monaco-list-row .label-name")].map((el) => el.textContent).slice(0, 5) : [] };
  });
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  checks.undone = await page.evaluate(() => !window.__monaco.editor.getValue().endsWith("\ncount"));
  await page.keyboard.press("ControlOrMeta+f");
  await page.waitForTimeout(500);
  checks.find = await page.evaluate(async () => {
    await document.fonts.ready;
    const codicon = [...document.fonts].find((face) => /codicon/i.test(face.family));
    return { visible: !!document.querySelector(".find-widget.visible"), codiconFont: codicon ? codicon.status : "not declared" };
  });
  await page.keyboard.press("Escape");
  checks.worker = await page.evaluate(() => ({ created: window.__monaco.workers, messages: window.__monaco.workerMessages, errors: window.__monaco.workerErrors }));
  checks.afterUse = await violations(page);
  return checks;
}

export async function codemirrorChecks(page) {
  await page.waitForFunction(() => window.__cm?.ready === true, null, { timeout: 20_000 });
  await page.waitForTimeout(300);
  const checks = {};
  checks.afterCreate = await violations(page);
  checks.render = await page.evaluate(() => {
    const root = document.getElementById("editor").shadowRoot ?? document;
    const tops = (selector) => {
      const nodes = [...root.querySelectorAll(selector)];
      return { count: nodes.length, distinctTops: new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().top))).size };
    };
    const spans = [...root.querySelectorAll(".cm-line span")];
    const keyword = spans.find((span) => span.textContent === "method");
    const plain = root.querySelector(".cm-line");
    return {
      lineNumbers: tops(".cm-lineNumbers .cm-gutterElement"),
      viewLines: tops(".cm-line"),
      keywordColour: keyword ? getComputedStyle(keyword).color : null,
      identifierColour: plain ? getComputedStyle(plain).color : null,
      activeLine: !!root.querySelector(".cm-activeLine"),
      shadowRoot: root !== document,
      styleElements: root.querySelectorAll("style").length + (root === document ? 0 : document.querySelectorAll("style").length),
      adoptedStyleSheets: root.adoptedStyleSheets.length,
    };
  });
  checks.render.tokensColoured = checks.render.keywordColour !== null && checks.render.keywordColour !== checks.render.identifierColour;
  checks.render.linesPositioned = checks.render.viewLines.count > 1 && checks.render.viewLines.distinctTops === checks.render.viewLines.count;
  await page.locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("\ncount");
  checks.typed = await page.evaluate(() => window.__cm.view.state.doc.toString().endsWith("\ncount"));
  await page.keyboard.press("Control+Space");
  await page.waitForTimeout(500);
  checks.suggest = { visible: await page.locator(".cm-tooltip-autocomplete").isVisible().catch(() => false) };
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  checks.undone = await page.evaluate(() => !window.__cm.view.state.doc.toString().endsWith("\ncount"));
  await page.keyboard.press("ControlOrMeta+f");
  await page.waitForTimeout(300);
  checks.find = { visible: await page.locator(".cm-search").isVisible().catch(() => false) };
  checks.afterUse = await violations(page);
  return checks;
}

