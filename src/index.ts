// src/index.ts — STUB: CLI entry point, implemented in Phase 4
export {
  calculateVideoBitrate,
  TARGET_EFFECTIVE_MIB,
  TARGET_CEILING_MIB,
  TARGET_EFFECTIVE_BYTES,
  TARGET_CEILING_BYTES,
  MIB_TO_BYTES,
  targetBytesFromCeilingMiB,
} from "./bitrate.js";
export {
  FfmpegToolError,
  InputValidationError,
  FfmpegNotFoundError,
  EncodingFailedError,
  OutputOversizeError,
} from "./errors.js";
export {
  probeVideo,
  resolveFfprobePath,
  resolveFfmpegPath,
  ffmpegInstallMessage,
} from "./probe.js";
export type { ProbeResult } from "./probe.js";
export { encodeVideo } from "./encode.js";
export type { EncodeOptions, EncodeProgressEvent } from "./encode.js";
export { verifyOutput } from "./verify.js";
export type { VerifyResult, VerifyOptions } from "./verify.js";
