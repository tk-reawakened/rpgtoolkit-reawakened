// @lumino/widgets DockPanel (BSD-3-Clause, JupyterLab's panel system) hosting the Preact panels as Lumino widgets.
// Lumino's saveLayout() holds widget objects, so persistence maps widgets to ids and back here.
import { DockPanel, Widget } from "@lumino/widgets";
import "@lumino/widgets/style/index.css";
import "./spike.css";
import { exposeProbe, knownKind, mountPanel } from "./panels.mjs";

const titles = { files: "Files", "view-1": "Board view 1", "view-2": "Board view 2", properties: "Properties", outline: "Outline" };
const kindOf = (id) => (id.startsWith("view-") ? "board" : id === "outline" ? "properties" : id);

class PanelWidget extends Widget {
  constructor(id, kind = kindOf(id)) {
    super();
    this.id = id;
    this.kind = kind;
    this.title.label = titles[id] ?? id;
    this.title.closable = true;
    this.addClass("spike-panel");
    this.handle = mountPanel(kind, this.node, kind === "board" ? { identity: "Boards/start.brd", viewId: id } : {});
  }
  dispose() {
    if (this.isDisposed) return;
    this.handle.dispose();
    super.dispose();
  }
}

export function startLumino() {
  const root = document.getElementById("dock");
  let dock;
  const widgets = new Map();
  const create = () => {
    dock = new DockPanel();
    dock.id = "spike-dock";
    Widget.attach(dock, root);
    dock.node.classList.add("spike-fill");
  };
  window.addEventListener("resize", () => dock.update());
  create();
  const add = (id, options) => {
    const widget = new PanelWidget(id);
    widgets.set(id, widget);
    dock.addWidget(widget, options);
    return widget;
  };
  add("files");
  add("view-1", { mode: "split-right", ref: widgets.get("files") });
  add("properties", { mode: "split-right", ref: widgets.get("view-1") });
  dock.fit();

  const toIds = (area) =>
    area === null
      ? null
      : area.type === "tab-area"
        ? { ...area, widgets: area.widgets.map((widget) => ({ id: widget.id, kind: widget.kind })) }
        : { ...area, children: area.children.map(toIds) };
  const fromIds = (area) =>
    area === null
      ? null
      : area.type === "tab-area"
        ? { ...area, widgets: area.widgets.map(({ id, kind }) => new PanelWidget(id, kind)) }
        : { ...area, children: area.children.map(fromIds) };

  const adapter = {
    features: { tabs: true, split: true, float: false, popout: false, persist: "via own id mapping" },
    panels: () => [...dock.widgets()].map((widget) => widget.id),
    addTab() {
      add("outline", { mode: "tab-after", ref: widgets.get("properties") });
    },
    split() {
      add("view-2", { mode: "split-bottom", ref: widgets.get("view-1") });
    },
    close(id) {
      widgets.get(id).close();
      widgets.get(id).dispose();
    },
    reopen(id) {
      add(id, { mode: "tab-after", ref: widgets.get("view-2") ?? null });
    },
    save: () => JSON.stringify({ main: toIds(dock.saveLayout().main) }),
    restore(json) {
      for (const widget of [...dock.widgets()]) widget.dispose();
      dock.dispose();
      create();
      dock.restoreLayout({ main: fromIds(JSON.parse(json).main) });
      dock.fit();
      return [...dock.widgets()].length;
    },
    unknownKind(json) {
      const data = JSON.parse(json);
      const first = (area) => (area.type === "tab-area" ? area.widgets[0] : first(area.children[0]));
      first(data.main).kind = "removed-plugin-panel";
      try {
        const count = adapter.restore(JSON.stringify(data));
        return { threw: false, placeholder: !!document.querySelector(".spike-missing"), panels: count, known: knownKind("removed-plugin-panel") };
      } catch (error) {
        return { threw: true, message: String(error) };
      }
    },
  };
  exposeProbe("@lumino/widgets", adapter);
}
