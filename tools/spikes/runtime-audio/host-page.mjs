import { loadPackage } from "@tk-reawakened/core";
import { CuePlayer } from "@tk-reawakened/synth";
import { findProbeMedia } from "./probe-media.mjs";
import { loopLandmarks, mixContribution } from "./waveform-oracles.mjs";

const configPromise = fetch("./probe-config.json", { cache: "no-store" }).then((response) => {
  if (!response.ok) throw new Error(`probe configuration HTTP ${response.status}`);
  return response.json();
});
const encoding = new URL(location.href).searchParams.get("encoding") ?? "opus";
const useOpus = encoding === "opus";
const report = {
  host: null,
  fixture: null,
  encoding,
  requestedRateHz: null,
  packageReader: "packages/core loadPackage({kind:'tpk'})",
  worklet: "probe-only AudioWorkletProcessor using the production PcmSink and CuePlayer",
  productionOpusSupport: false,
  adapter: useOpus ? "host-native decodeAudioData -> probe-only WAV PCM adapter -> production PcmSink" : null,
  csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? null,
  status: "waiting-for-trusted-click",
  errors: [],
};
let config, context;
window.__runtimeAudioProbe = report;
const button = document.querySelector("#unlock");
button.disabled = true;
configPromise.then((settings) => {
  if (!useOpus && encoding !== "wav") throw new Error(`Unknown probe encoding ${encoding}`);
  config = settings;
  report.host = config.host;
  report.fixture = config.fixture;
  report.requestedRateHz = config.rate;
  context = new AudioContext({ sampleRate: config.rate, latencyHint: "interactive" });
  report.preGestureContextState = context.state;
  button.disabled = false;
}).catch((error) => {
  report.status = "failed";
  report.errors.push(String(error));
});
document.addEventListener("securitypolicyviolation", (event) => {
  report.cspViolations ??= [];
  report.cspViolations.push({ directive: event.effectiveDirective, resource: event.blockedURI });
});
// Observe enforcement as well as copying the policy string.
const inlineGuidepost = document.createElement("script");
inlineGuidepost.textContent = "window.__runtimeAudioInlineRan = true;";
document.body.append(inlineGuidepost);
inlineGuidepost.remove();
const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
function encodeWav(decoded) {
  const frames = decoded.length, channels = 2, dataBytes = frames * channels * 2;
  const out = new ArrayBuffer(44 + dataBytes), view = new DataView(out);
  const text = (value, at) => [...value].forEach((character, index) => view.setUint8(at + index, character.charCodeAt(0)));
  text("RIFF", 0); view.setUint32(4, 36 + dataBytes, true); text("WAVEfmt ", 8); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, channels, true); view.setUint32(24, decoded.sampleRate, true);
  view.setUint32(28, decoded.sampleRate * channels * 2, true); view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true); text("data", 36); view.setUint32(40, dataBytes, true);
  const left = decoded.getChannelData(0), right = decoded.getChannelData(1);
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const value = Math.max(-1, Math.min(1, channel === 0 ? left[frame] : right[frame]));
      view.setInt16(44 + (frame * channels + channel) * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
  }
  return new Uint8Array(out);
}
function analyzerStats(analyser) {
  const samples = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(samples);
  let square = 0;
  for (const sample of samples) square += sample * sample;
  return Math.sqrt(square / samples.length);
}
function waveformMetrics(capture, rate, loopSeconds) {
  const data = new Float32Array(capture.data);
  let square = 0, firstNonzero = null, peak = 0;
  for (let frame = 0; frame < capture.frames; frame++) {
    const left = data[frame * 2], right = data[frame * 2 + 1];
    square += left * left + right * right;
    peak = Math.max(peak, Math.abs(left), Math.abs(right));
    if (firstNonzero === null && Math.max(Math.abs(left), Math.abs(right)) > 0.01) firstNonzero = frame;
  }
  const music = capture.starts.find((start) => start.cue === 1);
  const offset = music === undefined ? -1 : music.frame - capture.startFrame;
  const seam = offset < 0 || loopSeconds === null ? null : offset + Math.round(rate * loopSeconds);
  const seamDelta = seam === null || seam < 1 || seam + 1 >= capture.frames
    ? null
    : Math.max(Math.abs(data[seam * 2] - data[(seam - 1) * 2]), Math.abs(data[seam * 2 + 1] - data[(seam - 1) * 2 + 1]));
  let loopCorrelation = null;
  if (offset >= 0 && loopSeconds !== null) {
    const first = offset + Math.round(rate * 0.5), repeat = offset + Math.round(rate * (loopSeconds + 0.5)), window = Math.min(1024, capture.frames - repeat);
    if (first >= 0 && window > 0 && first + window <= capture.frames) {
      let xy = 0, xx = 0, yy = 0;
      for (let frame = 0; frame < window; frame++) {
        const a = data[(first + frame) * 2], b = data[(repeat + frame) * 2];
        xy += a * b; xx += a * a; yy += b * b;
      }
      loopCorrelation = xx === 0 || yy === 0 ? 0 : xy / Math.sqrt(xx * yy);
    }
  }
  return {
    frames: capture.frames,
    firstNonzeroFrame: firstNonzero === null ? null : capture.startFrame + firstNonzero,
    onsetAfterPlayMs: firstNonzero === null || music === undefined ? null : (capture.startFrame + firstNonzero - music.frame) * 1000 / rate,
    rms: Math.sqrt(square / (capture.frames * 2)),
    peak,
    loopSeamDelta: seamDelta,
    repeatedWaveformCorrelation: loopCorrelation,
    captureStartFrame: capture.startFrame,
    voiceStarts: capture.starts,
  };
}
function measureSeekWrap(first, afterSeek, rate, lengthTicks, positionTicks) {
  const start = first.starts.find((entry) => entry.cue === 1);
  const seek = afterSeek.seeks.find((entry) => entry.voice === start?.voice && entry.positionTicks === positionTicks);
  if (start === undefined || seek === undefined) return null;
  const a = new Float32Array(first.data), b = new Float32Array(afterSeek.data);
  const seam = seek.frame - afterSeek.startFrame + Math.round((lengthTicks - positionTicks) * rate / 60);
  const reference = start.frame - first.startFrame + Math.round(rate / 2);
  const repeated = seam + Math.round(rate / 2);
  if (seam < 1 || reference < 0 || repeated + 1025 >= afterSeek.frames || reference + 1024 >= first.frames) return null;
  let xy = 0, xx = 0, yy = 0;
  for (let i = 0; i < 1024; i++) {
    const x = a[(reference + i) * 2], y = b[(repeated + i) * 2];
    xy += x * y; xx += x * x; yy += y * y;
  }
  return {
    seekFrame: seek.frame, positionTicks, seamFrame: seam + afterSeek.startFrame,
    delta: Math.abs(b[seam * 2] - b[(seam - 1) * 2]),
    correlation: xx > 0 && yy > 0 ? xy / Math.sqrt(xx * yy) : null,
  };
}
function referenceMetrics(capture, rate, cueId, authoredImpulseSeconds) {
  const data = new Float32Array(capture.data), start = capture.starts.find((entry) => entry.cue === cueId);
  if (start === undefined) return null;
  const offset = start.frame - capture.startFrame;
  let first = null, peak = 0, peakFrame = null;
  for (let frame = Math.max(0, offset); frame < capture.frames; frame++) {
    const magnitude = Math.max(Math.abs(data[frame * 2]), Math.abs(data[frame * 2 + 1]));
    if (first === null && magnitude > 0.01) first = frame;
    if (magnitude > peak) { peak = magnitude; peakFrame = frame; }
  }
  return {
    cueId,
    cueStartFrame: start.frame,
    onsetAfterCueStartMs: first === null ? null : (first - offset) * 1000 / rate,
    peakFrameAfterCueStartMs: peakFrame === null ? null : (peakFrame - offset) * 1000 / rate,
    peak,
    authoredImpulseSeconds,
    impulseOffsetFromAuthoredMs: peakFrame === null || authoredImpulseSeconds === null ? null : (peakFrame - offset) * 1000 / rate - authoredImpulseSeconds * 1000,
  };
}
function cue(kind, cueId, track, tick, loop, asset, positionTicks = 0) {
  return { kind, cueId, track, voice: 0, asset, tick, loop, positionTicks, volume: 100 };
}

