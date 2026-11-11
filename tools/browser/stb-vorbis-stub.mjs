// The browser player's stand-in for `stb-vorbis` (#1325; docs/spec/engine/runners.md#csp-and-banks).
//
// The MIDI dependency imports its Ogg Vorbis decoder eagerly, and that module instantiates its WebAssembly at import time
// — even when only the bundled, uncompressed `.sf2` is played. The browser player keeps a strict `script-src 'self'` with
// no `'wasm-unsafe-eval'`, so that instantiation is a policy violation at startup and an unhandled rejection that leaves
// the processor uninitialised.
//
// The browser build therefore bundles this stub instead of the decoder: `ready` resolves, so the processor initialises
// and the SF2 path works, and `decode` fails loudly if anything ever asks for a compressed sample. The desktop and
// measurement pages keep the real decoder (`'wasm-unsafe-eval'`), which is where SF3 support lives.
//
// `tools/browser/bundle-options.mjs` applies the alias; `tools/browser/tests/player-webassembly.spec.ts` proves the
// shipped player instantiates no WebAssembly.

export class StbVorbis {
  /** The processor waits on this before it reports itself initialised. The browser ships no decoder, so it is ready. */
  static ready = Promise.resolve();

  static exports = undefined;

  static decode() {
    throw new Error(
      "the browser player ships no Ogg Vorbis decoder, so a compressed SoundFont (SF3) cannot be played here; use an uncompressed .sf2",
    );
  }
}
