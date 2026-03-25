// ──────────────────────────────────────────────────────────────────
// Size constants — binary MiB (1 MiB = 1,048,576 bytes), NOT decimal MB.
//
// TARGET_EFFECTIVE_MIB: what the bitrate formula targets. Set below the
// ceiling to leave headroom for MP4 container overhead (moov atom, mdat
// headers). Two-pass H.264 can overshoot by ~200KB on low-bitrate encodes.
//
// TARGET_CEILING_MIB: the hard output ceiling. The tool exits non-zero if
// the output file exceeds this value. This is the Discord 10MB upload limit
// minus a safety margin.
//
// Why two values: the formula aims for EFFECTIVE, and the post-encode check
// rejects anything above CEILING. This two-tier approach prevents overshoots
// without being excessively conservative.
// ──────────────────────────────────────────────────────────────────

/** 1 MiB in bytes (binary: 1024 * 1024 = 1,048,576) */
export const MIB_TO_BYTES = 1_048_576;

/** Effective target in MiB — what the bitrate formula aims for (binary MiB, NOT decimal MB) */
export const TARGET_EFFECTIVE_MIB = 9.6;

/** Hard ceiling in MiB — tool exits non-zero if output exceeds this (binary MiB, NOT decimal MB) */
export const TARGET_CEILING_MIB = 9.8;

/** Effective target in bytes: Math.floor(9.6 * 1,048,576) = 10,066,329 bytes */
export const TARGET_EFFECTIVE_BYTES = Math.floor(TARGET_EFFECTIVE_MIB * MIB_TO_BYTES);

/** Hard ceiling in bytes: Math.floor(9.8 * 1,048,576) = 10,276,044 bytes */
export const TARGET_CEILING_BYTES = Math.floor(TARGET_CEILING_MIB * MIB_TO_BYTES);

/**
 * Calculate the video bitrate needed to hit a target file size.
 *
 * All intermediate math is done in BITS to avoid mixing bytes and bits.
 *
 * Conversion chain:
 *   targetSizeBytes * 8            -> total bits available
 *   audioBitrateKbps * 1000        -> audio bits per second
 *   * durationSeconds              -> total audio bits (audioBitsTotal)
 *   totalBits - audioBitsTotal     -> available bits for video
 *   / durationSeconds              -> video bits per second
 *   / 1000                         -> video kbits per second (kbps)
 *   Math.floor(...)                -> integer kbps
 *
 * @param targetSizeBytes  - Target file size in bytes (use TARGET_EFFECTIVE_BYTES)
 * @param durationSeconds  - Video duration in seconds (float, must be > 0)
 * @param audioBitrateKbps - Audio stream bitrate in kbps (0 if no audio)
 * @returns videoBitrateKbps as an integer >= 1 (minimum guard prevents negative/zero)
 */
/**
 * Derive effective/ceiling byte targets from a ceiling MiB value (same 0.2 MiB gap as 9.6/9.8 defaults).
 */
export function targetBytesFromCeilingMiB(ceilingMiB: number): {
  effectiveBytes: number;
  ceilingBytes: number;
} {
  const ceilingBytes = Math.floor(ceilingMiB * MIB_TO_BYTES);
  const effectiveBytes = Math.floor(Math.max(0.1, ceilingMiB - 0.2) * MIB_TO_BYTES);
  return { effectiveBytes, ceilingBytes };
}

export function calculateVideoBitrate(
  targetSizeBytes: number,
  durationSeconds: number,
  audioBitrateKbps: number,
): number {
  const audioBitsTotal = audioBitrateKbps * 1000 * durationSeconds;
  const availableBits = targetSizeBytes * 8 - audioBitsTotal;
  const videoBitrateKbps = Math.floor(availableBits / durationSeconds / 1000);
  return Math.max(1, videoBitrateKbps); // never return 0 or negative
}
