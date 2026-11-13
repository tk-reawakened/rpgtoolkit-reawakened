// dock-spawn-ts (MIT) hosting the Preact panels. Its plain-DOM entry; the web-component entry is not used.
import { DockManager, PanelContainer, PanelType } from "dock-spawn-ts/lib/js/index.js";
import "dock-spawn-ts/lib/css/dock-manager.css";
import "dock-spawn-ts/lib/css/dock-manager-style.css";
import "./spike.css";
import { exposeProbe, knownKind, mountPanel } from "./panels.mjs";

const titles = { files: "Files", "view-1": "Board view 1", "view-2": "Board view 2", properties: "Properties", outline: "Outline" };
const kindOf = (id) => (id.startsWith("view-") ? "board" : id === "outline" ? "properties" : id);

export function startDockspawn() {
  const root = document.getElementById("dock");
  const handles = new Map();
  const content = (id, kind = kindOf(id)) => {
    const element = document.createElement("div");
    element.id = id;
    handles.set(id, mountPanel(kind, element, kind === "board" ? { identity: "Boards/start.brd", viewId: id } : {}));
    return element;
  };
  let manager;
  let panels;
  const create = () => {
    root.replaceChildren();
    manager = new DockManager(root);
    manager.getElementCallback = async (state) => ({ element: content(state.element, state.kind ?? kindOf(state.element)), title: titles[state.element] ?? state.element });
    manager.initialize();
    manager.resize(root.clientWidth, root.clientHeight);
    manager.addLayoutListener({
      onClosePanel(_manager, panel) {
        const id = panel.elementContent.id;
        handles.get(id)?.dispose();
        handles.delete(id);
      },
    });
  };
  create();
  const documentNode = () => manager.context.model.documentManagerNode;
  panels = new Map();
  const add = (id, place) => {
    const panel = new PanelContainer(content(id), manager, titles[id], id.startsWith("view-") ? PanelType.document : PanelType.panel);
    panels.set(id, panel);
    place(panel);
    return panel;
  };
  add("files", (panel) => manager.dockLeft(documentNode(), panel, 0.25));
  add("view-1", (panel) => manager.dockFill(documentNode(), panel));
  add("properties", (panel) => manager.dockRight(documentNode(), panel, 0.25));

  const adapter = {
    features: { tabs: true, split: true, float: true, popout: false, persist: true },
    panels: () => manager.getPanels().map((panel) => panel.elementContent.id),
    addTab() {
      const node = manager._findNodeFromContainer(panels.get("properties"));
      add("outline", (panel) => manager.dockFill(node, panel));
    },
    split() {
      const node = manager._findNodeFromContainer(panels.get("view-1"));
      add("view-2", (panel) => manager.dockDown(node, panel, 0.5));
    },
    close(id) {
      return panels.get(id).close();
    },
    reopen(id) {
      add(id, (panel) => manager.dockFill(documentNode(), panel));
    },
    float(id) {
      manager.floatDialog(panels.get(id), 40, 40);
      return "floating";
    },
    save: () => manager.saveState(),
    async restore(json) {
      for (const handle of handles.values()) handle.dispose();
      handles.clear();
      create();
      await manager.loadState(json);
      manager.resize(root.clientWidth, root.clientHeight);
      return manager.getPanels().length;
    },
    async unknownKind(json) {
      const data = JSON.parse(json);
      const walk = (node) => {
        if (node.containerType === "panel" && node.state.element === "files") node.state.kind = "removed-plugin-panel";
        for (const child of node.children ?? []) walk(child);
      };
      walk(data.graphInfo);
      try {
        const count = await adapter.restore(JSON.stringify(data));
        return { threw: false, placeholder: !!document.querySelector(".spike-missing"), panels: count, known: knownKind("removed-plugin-panel") };
      } catch (error) {
        return { threw: true, message: String(error) };
      }
    },
  };
  exposeProbe("dock-spawn-ts", adapter);
}
