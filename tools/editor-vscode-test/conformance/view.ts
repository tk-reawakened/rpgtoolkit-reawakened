// Reads and drives one mounted `editor-ui` view the way a person does: through its field, its buttons and what it shows.
// Both drivers use it, so a case reads the same DOM whichever host mounted the view.

export type Act = (callback: () => void | Promise<void>) => Promise<void> | void;

/** Let microtasks and macrotasks run: messages, promise chains and host events (no clock is read). */
export async function settle(act: Act, rounds = 8): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
  }
}

export class MountedView {
  readonly element: HTMLElement;
  readonly #act: Act;

  constructor(element: HTMLElement, act: Act) {
    this.element = element;
    this.#act = act;
  }

  #field(): HTMLInputElement {
    const field = this.element.querySelector<HTMLInputElement>(".tkr-settings input");
    if (field === null) throw new Error("the view shows no title field");
    return field;
  }

  #button(label: string): HTMLButtonElement {
    const button = [...this.element.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => candidate.textContent?.trim() === label);
    if (button === undefined) throw new Error(`the view shows no "${label}" button: ${this.text()}`);
    return button;
  }

  title(): string {
    return this.#field().value;
  }

  status(): string {
    return this.element.querySelector(".tkr-settings-state")?.textContent ?? "";
  }

  alerts(): readonly string[] {
    return [...this.element.querySelectorAll('[role="alert"]')].map((node) => node.textContent ?? "");
  }

  text(): string {
    return this.element.textContent ?? "";
  }

  conflictShown(): boolean {
    return this.element.querySelector(".tkr-settings-conflict") !== null;
  }

  /** Whether a visible action with this label exists. */
  hasButton(label: string): boolean {
    return [...this.element.querySelectorAll<HTMLButtonElement>("button")].some((candidate) => candidate.textContent?.trim() === label);
  }

  /** Type `title` and explicitly apply it as one command. */
  async type(title: string): Promise<void> {
    const field = this.#field();
    await this.#act(() => {
      field.value = title;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await this.click("Apply changes");
  }

  async click(label: string): Promise<void> {
    const button = this.#button(label);
    if (button.disabled) throw new Error(`the "${label}" button is disabled`);
    await this.#act(() => {
      button.click();
    });
  }
}
