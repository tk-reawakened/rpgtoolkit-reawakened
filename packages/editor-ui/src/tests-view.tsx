import { useState } from "preact/hooks";
import type { CreatorTestsController } from "./creator-tests-controller.ts";
import { CreatorTestsView } from "./creator-tests-view.tsx";

export interface TestsViewProps {
  readonly controller: CreatorTestsController;
}

/**
 * The Tests section of the left sidebar (TOOL-5; ADR 0022 D9): the project's saved tests, folded up until it is opened,
 * like Files and Game. Saved tests are their own launch, not a run setup (D8.7), so they live here rather than under the
 * Run button.
 */
export function TestsView({ controller }: TestsViewProps) {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <section class="tkr-tests" aria-label="Tests" data-collapsed={collapsed ? "true" : "false"}>
      <h2 class="tkr-tests-heading">
        <button type="button" class="tkr-accordion-toggle" aria-expanded={!collapsed} onClick={() => setCollapsed((previous) => !previous)}>
          Tests
        </button>
      </h2>
      <div class="tkr-tests-body" hidden={collapsed}><CreatorTestsView controller={controller} /></div>
    </section>
  );
}
