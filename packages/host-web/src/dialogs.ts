import type { DialogChoice, DialogQuestion, DialogService, SavePathRequest } from "@tk-reawakened/platform-services";

let dialogsMade = 0;

/**
 * `dialogs` for a browser page: a modal `<dialog>` built from DOM nodes, so it needs no inline script or style under the
 * page's strict policy. Escape or the close box answers the question's `cancel`; a Save As dialog dismissed the same way
 * answers `null` (AD-20, ADR 0022 D3.4, D3.6).
 */
export function createPageDialogs(page: Document): DialogService {
  const open = <T>(build: (dialog: HTMLDialogElement, finish: (answer: T) => void) => T): Promise<T> =>
    new Promise((resolve) => {
      const dialog = page.createElement("dialog");
      dialog.className = "tkr-dialog";
      let settled = false;
      const finish = (answer: T): void => {
        if (settled) return;
        settled = true;
        if (dialog.open) dialog.close();
        dialog.remove();
        resolve(answer);
      };
      const dismissed = build(dialog, finish);
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        finish(dismissed);
      });
      page.body.append(dialog);
      dialog.showModal();
    });

  const paragraph = (text: string, id: string): HTMLParagraphElement => {
    const element = page.createElement("p");
    element.id = id;
    element.textContent = text;
    return element;
  };

  return {
    ask<Id extends string>(question: DialogQuestion<Id>): Promise<Id> {
      return open<Id>((dialog, finish) => {
        dialogsMade += 1;
        const messageId = `tkr-dialog-${dialogsMade}-message`;
        const detailId = `tkr-dialog-${dialogsMade}-detail`;
        dialog.setAttribute("aria-labelledby", messageId);
        dialog.setAttribute("aria-describedby", detailId);
        const buttons = page.createElement("div");
        buttons.className = "tkr-dialog-buttons";
        buttons.append(...question.choices.map((choice: DialogChoice<Id>) => {
          const button = page.createElement("button");
          button.type = "button";
          button.textContent = choice.label;
          button.addEventListener("click", () => finish(choice.id));
          return button;
        }));
        dialog.append(paragraph(question.message, messageId), paragraph(question.detail, detailId), buttons);
        return question.cancel;
      });
    },
    pickSavePath(request: SavePathRequest): Promise<string | null> {
      return open<string | null>((dialog, finish) => {
        dialogsMade += 1;
        const inputId = `tkr-dialog-${dialogsMade}-path`;
        const form = page.createElement("form");
        form.method = "dialog";
        const label = page.createElement("label");
        label.htmlFor = inputId;
        label.textContent = `Save ${request.document} as`;
        const input = page.createElement("input");
        input.id = inputId;
        input.type = "text";
        input.value = request.suggested;
        const save = page.createElement("button");
        save.type = "submit";
        save.textContent = "Save";
        const cancel = page.createElement("button");
        cancel.type = "button";
        cancel.textContent = "Cancel";
        cancel.addEventListener("click", () => finish(null));
        form.addEventListener("submit", (event) => {
          event.preventDefault();
          const path = input.value.trim();
          finish(path === "" ? null : path);
        });
        form.append(label, input, save, cancel);
        dialog.setAttribute("aria-label", `Save ${request.document} as`);
        dialog.append(form);
        return null;
      });
    },
  };
}
