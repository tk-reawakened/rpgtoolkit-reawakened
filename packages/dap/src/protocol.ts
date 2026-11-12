/**
 * The tiny Debug Adapter Protocol subset `dap` speaks (TOOL-1, TOOL-8).
 *
 * The protocol is length-prefixed JSON: a header block of `Name: value` lines
 * (we write and require `Content-Length` in UTF-8 bytes), a blank line, then
 * exactly that many bytes of one message. This module owns the message shapes
 * and that framing and nothing else, so it is transport-free: a host feeds it
 * bytes from a pipe, a worker or an in-memory pair (TOOL-8 server note).
 *
 * Adding a third-party DAP library needs a ruling recorded in TOOL-1; this
 * module exists so the package adds none (G6, AD-21).
 */

export type DapRequest = {
  readonly seq: number;
  readonly type: "request";
  readonly command: string;
  readonly arguments?: unknown;
};

export type DapResponse = {
  readonly seq: number;
  readonly type: "response";
  readonly request_seq: number;
  readonly success: boolean;
  readonly command: string;
  readonly message?: string;
  readonly body?: unknown;
};

export type DapEvent = {
  readonly seq: number;
  readonly type: "event";
  readonly event: string;
  readonly body?: unknown;
};

/** A message the session sends to the client. */
export type DapMessage = DapResponse | DapEvent;

const HEADER_END = [13, 10, 13, 10];

function indexOfHeaderEnd(bytes: Uint8Array, from: number): number {
  for (let at = from; at + 3 < bytes.length; at += 1) {
    if (bytes[at] === HEADER_END[0] && bytes[at + 1] === HEADER_END[1] && bytes[at + 2] === HEADER_END[2] && bytes[at + 3] === HEADER_END[3]) {
      return at;
    }
  }
  return -1;
}

/** One framed message, ready to write to a stream. */
export function frameMessage(message: DapMessage): string {
  // The payload is escaped to pure ASCII, so its character count is its byte count and the
  // frame needs no ambient encoder: the package uses no global beyond the language itself.
  const body = JSON.stringify(message).replace(
    /[^\u0000-\u007f]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return `Content-Length: ${body.length}\r\n\r\n${body}`;
}

/** UTF-8 bytes to text, by the standard continuation-byte rules; an ill-formed sequence becomes U+FFFD. */
function decodeUtf8(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index]!;
    const size = first < 0x80 ? 1 : first >= 0xf0 ? 4 : first >= 0xe0 ? 3 : first >= 0xc0 ? 2 : 0;
    if (size === 0 || index + size > bytes.length) {
      text += "\uFFFD";
      index += 1;
      continue;
    }
    if (size === 1) {
      text += String.fromCharCode(first);
      index += 1;
      continue;
    }
    let code = first & (size === 4 ? 0x07 : size === 3 ? 0x0f : 0x1f);
    let valid = true;
    for (let offset = 1; offset < size; offset += 1) {
      const next = bytes[index + offset]!;
      if ((next & 0xc0) !== 0x80) {
        valid = false;
        break;
      }
      code = (code << 6) | (next & 0x3f);
    }
    if (!valid) {
      text += "\uFFFD";
      index += 1;
      continue;
    }
    text += size === 4
      ? String.fromCodePoint(((code - 0x10000) >> 10) + 0xd800, ((code - 0x10000) & 0x3ff) + 0xdc00)
      : String.fromCharCode(code);
    index += size;
  }
  return text;
}

/**
 * A decoder for one direction of a stream. `feed` takes any split of the bytes
 * and returns the whole messages they completed; a frame whose header carries
 * no usable `Content-Length`, or whose body is not JSON, is dropped and the
 * stream continues, because DAP has no frame to report a framing error in.
 */
export function createFramer(): { feed(chunk: Uint8Array): readonly DapRequest[] } {
  let pending = new Uint8Array(0);
  return {
    feed(chunk: Uint8Array): readonly DapRequest[] {
      const merged = new Uint8Array(pending.length + chunk.length);
      merged.set(pending);
      merged.set(chunk, pending.length);
      const messages: DapRequest[] = [];
      let start = 0;
      for (;;) {
        const headerEnd = indexOfHeaderEnd(merged, start);
        if (headerEnd < 0) break;
        const header = decodeUtf8(merged.subarray(start, headerEnd));
        const length = /content-length:\s*(\d+)/i.exec(header);
        if (length === null) {
          start = headerEnd + 4;
          continue;
        }
        const bodyEnd = headerEnd + 4 + Number(length[1]);
        if (merged.length < bodyEnd) break;
        const body = decodeUtf8(merged.subarray(headerEnd + 4, bodyEnd));
        start = bodyEnd;
        try {
          messages.push(JSON.parse(body) as DapRequest);
        } catch {
          // A frame whose body is not JSON is dropped; the next frame still parses.
        }
      }
      pending = merged.subarray(start);
      return messages;
    },
  };
}
