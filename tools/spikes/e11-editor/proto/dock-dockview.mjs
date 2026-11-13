// dockview (MIT core, vanilla build) hosting the Preact panels through its framework-neutral `createComponent` contract.
import { createDockview } from "dockview";
import "dockview/dist/styles/dockview.css";
import "./spike.css";
import { exposeProbe, knownKind, mountPanel } from "./panels.mjs";

export function startDockview({ keyboardLayer } = {}) {
  const root = document.getElementById("dock");
  const options = {
    className: "dockview-theme-light",
    createComponent({ name }) {
      const element = document.createElement("div");
      element.className = "spike-panel";
      let handle;
      return {
        element,
        init(parameters) {
          handle = mountPanel(name, element, parameters.params ?? {});
        },
        dispose() {
          handle?.dispose();
        },
      };
    },
  };
  let api = createDockview(root, options);

  const initial = () => {
    api.addPanel({ id: "files", component: "files", title: "Files" });
    api.addPanel({ id: "view-1", component: "board", title: "Board view 1", params: { identity: "Boards/start.brd", viewId: "view-1" }, position: { referencePanel: "files", direction: "right" } });
    api.addPanel({ id: "properties", component: "properties", title: "Properties", position: { referencePanel: "view-1", direction: "right" } });
  };
  initial();

  const adapter = {
    features: { tabs: true, split: true, float: true, popout: true, persist: true },
    groups: () => api.groups.length,
    panels: () => api.panels.map((panel) => panel.id),
    addTab() {
      api.addPanel({ id: "outline", component: "properties", title: "Outline", position: { referencePanel: "properties", direction: "within" } });
    },
    split() {
      api.addPanel({ id: "view-2", component: "board", title: "Board view 2", params: { identity: "Boards/start.brd", viewId: "view-2" }, position: { referencePanel: "view-1", direction: "below" } });
    },
    move(id, targetId) {
      const target = api.getPanel(targetId).group;
      api.getPanel(id).api.moveTo({ group: target, position: "center" });
      return api.getPanel(id).group === target;
    },
    close(id) {
      api.getPanel(id).api.close();
    },
    reopen(id) {
      api.addPanel({ id, component: "board", title: id === "view-1" ? "Board view 1" : "Board view 2", params: { identity: "Boards/start.brd", viewId: id } });
    },
    float(id) {
      api.addFloatingGroup(api.getPanel(id));
      return api.getPanel(id).group.api.location.type;
    },
    save: () => JSON.stringify(api.toJSON()),
    restore(json) {
      api.dispose();
      root.replaceChildren();
      api = createDockview(root, options);
      api.fromJSON(JSON.parse(json));
      return api.panels.length;
    },
    unknownKind(json) {
      const data = JSON.parse(json);
      const first = Object.keys(data.panels)[0];
      data.panels[first].contentComponent = "removed-plugin-panel";
      try {
        adapter.restore(JSON.stringify(data));
        // dockview renders a panel's content when it is first shown, so show the changed one.
        api.getPanel(first)?.api.setActive();
        return { threw: false, placeholder: !!document.querySelector(".spike-missing"), panels: api.panels.length, known: knownKind("removed-plugin-panel") };
      } catch (error) {
        return { threw: true, message: String(error) };
      }
    },
    api: () => api,
  };
  exposeProbe("dockview", adapter);
  if (keyboardLayer) keyboardLayer(() => api, root);
}
