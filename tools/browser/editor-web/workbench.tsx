import { createWorkbench, openWebProject, type Workbench, type WebProject } from "@tk-reawakened/host-web";

// The production browser workbench over one project folder: the page only picks the folder and gives the workbench an
// element; Files, Game, tabs, the board editors, "New board…" and the shared tileset browser are `host-web` and `editor-ui`.
const status = document.querySelector<HTMLElement>("#host-status")!;
const root = document.querySelector<HTMLElement>("#workbench")!;
const button = document.querySelector<HTMLButtonElement>("#open-project")!;
let open: { readonly project: WebProject; readonly workbench: Workbench } | null = null;

button.addEventListener("click", () => {
  void (async () => {
    const project = await openWebProject();
    if (project === null) {
      status.textContent = "A persistent project folder could not be registered.";
      return;
    }
    open?.workbench.dispose();
    open?.project.deactivate();
    root.replaceChildren();
    open = { project, workbench: createWorkbench(project, root) };
    status.textContent = `${project.project.name} (project folder; changes write to disk)`;
  })().catch((error: unknown) => {
    status.textContent = error instanceof Error ? error.message : String(error);
  });
});
