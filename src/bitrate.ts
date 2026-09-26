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

// ──────────────────────────────────────────────────────────────────
// Duration-aware quality. A fixed size budget spread over a long clip leaves
// very few bits per second, so the file's duration — not its input size —
// decides how starved the encode is. At native resolution a 5-minute 720p
// recording got ~150 kbps of video (VMAF ~36); spending the same bits on fewer
// pixels and less audio lifted it to ~62. Thresholds below were calibrated
// against real browser recordings by picking the best-scoring VMAF variant.
// ──────────────────────────────────────────────────────────────────

/** Largest share of the size budget audio may take before it is lowered. */
const MAX_AUDIO_SHARE = 0.2;
/** AAC below this sounds broken; long clips stop lowering audio here. */
const MIN_AUDIO_KBPS = 48;

/**
 * Lower the audio bitrate when it would take more than a fifth of the budget.
 * At 300 s, 96 kbps of audio was ~40% of a 10 MB file. Never raises the
 * requested bitrate, and never goes below 48 kbps unless asked to.
 */
export function capAudioKbps(
  requestedKbps: number,
  targetSizeBytes: number,
  durationSeconds: number,
): number {
  const totalKbps = (targetSizeBytes * 8) / durationSeconds / 1000;
  const capKbps = Math.max(MIN_AUDIO_KBPS, Math.floor(totalKbps * MAX_AUDIO_SHARE));
  return Math.min(requestedKbps, capKbps);
}

/**
 * Below this many bits per pixel per frame, fewer pixels look better than more
 * starved ones. The best trade depends on content: a simple recording peaked at
 * ~0.03 bpp, a busy one kept improving up to ~0.05 (0.029 at 480p scored 67.6,
 * 0.051 at 360p scored 72.0). Erring high costs simple clips under a point;
 * erring low costs busy ones five, so the floor sits toward the busy end.
 */
const MIN_BITS_PER_PIXEL = 0.035;
/**
 * Browser recordings declare no framerate (see encode.ts), so bpp is computed at
 * a nominal rate. They run at about 30 fps.
 */
const NOMINAL_FPS = 30;
/** Short-side rungs, largest first. 360 is the floor: text below it is unreadable. */
const SHORT_SIDE_RUNGS = [1080, 720, 540, 480, 360];

const toEven = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/**
 * Choose the output frame size for a video bitrate: native if it gets enough bits
 * per pixel, else the largest short-side rung that does, never below 360 and
 * never above the source. Aspect ratio is kept; sizes are even for yuv420p.
 */
export function pickOutputSize(
  width: number,
  height: number,
  videoKbps: number,
): { width: number; height: number } {
  const fits = (w: number, h: number) =>
    (videoKbps * 1000) / (w * h * NOMINAL_FPS) >= MIN_BITS_PER_PIXEL;
  if (fits(width, height)) return { width, height };

  const shortSide = Math.min(width, height);
  const candidates = SHORT_SIDE_RUNGS.filter((rung) => rung < shortSide).map((rung) => {
    const scale = rung / shortSide;
    return { width: toEven(width * scale), height: toEven(height * scale) };
  });
  if (candidates.length === 0) return { width, height };
  return candidates.find((c) => fits(c.width, c.height)) ?? candidates[candidates.length - 1];
}