button.addEventListener("click", async (event) => {
  if (!event.isTrusted) {
    report.status = "failed";
    report.errors.push("Audio unlock was not initiated by a trusted user click");
    return;
  }
  if (context === undefined || report.status !== "waiting-for-trusted-click") return;
  button.disabled = true;
  report.status = "starting";
  report.unlock = { trustedClick: event.isTrusted, userActivation: navigator.userActivation?.isActive ?? null, pageTimeMs: performance.now() };
  report.memoryPhase = "startup";
  let node, player, analyzerTimer;
  try {
    report.contextStateAtGesture = context.state;
    report.requestedRateHonored = context.sampleRate === config.rate;
    report.contextRateHz = context.sampleRate;
    report.memoryBeforeDecode = performance.memory ? performance.memory.usedJSHeapSize : null;
    await context.resume();
    report.contextStateAfterResume = context.state;
    report.unlock.observedStateChange = report.contextStateAtGesture === "suspended" && context.state === "running";
    let packageBytes;
    if (config.host === "electron") {
      const opened = await window.desktop.openPackage();
      if (opened === null) throw new Error("Electron did not open the configured package");
      packageBytes = opened.bytes;
    } else {
      const response = await fetch(config.host === "capacitor" ? "/public/runtime-audio.tpk" : "/runtime-audio.tpk", { cache: "no-store" });
      if (!response.ok) throw new Error(`Packaged TPK returned HTTP ${response.status}`);
      packageBytes = new Uint8Array(await response.arrayBuffer());
    }
    report.package = { bytes: packageBytes.byteLength, sha256: await sha256(packageBytes) };
    const loaded = loadPackage({ kind: "tpk", name: "runtime-audio.tpk", bytes: packageBytes });
    if (!loaded.ok) throw new Error(`canonical package read failed: ${loaded.error.message}`);
    const reference = `${config.fixture.toUpperCase()}.${useOpus ? "opus.ogg" : "wav"}`;
    const entry = findProbeMedia(loaded.value, reference);
    if (entry === null) throw new Error(`canonical package media index did not resolve ${reference}`);
    const { key: assetKey } = entry, entrySha256 = await sha256(entry.bytes);
    report.package.entry = { key: assetKey, path: entry.path, bytes: entry.bytes.length, sha256: entrySha256, matchesAuthoredBytes: entrySha256 === config.fixtureDigests[encoding] };
    if (!report.package.entry.matchesAuthoredBytes) throw new Error(`${encoding} package entry did not match the authored fixture byte hash`);
    let pcmWav;
    if (useOpus) {
      const decodeStarted = performance.now();
      const decoded = await context.decodeAudioData(entry.bytes.slice().buffer);
      report.nativeDecode = {
        method: "AudioContext.decodeAudioData on exact canonical TPK entry",
        frames: decoded.length,
        sampleRateHz: decoded.sampleRate,
        channels: decoded.numberOfChannels,
        durationSeconds: decoded.duration,
        decodeMilliseconds: performance.now() - decodeStarted,
        expectedFramesAtOutputRate: Math.round(config.playable48kFrames * context.sampleRate / 48000),
      };
      if (decoded.numberOfChannels !== config.channels) throw new Error(`Native decoder returned ${decoded.numberOfChannels} channels; expected ${config.channels}`);
      report.nativeDecode.matches48kGranuleOracleWithinOneFrame = Math.abs(report.nativeDecode.frames - report.nativeDecode.expectedFramesAtOutputRate) <= 1;
      const copyStarted = performance.now();
      pcmWav = encodeWav(decoded);
      report.adapter = {
        name: "probe-only AudioSource .ogg registration delegates to production PCM WAV source",
        registrationBytes: entry.bytes.length,
        convertedPcmWavBytes: pcmWav.length,
        decodedPcmBytes: decoded.length * decoded.numberOfChannels * Float32Array.BYTES_PER_ELEMENT,
        transferBytes: pcmWav.length,
        wavConversionMilliseconds: performance.now() - copyStarted,
      };
    }
    await context.audioWorklet.addModule(config.workletUrl);
    node = new AudioWorkletNode(context, "tkr-runtime-audio-probe", { outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit" });
    report.graphLatency = { baseSeconds: context.baseLatency ?? null, outputSeconds: context.outputLatency ?? null };
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    node.connect(analyser);
    analyser.connect(context.destination);
    const events = [], messages = [], ended = [], captures = [];
    let captureRequest = null;
    const negativeVoices = new Set();
    let preparePostedAt;
    let effectVoice;
    const closeOverlap = () => {
      if (report.memoryPhase === "overlap") {
        report.overlapWindow.closedAtMs = performance.now();
        report.memoryPhase = "post-overlap";
      }
    };
    node.port.onmessage = ({ data }) => {
      if (data.kind === "capture") { captureRequest?.resolve(data); captureRequest = null; }
      else if (data.kind === "prepared") report.adapter.workletReceipt = { bytes: data.bytes, sampleRateHz: data.sampleRate, roundTripMilliseconds: performance.now() - preparePostedAt };
      else if (data.kind === "ready") { player?.ready(data.voice, data.lengthTicks); events.push(data); }
      else if (data.kind === "overlap-rendered") {
        report.overlapWindow = { openedAtMs: performance.now(), renderedFrame: data.frame, closedAtMs: null };
        report.memoryPhase = "overlap";
      }
      else if (data.kind === "ended") {
        if (data.voice === effectVoice) closeOverlap();
        player?.ended(data.voice);
        events.push(data);
      }
      else if (data.kind === "error") {
        events.push(data);
        if (!negativeVoices.has(data.voice)) report.errors.push(`${data.code}: ${data.detail}`);
      }
    };
    const captureAudio = (seconds) => new Promise((resolveCapture, rejectCapture) => {
      const timer = setTimeout(() => rejectCapture(new Error(`Worklet did not return the ${seconds} second rendered graph capture`)), (seconds + 8) * 1000);
      captureRequest = { resolve: (value) => { clearTimeout(timer); resolveCapture(value); } };
      node.port.postMessage({ kind: "capture", maxFrames: Math.round(context.sampleRate * seconds) });
    });
    if (pcmWav !== undefined) {
      preparePostedAt = performance.now();
      node.port.postMessage({ kind: "prepare", encoded: entry.bytes, wav: pcmWav.buffer }, [pcmWav.buffer]);
    }
    const send = (message) => {
      messages.push({ ...message, data: undefined, atMs: performance.now() });
      if (message.kind === "play" && message.cue === 2) effectVoice = message.voice;
      node.port.postMessage({ kind: "message", message });
      if (message.kind === "play" && message.cue === 1) report.firstPlayAtMs = performance.now();
    };
    player = new CuePlayer({
      send,
      readAsset: (asset) => asset === assetKey ? entry.bytes : null,
      onEnded: (cueId) => ended.push(cueId),
    });
    // Pass A: one complete short iteration and the beginning of the next, before another voice can mask the seam.
    const firstCapture = captureAudio(3.4);
    analyzerTimer = setInterval(() => {
      if (report.gestureToFirstAnalyserEnergyMs === undefined && analyzerStats(analyser) > 0.01) report.gestureToFirstAnalyserEnergyMs = performance.now() - report.unlock.pageTimeMs;
    }, 5);
    player.reach(0);
    player.advance([cue("media.play", 1, "music", 0, true, assetKey)]);
    report.status = "playing";
    const captureA = await firstCapture;
    captures.push(captureA);
    clearInterval(analyzerTimer);
    // Pass B: align both clips so independently captured solo windows contain the two mix contributions.
    const secondCapture = captureAudio(2.4);
    player.reach(90);
    player.advance([
      { kind: "media.seek", cueId: 1, track: "music", voice: 0, asset: null, tick: 90, loop: true, positionTicks: 45, volume: 100 },
      cue("media.play", 2, "effects", 90, false, assetKey),
    ]);
    await new Promise((resolveWait) => setTimeout(resolveWait, 1500));
    player.reach(180);
    player.advance([{ kind: "media.seek", cueId: 1, track: "music", voice: 0, asset: null, tick: 180, loop: true, positionTicks: 30, volume: 100 }]);
    const captureB = await secondCapture;
    closeOverlap();
    captures.push(captureB);
    const loopSeconds = config.playable48kFrames / 48000;
    let seekWrap = null;
    let loopEvidence;
    if (config.fixture === "long") {
      // Exercise the actual 60 s asset at its end, without waiting 60 s per host/rate. Keep the second voice out of this capture.
      const lengthTicks = Math.round(loopSeconds * 60), positionTicks = lengthTicks - 30;
      const wrapCapture = captureAudio(1.4);
      player.reach(240);
      player.advance([
        { kind: "media.stop", cueId: 2, track: "effects", voice: 0, asset: null, tick: 240 },
        { kind: "media.seek", cueId: 1, track: "music", voice: 0, asset: null, tick: 240, positionTicks },
      ]);
      const captureC = await wrapCapture;
      captures.push(captureC);
      seekWrap = measureSeekWrap(captureA, captureC, context.sampleRate, lengthTicks, positionTicks);
      if (seekWrap !== null) {
        const musicStart = captureA.starts.find((start) => start.cue === 1);
        if (musicStart !== undefined) loopEvidence = loopLandmarks(captureA, captureC, musicStart.frame, seekWrap.seekFrame, Math.round((lengthTicks - positionTicks) * context.sampleRate / 60), context.sampleRate);
      }
    }
    player.advance([{ kind: "media.stop", cueId: 1, track: "music", voice: 0, asset: null, tick: 240, loop: null, positionTicks: null, volume: null }]);
    const measurableLoop = loopSeconds + 0.6 < captureA.frames / context.sampleRate;
    const waveformA = waveformMetrics(captureA, context.sampleRate, measurableLoop ? loopSeconds : null);
    const waveformB = waveformMetrics(captureB, context.sampleRate, null);
    if (config.fixture === "short") {
      const musicStart = captureA.starts.find((start) => start.cue === 1);
      if (musicStart !== undefined) loopEvidence = loopLandmarks(captureA, captureA, musicStart.frame, musicStart.frame, Math.round(loopSeconds * context.sampleRate), context.sampleRate);
    }
    report.memoryPhase = "control";
    report.playback = {
      graphKind: "AudioWorklet",
      passes: captures.map((capture) => ({ durationSeconds: capture.frames / context.sampleRate, startFrame: capture.startFrame })),
      graphRms: waveformA.rms,
      graphPeak: waveformA.peak,
      gestureToFirstAnalyserEnergyMs: report.gestureToFirstAnalyserEnergyMs ?? null,
      onsetAfterCueStartMs: waveformA.onsetAfterPlayMs,
      loopLengthSeconds: loopSeconds,
      loopRepeatMeasurement: config.fixture === "long" ? "seek into last half-second then render wrap" : "continuous short capture",
      loopSeamDelta: seekWrap?.delta ?? waveformA.loopSeamDelta,
      repeatedWaveformCorrelation: seekWrap?.correlation ?? waveformA.repeatedWaveformCorrelation,
      seekWrap,
      overlapGraphRms: waveformB.rms,
      loopEvidence: loopEvidence ?? null,
      mixContribution: mixContribution(captureB, captureA, context.sampleRate),
      workletRateHz: captureA.sampleRate,
      musicReference: referenceMetrics(captureA, context.sampleRate, 1, 0.5),
      effectReference: referenceMetrics(captureB, context.sampleRate, 2, null),
      messages: messages.map(({ data, ...message }) => message),
      events,
      endedCueIds: ended,
      seekEmitted: messages.some((message) => message.kind === "seek" && message.positionTicks === 30),
      overlaps: messages.some((message) => message.kind === "play" && message.cue === 1)
        && messages.some((message) => message.kind === "play" && message.cue === 2),
      workletCaptureA: waveformA,
      workletCaptureB: waveformB,
    };
    report.memoryAfterPlayback = performance.memory ? performance.memory.usedJSHeapSize : null;
    const midi = findProbeMedia(loaded.value, "midi-control.mid"), bank = findProbeMedia(loaded.value, "TK-16.sf2");
    if (midi === null || bank === null) throw new Error("canonical package media index did not resolve the existing MIDI and TK-16 controls");
    const bankSha = await sha256(bank.bytes);
    node.port.postMessage({ kind: "bank", bytes: bank.bytes, sha256: bankSha });
    const midiCapture = captureAudio(0.9);
    node.port.postMessage({ kind: "message", message: { kind: "load", voice: 106, track: "music", asset: midi.key, data: midi.bytes } });
    node.port.postMessage({ kind: "message", message: { kind: "play", voice: 106, cue: 106, positionTicks: 0, loop: false, volume: 100 } });
    const midiPcm = await midiCapture;
    node.port.postMessage({ kind: "message", message: { kind: "stop", voice: 106 } });
    report.midiControl = {
      key: midi.key, sha256: await sha256(midi.bytes), bankSha,
      lengthTicks: events.find((event) => event.kind === "ready" && event.voice === 106)?.lengthTicks ?? null,
      waveform: referenceMetrics(midiPcm, context.sampleRate, 106, null),
    };

    if (useOpus) {
      const malformed = new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0]);
      const nativeRejectsMalformed = await context.decodeAudioData(malformed.slice().buffer).then(() => false, () => true);
      const missing = findProbeMedia(loaded.value, "absent.opus.ogg");
      const silenceCapture = captureAudio(0.2);
      node.port.postMessage({ kind: "discard-prepared-opus" });
      for (const [voice, asset, bytes] of [
        [102, "media/absent.opus.ogg", new Uint8Array()],
        [103, "media/truncated.opus.ogg", malformed],
        [104, "media/unknown.bin", new Uint8Array([1, 2, 3, 4])],
        [105, assetKey, entry.bytes],
      ]) {
        negativeVoices.add(voice);
        node.port.postMessage({ kind: "message", message: { kind: "load", voice, track: "effects", asset, data: bytes } });
        node.port.postMessage({ kind: "message", message: { kind: "play", voice, cue: voice, positionTicks: 0, loop: false, volume: 100 } });
      }
      const silence = waveformMetrics(await silenceCapture, context.sampleRate, null);
      report.negativeLanes = {
        nativeRejectsMalformed, missingAssetNotInMediaIndex: missing === null, peak: silence.peak,
        diagnostics: [...negativeVoices].map((voice) => ({
          voice, codes: events.filter((event) => event.kind === "error" && event.voice === voice).map((event) => event.code),
        })),
      };
    }
    report.cspInlineBlocked = window.__runtimeAudioInlineRan !== true
      && report.cspViolations?.some((event) => event.resource === "inline" && event.directive.startsWith("script-src")) === true;
    report.memoryPhase = "closing";
    report.status = "closing";
  } catch (error) {
    report.status = "failed";
    report.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    clearInterval(analyzerTimer);
    node?.disconnect();
    await context?.close().catch(() => {});
    report.finishedAtMs = performance.now();
    report.contextStateAfterClose = context?.state ?? null;
    report.memoryPhase = "after-close";
    if (report.status === "closing") report.status = report.errors.length === 0 ? "complete" : "failed";
  }
});
