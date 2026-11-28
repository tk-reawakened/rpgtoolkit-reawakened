// Disposable authored Opus/WAV fixtures, an independent Ogg/Opus timing oracle, and canonical TPK packaging.
// No runtime decoder, production code, dependency, or generated media is shipped.
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadPackage } from "@tk-reawakened/core";
import { wavInfo } from "../../fixtures/audio/length.mjs";
import { findProbeMedia } from "./probe-media.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const FIXTURE_DIR = join(root, "artifacts", "runtime-audio", "fixtures");
export const PACKAGE_PATH = join(root, "artifacts", "runtime-audio", "runtime-audio.tpk");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const run = (bin, args, options = {}) => {
  const result = spawnSync(bin, args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error?.code === "ENOENT") throw new Error(`Required authoring tool '${bin}' is unavailable.`);
  if (result.status !== 0) throw new Error(`${bin} ${args.join(" ")} failed (${result.status}): ${result.stderr}`);
  return result;
};
function u16(b, i) { return b[i] | (b[i + 1] << 8); }
function u32(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0; }
function i64(b, i) {
  const n = BigInt.asIntN(64, BigInt(u32(b, i)) | (BigInt(u32(b, i + 4)) << 32n));
  if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error("Ogg granule exceeds safe integer range");
  return Number(n);
}
function oggCrc(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 24;
    for (let bit = 0; bit < 8; bit++) crc = (crc & 0x80000000) ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0;
  }
  return crc >>> 0;
}
const maxOpusFrameBytes = 1275;
function opusPacketSamples(packet) {
  if (packet.length === 0) throw new Error("Empty Opus audio packet");
  const toc = packet[0], config = toc >>> 3, code = toc & 3;
  const perFrame = config < 12 ? [480, 960, 1920, 2880][config & 3]
    : config < 16 ? [480, 960][config & 1]
      : [120, 240, 480, 960][config & 3];
  let frames;
  if (code === 0) {
    frames = 1;
    if (packet.length - 1 > maxOpusFrameBytes) throw new Error("Opus code 0 frame length exceeds 1275 bytes");
  } else if (code === 1) {
    frames = 2;
    if ((packet.length - 1) % 2 !== 0) throw new Error("Opus code 1 packet has an odd payload length");
    if ((packet.length - 1) / 2 > maxOpusFrameBytes) throw new Error("Opus code 1 frame length exceeds 1275 bytes");
  } else if (code === 2) {
    frames = 2;
    if (packet.length < 2) throw new Error("Opus code 2 packet is missing its frame length field");
    let firstLength = packet[1], header = 1;
    if (firstLength >= 252) {
      if (packet.length < 3) throw new Error("Opus code 2 packet is missing the second frame length byte");
      firstLength += 4 * packet[2]; header = 2;
    }
    if (packet.length - 1 - header - firstLength < 0) throw new Error(`Opus code 2 frame length ${firstLength} exceeds the packet`);
    if (packet.length - 1 - header - firstLength > maxOpusFrameBytes) throw new Error("Opus code 2 second frame length exceeds 1275 bytes");
  } else {
    if (packet.length < 2) throw new Error("Opus code 3 packet is missing its frame-count byte");
    const count = packet[1];
    frames = count & 0x3f;
    if (frames < 1 || frames > 48) throw new Error(`Opus code 3 packet has invalid frame count ${frames}`);
    let at = 2, paddingBytes = 0;
    if ((count & 0x40) !== 0) {
      const paddingHeaderAt = at;
      for (;;) {
        if (at >= packet.length) throw new Error("Opus code 3 packet is missing its padding length");
        const byte = packet[at]; at += 1;
        paddingBytes += byte === 255 ? 254 : byte;
        if (byte < 255) break;
      }
      if (paddingBytes + (at - paddingHeaderAt) > packet.length - 2) throw new Error("Opus code 3 padding length exceeds the packet");
    }
    const dataEnd = packet.length - paddingBytes;
    if ((count & 0x80) === 0) {
      const available = dataEnd - at;
      if (available < 0 || available % frames !== 0) throw new Error("Opus code 3 CBR data is not a whole number of frames");
      if (available / frames > maxOpusFrameBytes) throw new Error("Opus code 3 CBR frame length exceeds 1275 bytes");
    } else {
      let declared = 0;
      for (let index = 0; index < frames - 1; index++) {
        if (at >= dataEnd) throw new Error("Opus code 3 packet is missing a frame length field");
        let length = packet[at]; at += 1;
        if (length >= 252) {
          if (at >= dataEnd) throw new Error("Opus code 3 packet is missing the second frame length byte");
          length += 4 * packet[at]; at += 1;
        }
        declared += length;
        if (at + declared > dataEnd) throw new Error("Opus code 3 frame lengths exceed the packet");
      }
      if (dataEnd - at - declared > maxOpusFrameBytes) throw new Error("Opus code 3 final VBR frame length exceeds 1275 bytes");
    }
  }
  const samples = perFrame * frames;
  if (frames < 1 || frames > 48 || samples > 5760) throw new Error(`Invalid Opus packet duration: ${samples} samples`);
  return samples;
}
/** Inspect one Ogg Opus stream; independently derive packet duration and RFC 7845 EOS trimming at 48 kHz. */
export function inspectOggOpus(bytes) {
  const packets = [], pageGranules = [], packetStartPages = [], packetPages = [];
  let offset = 0, serial = null, sequence = 0, continued = false, packet = [], eosGranule = null, audioSamples = 0, lastPacketSamples = 0;
  while (offset < bytes.length) {
    if (offset + 27 > bytes.length || bytes.toString("ascii", offset, offset + 4) !== "OggS" || bytes[offset + 4] !== 0) throw new Error(`Malformed Ogg page at byte ${offset}`);
    const flags = bytes[offset + 5], granule = i64(bytes, offset + 6), thisSerial = u32(bytes, offset + 14), thisSequence = u32(bytes, offset + 18), n = bytes[offset + 26];
    if (serial === null) { if ((flags & 2) === 0 || thisSequence !== 0) throw new Error("Ogg stream must start with BOS sequence 0"); serial = thisSerial; }
    else if (flags & 2) throw new Error("Unexpected Ogg BOS page");
    if (thisSerial !== serial) throw new Error("Chained or multiplexed Ogg streams are outside this oracle");
    if (thisSequence !== sequence++) throw new Error("Ogg page sequence discontinuity");
    if (Boolean(flags & 1) !== continued) throw new Error("Ogg packet continuation flag mismatch");
    if (offset + 27 + n > bytes.length) throw new Error("Truncated Ogg lacing table");
    const pageIndex = thisSequence, packetStart = packets.length;
    let bodyAt = offset + 27 + n;
    for (let i = 0; i < n; i++) {
      const lace = bytes[offset + 27 + i];
      if (bodyAt + lace > bytes.length) throw new Error("Truncated Ogg packet body");
      if (packet.length === 0 && !continued) packetStartPages.push(pageIndex);
      packet.push(bytes.subarray(bodyAt, bodyAt + lace)); bodyAt += lace; continued = lace === 255;
      if (!continued) { packets.push(Buffer.concat(packet)); packetPages.push(pageIndex); packet = []; }
    }
    const pageEnd = bodyAt, pageBytes = Buffer.from(bytes.subarray(offset, pageEnd)), storedCrc = u32(bytes, offset + 22);
    pageBytes.fill(0, 22, 26);
    if (oggCrc(pageBytes) !== storedCrc) throw new Error(`Ogg CRC mismatch on page ${pageIndex}`);
    const completed = packets.length - packetStart;
    if ((flags & 2) !== 0 && (completed !== 1 || continued || packet.length !== 0)) throw new Error("OpusHead must be alone on the beginning-of-stream page");
    if (packetStart < 2 && completed > 0) {
      if (packets.length > 2 || continued) throw new Error("Ogg header-completion page mixes Opus header and audio packets");
      if (granule !== 0) throw new Error(`Ogg header-completion page ${pageIndex} requires granule zero`);
    } else if (completed === 0) {
      if (granule !== -1) throw new Error(`Ogg page ${pageIndex} completes no packet and requires granule -1`);
    } else {
      for (let i = packetStart; i < packets.length; i++) {
        lastPacketSamples = opusPacketSamples(packets[i]);
        audioSamples += lastPacketSamples;
      }
      if (flags & 4) {
        if (granule > audioSamples || granule < audioSamples - lastPacketSamples) throw new Error("EOS granule is not a valid final-packet trim");
      } else if (granule !== audioSamples) {
        throw new Error(`Ogg page ${pageIndex} granule ${granule} does not match completed packet duration ${audioSamples}`);
      }
    }
    pageGranules.push(granule);
    if (flags & 4) {
      if (pageEnd !== bytes.length || continued || packet.length || eosGranule !== null) throw new Error("Invalid Ogg EOS page");
      eosGranule = granule;
    }
    offset = pageEnd;
  }
  if (serial === null || eosGranule === null || packets.length < 3) throw new Error("Incomplete Ogg Opus stream (missing EOS or header/audio packets)");
  if (packetStartPages[0] !== 0 || packetPages[0] !== 0) throw new Error("OpusHead must be alone on the beginning-of-stream page");
  if (packetStartPages[1] !== 1) throw new Error("OpusTags must begin on the second Ogg page");
  const head = packets[0];
  if (head.length < 19 || head.toString("ascii", 0, 8) !== "OpusHead" || head[8] !== 1) throw new Error("Missing or unsupported OpusHead packet");
  const channels = head[9], preSkip = u16(head, 10), mapping = head[18];
  if (channels < 1 || channels > 2 || mapping !== 0) throw new Error(`Unsupported Opus layout: ${channels} channels, mapping family ${mapping}`);
  if (packets[1].toString("ascii", 0, 8) !== "OpusTags") throw new Error("Missing OpusTags packet");
  if (packets[1].length < 16 || eosGranule < preSkip) throw new Error("EOS granule precedes Opus pre-skip or OpusTags is malformed");
  return { channels, preSkip, eosGranule, packetSamples48k: audioSamples, playable48kFrames: eosGranule - preSkip, audioPackets: packets.length - 2, packetBytes: packets.slice(2).reduce((n, p) => n + p.length, 0), pageGranules, pages: sequence };
}
function wav(source, rate, seconds) {
  const frames = rate * seconds, dataBytes = frames * 4, out = Buffer.alloc(44 + dataBytes);
  out.write("RIFF", 0); out.writeUInt32LE(36 + dataBytes, 4); out.write("WAVEfmt ", 8); out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); out.writeUInt16LE(2, 22); out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 4, 28);
  out.writeUInt16LE(4, 32); out.writeUInt16LE(16, 34); out.write("data", 36); out.writeUInt32LE(dataBytes, 40);
  for (let frame = 0; frame < frames; frame++) {
    const time = frame / rate;
    const envelope = time < 0.25 || time >= seconds - 0.25 ? 0 : Math.min(1, (time - 0.25) * 20, (seconds - 0.25 - time) * 20);
    const sample = frame === Math.floor(rate / 2) ? 25000 : Math.round(Math.sin(frame * 2 * Math.PI * 440 / rate) * 0.2 * envelope * 32767);
    out.writeInt16LE(sample, 44 + frame * 4); out.writeInt16LE(sample, 46 + frame * 4);
  }
  writeFileSync(source, out);
  return { rate, channels: 2, frames, bytes: out.length, sha256: hash(out), onsetSilenceFrames: rate / 4, tailSilenceFrames: rate / 4, impulseFrame: Math.floor(rate / 2), impulsePositionSeconds: 0.5 };
}
/** The peak frame of an FFmpeg-decoded PCM16 WAV, so a whole pre-skip shift cannot hide inside the frame count. */
function pcm16PeakFrame(bytes) {
  let offset = 12, channels = null, bits = null, dataAt = null, dataBytes = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4), size = u32(bytes, offset + 4), body = offset + 8;
    if (id === "fmt ") { channels = u16(bytes, body + 2); bits = u16(bytes, body + 14); }
    else if (id === "data") { dataAt = body; dataBytes = Math.min(size, bytes.length - body); }
    offset = body + size + (size & 1);
  }
  if (dataAt === null || channels === null || bits !== 16) throw new Error("FFmpeg decoded output is not PCM16 WAV");
  let peak = 0, frame = -1;
  const frames = Math.floor(dataBytes / (channels * 2));
  for (let index = 0; index < frames; index++) {
    for (let channel = 0; channel < channels; channel++) {
      const magnitude = Math.abs(bytes.readInt16LE(dataAt + (index * channels + channel) * 2));
      if (magnitude > peak) { peak = magnitude; frame = index; }
    }
  }
  return { frame, peak, frames, channels };
}
export function generateFixtures(outDir = FIXTURE_DIR) {
  const ffmpeg = run("ffmpeg", ["-version"]).stdout.split(/\r?\n/, 1)[0], buildconf = run("ffmpeg", ["-buildconf"]);
  const encoders = run("ffmpeg", ["-hide_banner", "-encoders"]).stdout;
  if (!encoders.includes("libopus")) throw new Error("Installed FFmpeg does not provide libopus.");
  mkdirSync(outDir, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "tkr-audio-"));
  try {
    const manifest = {
      generatedAt: new Date().toISOString(), tool: ffmpeg, buildConfiguration: buildconf.stdout,
      authoringToolLicense: buildconf.stdout.includes("--enable-gpl") ? "This local FFmpeg build enables GPL; it is external, not bundled or approved." : "This local FFmpeg build is external, not bundled or approved; inspect its configuration before any distribution.",
      commandTemplate: "ffmpeg -hide_banner -y -i <authored-stereo-pcm16-wav> -c:a libopus -b:a 96k -vbr off -compression_level 10 -frame_duration 20 -application audio -map_metadata -1 -fflags +bitexact <output.ogg>",
      fixtureLicense: "Signal authored by this script. FFmpeg/libopus are user-installed tools; they are not redistributed.",
      fixtures: [],
    };
    for (const [name, rate, seconds] of [["short", 48000, 2], ["long", 48000, 60]]) {
      const wavPath = join(tmp, `${name}.wav`), oggPath = join(outDir, `${name}.opus.ogg`), source = wav(wavPath, rate, seconds);
      const encodeArgs = ["-hide_banner", "-y", "-i", wavPath, "-c:a", "libopus", "-b:a", "96k", "-vbr", "off", "-compression_level", "10", "-frame_duration", "20", "-application", "audio", "-map_metadata", "-1", "-fflags", "+bitexact", oggPath];
      run("ffmpeg", encodeArgs);
      const opus = readFileSync(oggPath), oracle = inspectOggOpus(opus), decodedPath = join(tmp, `${name}-decoded.wav`);
      run("ffmpeg", ["-hide_banner", "-y", "-i", oggPath, "-c:a", "pcm_s16le", decodedPath]);
      const decodedBytes = readFileSync(decodedPath), decoded = wavInfo(decodedBytes);
      if (!decoded.ok || decoded.rate !== rate || decoded.frames !== source.frames || oracle.playable48kFrames !== source.frames) {
        throw new Error(`Timing disagreement for ${name}: authored ${source.frames} frames at ${rate}, Ogg oracle ${oracle.playable48kFrames}, FFmpeg ${JSON.stringify(decoded)}`);
      }
      const impulse = pcm16PeakFrame(decodedBytes), toleranceMs = 5, toleranceFrames = Math.ceil(rate * toleranceMs / 1000);
      if (Math.abs(impulse.frame - source.impulseFrame) > toleranceFrames) {
        throw new Error(`FFmpeg decoded the ${name} impulse at frame ${impulse.frame}, expected ${source.impulseFrame} ±${toleranceFrames} frames (${toleranceMs} ms); a whole ${oracle.preSkip}-frame pre-skip shift is rejected`);
      }
      manifest.fixtures.push({
        name, source, playable: { bytes: opus.length, sha256: hash(opus) }, oracle, ffmpegDecodedOutputFrames: decoded.frames,
        decodedImpulse: { frame: impulse.frame, expectedFrame: source.impulseFrame, deltaFrames: impulse.frame - source.impulseFrame, deltaMs: (impulse.frame - source.impulseFrame) * 1000 / rate, toleranceMs },
        encodedCommand: `ffmpeg ${encodeArgs.map((x) => JSON.stringify(x)).join(" ")}`,
      });
    }
    const gameDir = join(tmp, "demo");
    cpSync(join(root, "fixtures", "legacy", "demo"), gameDir, { recursive: true });
    const midiFixture = join(root, "packages", "core", "test", "fixtures", "audio", "files", "midi0-480-default-tempo.mid");
    const bankFixture = join(root, "media", "soundfonts", "TK-16.sf2");
    mkdirSync(join(gameDir, "Media"), { recursive: true });
    for (const name of ["short", "long"]) {
      cpSync(join(outDir, `${name}.opus.ogg`), join(gameDir, "Media", `${name}.opus.ogg`));
      cpSync(join(tmp, `${name}.wav`), join(gameDir, "Media", `${name}.wav`));
    }
    cpSync(midiFixture, join(gameDir, "Media", "midi-control.mid"));
    cpSync(bankFixture, join(gameDir, "Media", "TK-16.sf2"));
    run(process.execPath, [
      join(root, "tools", "make-package", "run.mjs"), gameDir,
      "--closing-plan", join(root, "golden", "closing", "plan.json"),
      "--game", "demo", "--out", PACKAGE_PATH, "--title", "Runtime Audio Probe",
    ]);
    const packageBytes = new Uint8Array(readFileSync(PACKAGE_PATH));
    const loaded = loadPackage({ kind: "tpk", name: PACKAGE_PATH, bytes: packageBytes });
    if (!loaded.ok) throw new Error(`Canonical TPK reader rejected generated probe package: ${loaded.error.detail}`);
    manifest.package = { path: PACKAGE_PATH, bytes: packageBytes.length, sha256: hash(packageBytes), reader: "packages/core loadPackage({kind:'tpk'})", entries: [], controls: [] };
    for (const [reference, sourcePath] of [["midi-control.mid", midiFixture], ["TK-16.sf2", bankFixture]]) {
      const found = findProbeMedia(loaded.value, reference);
      if (found === null) throw new Error(`Canonical package reader did not index Media/${reference}`);
      const sha256 = hash(found.bytes);
      if (sha256 !== hash(readFileSync(sourcePath))) throw new Error(`Canonical TPK control differs from repo bytes: ${found.path}`);
      manifest.package.controls.push({ key: found.path, assetKey: found.key, bytes: found.bytes.length, sha256 });
    }
    for (const { name, source, playable } of manifest.fixtures) {
      for (const [suffix, expected] of [[".opus.ogg", playable], [".wav", source]]) {
        const found = findProbeMedia(loaded.value, `${name}${suffix}`);
        if (found === null) throw new Error(`Canonical package reader did not index Media/${name}${suffix}`);
        const sha256 = hash(found.bytes);
        if (sha256 !== expected.sha256) throw new Error(`Canonical TPK entry differs from source bytes: ${found.path}`);
        manifest.package.entries.push({ key: found.path, assetKey: found.key, bytes: found.bytes.length, sha256, originalBytesMatch: true });
      }
    }
    writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(generateFixtures(), null, 2)); }
  catch (error) { console.error(`runtime-audio fixtures: ${error.message}`); process.exitCode = 1; }
}
