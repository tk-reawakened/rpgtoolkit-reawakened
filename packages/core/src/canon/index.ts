/**
 * Canonical form and hashes (AD-11): RFC 8785 JSON, pure UTF-8 encoding and
 * strict decoding, the FNV-1a 64-bit hasher and the log codec.
 */

export { CANON_MAX_DEPTH, canon, hashDrawList, hashState, reviveNonFinite, tagNonFinite } from "./canon.ts";
export { utf8Decode, utf8Encode } from "./utf8.ts";
export { fnv1a64 } from "./fnv1a.ts";
export { decodeLog, encodeLog } from "./log.ts";
