import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

export interface HelpInvokerRef {
  current: HTMLElement | null;
}

export interface HelpDocumentProps {
  readonly title: string;
  readonly markdown: string;
  readonly invoker: HelpInvokerRef;
  readonly onClose: () => void;
}

/** Markdown links are only clickable when they point to this project's HTTPS repository. */
function safeExternalHref(destination: string): string | null {
  try {
    const url = new URL(destination);
    if (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname.startsWith("/tk-reawakened/rpgtoolkit-reawakened/")
    ) return url.href;
  } catch {
    // Non-URL and malformed destinations remain ordinary text.
  }
  return null;
}

function inline(markdown: string): ComponentChildren[] {
  const parts: ComponentChildren[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;
  let offset = 0;
  for (const match of markdown.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > offset) parts.push(markdown.slice(offset, index));
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(<code key={index}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(<strong key={index}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*") && token.endsWith("*")) {
      parts.push(<em key={index}>{token.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const destination = link?.[2];
      const href = destination === undefined ? null : safeExternalHref(destination);
      parts.push(href === null ? link?.[1] ?? token : <a key={index} href={href} target="_blank" rel="noopener noreferrer">{link?.[1]}</a>);
    }
    offset = index + token.length;
  }
  if (offset < markdown.length) parts.push(markdown.slice(offset));
  return parts;
}

function renderMarkdown(markdown: string): ComponentChildren[] {
  const lines = markdown.split(/\r?\n/);
  const blocks: ComponentChildren[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!.trim();
    if (line === "" || line.startsWith("<!--")) {
      index += 1;
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading !== null) {
      blocks.push(heading[1]!.length === 1 ? <h3 key={index}>{inline(heading[2]!)}</h3> : <h4 key={index}>{inline(heading[2]!)}</h4>);
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: ComponentChildren[] = [];
      let itemIndex = 0;
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index]!)) {
        items.push(<li key={itemIndex++}>{inline(lines[index]!.trim().replace(/^[-*]\s+/, ""))}</li>);
        index += 1;
      }
      blocks.push(<ul key={index}>{items}</ul>);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: ComponentChildren[] = [];
      let itemIndex = 0;
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index]!)) {
        items.push(<li key={itemIndex++}>{inline(lines[index]!.trim().replace(/^\d+\.\s+/, ""))}</li>);
        index += 1;
      }
      blocks.push(<ol key={index}>{items}</ol>);
      continue;
    }
    if (line.startsWith("|")) {
      const table: string[] = [];
      while (index < lines.length && lines[index]!.trim().startsWith("|")) {
        const row = lines[index]!.trim();
        if (!/^\|\s*:?-{3,}/.test(row)) table.push(row);
        index += 1;
      }
      blocks.push(<pre key={index}>{table.join("\n")}</pre>);
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index]!.trim() !== "" && !/^(#{1,6}\s+|[-*]\s+|\d+\.\s+|\|)/.test(lines[index]!.trim())) {
      paragraph.push(lines[index]!.trim());
      index += 1;
    }
    blocks.push(<p key={index}>{inline(paragraph.join(" "))}</p>);
  }
  return blocks;
}

/** Read only the field's already-rendered accessible description; help never maintains a second settings catalogue. */
export function focusedFieldHelp(target: Element | null): { readonly title: string; readonly markdown: string } | null {
  if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return null;
  const field = target.closest<HTMLElement>(".tkr-pref, .tkr-settings-field");
  if (field === null) return null;
  const label = target.labels?.[0]?.textContent?.trim() || field.querySelector<HTMLElement>(".tkr-pref-label, label")?.textContent?.trim();
  if (label === undefined || label === "") return null;
  const description = (target.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent?.trim())
    .filter((text): text is string => text !== undefined && text !== "")
    .join("\n\n");
  const sourceUrl = field.classList.contains("tkr-pref")
    ? "https://github.com/tk-reawakened/rpgtoolkit-reawakened/blob/main/docs/editor-features.md"
    : "https://github.com/tk-reawakened/rpgtoolkit-reawakened/blob/main/docs/spec/formats/main-file.md#layout";
  const sourceLabel = field.classList.contains("tkr-pref") ? "Read editor preference documentation" : "Read game settings documentation";
  return {
    title: `${label} help`,
    markdown: `# ${label}\n\n${description || "No additional field description is available."}\n\n[${sourceLabel}](${sourceUrl})`,
  };
}

export function HelpDocument({ title, markdown, invoker, onClose }: HelpDocumentProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null || dialog.open) return;
    const previousFocus = invoker.current;
    if (previousFocus?.isConnected) previousFocus.focus();
    if (typeof dialog.showModal === "function") dialog.showModal();
    else {
      dialog.setAttribute("open", "");
      dialog.querySelector<HTMLElement>("[autofocus]")?.focus();
    }
    invoker.current = previousFocus;
  }, [invoker, markdown, title]);

  const close = (): void => {
    const dialog = dialogRef.current;
    const hasNativeModal = dialog !== null && typeof dialog.showModal === "function";
    if (dialog?.open && typeof dialog.close === "function") dialog.close();
    else dialog?.removeAttribute("open");
    if (!hasNativeModal && invoker.current?.isConnected) invoker.current.focus();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      class="tkr-help-document"
      aria-labelledby="tkr-help-document-title"
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClose={onClose}
    >
      <header class="tkr-help-document-header">
        <h2 id="tkr-help-document-title">{title}</h2>
        <button class="tkr-help-document-close" type="button" autofocus onClick={close}>Close help</button>
      </header>
      <article class="tkr-help-document-body">{renderMarkdown(markdown)}</article>
    </dialog>
  );
}
