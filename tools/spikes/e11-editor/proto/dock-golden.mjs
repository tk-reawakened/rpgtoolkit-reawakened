// golden-layout 2 (MIT) hosting the Preact panels through registered factory functions.
import { GoldenLayout, LayoutConfig } from "golden-layout";
import "golden-layout/dist/css/goldenlayout-base.css";
import "golden-layout/dist/css/themes/goldenlayout-light-theme.css";
import "./spike.css";
import { exposeProbe, knownKind, mountPanel } from "./panels.mjs";

export function startGolden() {
  const root = document.getElementById("dock");
  let layout;
  const create = () => {
    root.replaceChildren();
    layout = new GoldenLayout(root);
    for (const kind of ["files", "board", "properties"]) {
      layout.registerComponentFactoryFunction(kind, (container, state) => {
        const handle = mountPanel(kind, container.element, state ?? {});
        container.on("beforeComponentRelease", () => handle.dispose());
        return undefined;
      });
    }
    layout.resizeWithContainerAutomatically = true;
  };
  create();
  const board = (viewId) => ({ type: "component", componentType: "board", title: `Board ${viewId.replace("-", " ")}`, id: viewId, componentState: { identity: "Boards/start.brd", viewId } });
  layout.loadLayout({
    root: {
      type: "row",
      content: [
        { type: "component", componentType: "files", title: "Files", id: "files" },
        board("view-1"),
        { type: "component", componentType: "properties", title: "Properties", id: "properties" },
      ],
    },
  });
  const find = (id) => layout.findFirstComponentItemById(id);
  const items = () => {
    const found = [];
    const walk = (item) => {
      if (item.isComponent) found.push(item.id);
      for (const child of item.contentItems ?? []) walk(child);
    };
    if (layout.rootItem) walk(layout.rootItem);
    return found;
  };

  const adapter = {
    features: { tabs: true, split: true, float: "popout window only", popout: true, persist: true },
    panels: items,
    addTab() {
      find("properties").parent.addItem({ type: "component", componentType: "properties", title: "Outline", id: "outline" });
    },
    split() {
      // A second item in the same stack would be a tab; a split is a new stack beside it in the row.
      const stack = find("view-1").parent;
      const row = stack.parent;
      row.addItem(board("view-2"), row.contentItems.indexOf(stack) + 1);
    },
    close(id) {
      find(id).close();
    },
    reopen(id) {
      layout.addItem(board(id));
    },
    save: () => JSON.stringify(LayoutConfig.fromResolved(layout.saveLayout())),
    restore(json) {
      layout.destroy();
      create();
      layout.loadLayout(JSON.parse(json));
      return items().length;
    },
    unknownKind(json) {
      const data = JSON.parse(json);
      const walk = (item) => {
        if (item.type === "component" && item.componentType === "files") item.componentType = "removed-plugin-panel";
        for (const child of item.content ?? []) walk(child);
      };
      walk(data.root);
      try {
        const count = adapter.restore(JSON.stringify(data));
        return { threw: false, placeholder: !!document.querySelector(".spike-missing"), panels: count, known: knownKind("removed-plugin-panel") };
      } catch (error) {
        return { threw: true, message: String(error) };
      }
    },
  };
  exposeProbe("golden-layout", adapter);
}
