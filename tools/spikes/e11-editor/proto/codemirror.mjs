// CodeMirror 6 with its basic setup and a tiny stream grammar for the same RPGCode-like program, for comparison with
// Monaco under the same policies. CodeMirror injects its styles through style-mod, which uses constructable
// stylesheets (`adoptedStyleSheets`) where the browser has them and a `<style>` element otherwise; `EditorView.cspNonce`
// supplies a nonce for the second case. Built twice: `__SHADOW__` mounts the editor inside a shadow root, where
// style-mod adopts constructable stylesheets instead of inserting a `<style>` element.
import { basicSetup } from "codemirror";
import { EditorView } from "@codemirror/view";
import { StreamLanguage } from "@codemirror/language";
import "./spike.css";

const probe = (window.__cm = { ready: false });
const keywords = new Set(["if", "else", "while", "for", "method", "return"]);
const rpgcode = StreamLanguage.define({
  token(stream) {
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    if (stream.match(/^"[^"]*"/)) return "string";
    if (stream.match(/^\d+/)) return "number";
    if (stream.match(/^#?[a-zA-Z_][\w$!]*/)) return keywords.has(stream.current()) ? "keyword" : "variableName";
    stream.next();
    return null;
  },
});

const text = [
  "// A small authored program for the spike",
  "method greet(name$)",
  "{",
  "    mwin(\"Hello \" + name$)",
  "    wait()",
  "}",
  "greet(\"world\")",
  "if (x! == 1) { greeting = 2 }",
  ...Array.from({ length: 12 }, (_, i) => `counter! = counter! + ${i}`),
].join("\n");

const nonce = document.currentScript?.nonce || "";
const host = document.getElementById("editor");
const root = __SHADOW__ ? host.attachShadow({ mode: "open" }) : undefined;
probe.view = new EditorView({
  doc: text,
  extensions: [basicSetup, rpgcode, ...(nonce ? [EditorView.cspNonce.of(nonce)] : [])],
  parent: root ?? host,
  ...(root ? { root } : {}),
});
probe.ready = true;
