import { createAudioSourceRegistry, createPcmSource, createSpessaMidiSource } from "@tk-reawakened/synth";
import { PcmSink } from "@tk-reawakened/runner-web";

class RuntimeAudioProbeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.predecoded = null;
    this.bankBytes = null;
    this.framesRendered = 0;
    this.capture = null;
    this.announceOverlap = false;
    this.starts = [];
    this.seeks = [];
    const pcm = createPcmSource();
    const registry = createAudioSourceRegistry([
      pcm,
      createSpessaMidiSource({ bankResolver: () => this.bankBytes }),
      {
        id: "probe-native-ogg-opus",
        extensions: ["ogg"],
        bank: null,
        detect: (header) => header[0] === 0x4f && header[1] === 0x67 && header[2] === 0x67 && header[3] === 0x53,
        open: (bytes, env) => {
          if (bytes.length < 27) return { ok: false, error: { code: "format.malformed", detail: "truncated Ogg header" } };
          const prepared = this.predecoded;
          return prepared === null || prepared.encoded.length !== bytes.length || !bytes.every((byte, i) => byte === prepared.encoded[i])
            ? { ok: false, error: { code: "source.failed", detail: "probe-local native decoder output is unavailable for these bytes" } }
            : pcm.open(prepared.wav, env);
        },
      },
    ]);
    this.sink = new PcmSink({
      readAsset: () => null,
      registry,
      outputRateHz: sampleRate,
      onEvent: (event) => this.port.postMessage(event),
    });
    this.port.onmessage = ({ data }) => {
      if (data.kind === "prepare") {
        this.predecoded = { encoded: data.encoded, wav: new Uint8Array(data.wav) };
        this.port.postMessage({ kind: "prepared", bytes: data.wav.byteLength, sampleRate });
      } else if (data.kind === "discard-prepared-opus") {
        this.predecoded = null;
      } else if (data.kind === "bank") {
        this.bankBytes = data.bytes;
        this.sink.setBankBytes({ source: "bundled", id: "TK-16", sha256: data.sha256 }, data.bytes, data.sha256);
      } else if (data.kind === "capture") {
        this.capture = { frames: 0, data: new Float32Array(data.maxFrames * 2), startedAtFrame: this.framesRendered };
      } else if (data.kind === "message") {
        if (data.message.kind === "play") this.starts.push({ voice: data.message.voice, cue: data.message.cue, frame: this.framesRendered });
        if (data.message.kind === "seek") this.seeks.push({ voice: data.message.voice, positionTicks: data.message.positionTicks, frame: this.framesRendered });
        this.sink.handle(data.message);
        if (data.message.kind === "play" && data.message.cue === 2) this.announceOverlap = true;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (output === undefined || output.length < 2) return true;
    const left = output[0];
    const right = output[1];
    this.sink.render(left, right, left.length);
    if (this.announceOverlap) {
      this.announceOverlap = false;
      this.port.postMessage({ kind: "overlap-rendered", frame: this.framesRendered });
    }
    if (this.capture !== null) {
      for (let frame = 0; frame < left.length && this.capture.frames < this.capture.data.length / 2; frame++) {
        const at = this.capture.frames * 2;
        this.capture.data[at] = left[frame];
        this.capture.data[at + 1] = right[frame];
        this.capture.frames++;
      }
      if (this.capture.frames === this.capture.data.length / 2) {
        const capture = this.capture;
        this.capture = null;
        this.port.postMessage({ kind: "capture", startFrame: capture.startedAtFrame, frames: capture.frames, data: capture.data.buffer, starts: this.starts, seeks: this.seeks, sampleRate }, [capture.data.buffer]);
      }
    }
    this.framesRendered += left.length;
    return true;
  }
}

registerProcessor("tkr-runtime-audio-probe", RuntimeAudioProbeProcessor);
