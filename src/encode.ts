import { execa } from "execa";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import ora, { type Ora } from "ora";

import { calculateVideoBitrate, TARGET_EFFECTIVE_BYTES } from "./bitrate.js";
import {
  EncodingCancelledError,
  EncodingFailedError,
  FfmpegNotFoundError,
} from "./errors.js";
import {
  ffmpegInstallMessage,
  probeVideo,
  resolveFfmpegPath,
} from "./probe.js";

export type EncodeProgressEvent = {
  /** probe = reading the input (duration/streams) before any encoding starts */
  phase: "probe" | "pass1" | "pass2" | "single";
  /** null = indeterminate (probe), else 0–100 */
  percent: number | null;
  /** Media seconds processed per wall-clock second, over the last few seconds */
  speed?: number;
  /** Estimated wall-clock seconds left in this phase, derived from `speed` */
  etaSeconds?: number;
};

export interface EncodeOptions {
  ffmpegPath?: string;
  /** Aborting kills the running ffmpeg and rejects with EncodingCancelledError. */
  signal?: AbortSignal;
  /**
   * Called with each ffmpeg process id as it starts (one per pass), so a caller can
   * pause it by suspending the process — ffmpeg has no pause of its own.
   */
  onSpawn?: (pid: number) => void;
  audioBitrateKbps?: number;
  /** Override TARGET_EFFECTIVE_BYTES (e.g. custom --target MiB) */
  targetEffectiveBytes?: number;
  /** Strip audio even if source has an audio stream */
  forceNoAudio?: boolean;
  /**
   * Convert without targeting a file size: quality-driven CRF with no bitrate cap,
   * and no post-encode size check. Output size is whatever the content needs.
   */
  noCeiling?: boolean;
  /** CRF used when `noCeiling` is set (lower = higher quality/larger file). */
  crf?: number;
  /** Skip terminal spinner (Electron / programmatic use) */
  quiet?: boolean;
  /** Fired during encode when `quiet` is true (and optional alongside CLI spinner) */
  onProgress?: (evt: EncodeProgressEvent) => void;
}

/**
 * Browser MediaRecorder WebM declares no framerate, so ffprobe reports r_frame_rate=1000/1
 * (millisecond timestamps) and avg_frame_rate=0/0. Without this, ffmpeg duplicates frames to
 * reach that nominal rate: encodes crawl, two-pass dies with "2nd pass has more frames than
 * 1st pass", and output size overshoots wildly. Passthrough keeps the source timestamps.
 */
const FPS_PASSTHROUGH = ["-fps_mode", "passthrough"];

function nullDevice(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

function parseTimeSeconds(line: string): number | null {
  const m = line.match(/time=(\d+):(\d+):(\d+\.\d+)/);
  if (!m) return null;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const sec = parseFloat(m[3]);
  return h * 3600 + min * 60 + sec;
}

function parseSpeed(line: string): number | null {
  const m = line.match(/speed=\s*(\d+(?:\.\d+)?)x/);
  if (!m) return null;
  const speed = parseFloat(m[1]);
  return speed > 0 ? speed : null;
}

/** ffmpeg prints a status line about twice a second; a longer silence means it was suspended. */
const STALL_GAP_MS = 2000;
const SPEED_WINDOW_MS = 8000;

/**
 * Tracks processing speed over a sliding window. ffmpeg's own `speed=` is averaged since
 * start, so after a pause it collapses and the ETA balloons; a recent-window rate
 * recovers within seconds. Any gap in status lines (a pause) restarts the window.
 */
function createSpeedMeter() {
  let samples: Array<{ wall: number; media: number }> = [];
  let stalled = false;
  return (media: number, ffmpegSpeed: number | null): number | undefined => {
    const wall = Date.now();
    const last = samples[samples.length - 1];
    if (last && wall - last.wall > STALL_GAP_MS) {
      samples = [];
      stalled = true;
    }
    samples.push({ wall, media });
    while (samples.length > 2 && wall - samples[0].wall > SPEED_WINDOW_MS) samples.shift();
    const first = samples[0];
    const span = wall - first.wall;
    if (span >= 1000 && media > first.media) return (media - first.media) / (span / 1000);
    // Until the window fills, ffmpeg's cumulative figure is fine — unless a pause skewed it.
    return stalled ? undefined : (ffmpegSpeed ?? undefined);
  };
}

type FfmpegPhase = Exclude<EncodeProgressEvent["phase"], "probe">;

const SPINNER_TEXT: Record<FfmpegPhase, string> = {
  pass1: "Pass 1 (analysis)…",
  pass2: "Pass 2 (encode)…",
  single: "Encoding (CRF single-pass)…",
};

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new EncodingCancelledError();
}

/**
 * Runs ffmpeg and turns its stderr status lines into progress for `phase`. Every pass
 * reports this way — including the analysis pass, which writes to the null muxer and
 * used to sit on a fixed value for minutes on long recordings. Resolves with the
 * non-rejecting execa result; callers decide what a non-zero exit means. A cancelled
 * run rejects instead, so callers never mistake it for a failure worth retrying.
 */
async function runFfmpegWithProgress(
  ffmpegPath: string,
  args: string[],
  phase: FfmpegPhase,
  duration: number,
  options: EncodeOptions,
  spinner: Ora | null,
) {
  const quiet = options.quiet === true;
  const onProgress = options.onProgress;
  throwIfCancelled(options.signal);
  if (quiet) onProgress?.({ phase, percent: 0 });

  const subprocess = execa(ffmpegPath, args, {
    cancelSignal: options.signal,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    reject: false,
  });
  if (subprocess.pid !== undefined) options.onSpawn?.(subprocess.pid);

  const safeDuration = Math.max(duration, 0.001);
  const measureSpeed = createSpeedMeter();
  let lastPct = -1;

  if (subprocess.stderr) {
    const rl = createInterface({ input: subprocess.stderr });
    rl.on("line", (line) => {
      const t = parseTimeSeconds(line);
      if (t === null) return;
      const pct = Math.min(100, (t / safeDuration) * 100);
      // Sample every line, not just reported ones, so the window stays dense.
      const speed = measureSpeed(t, parseSpeed(line));
      if (Math.floor(pct) === Math.floor(lastPct)) return;
      lastPct = pct;
      const etaSeconds =
        speed === undefined ? undefined : Math.max(0, (safeDuration - t) / speed);
      if (quiet) {
        onProgress?.({ phase, percent: pct, speed, etaSeconds });
      } else if (spinner) {
        spinner.text = `${SPINNER_TEXT[phase]} ${pct.toFixed(0)}%`;
      }
    });
  }

  const result = await subprocess;
  throwIfCancelled(options.signal);
  if (quiet && result.exitCode === 0) onProgress?.({ phase, percent: 100 });
  return result;
}

async function runSinglePassEncode(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  videoKbps: number,
  useAudio: boolean,
  audioKbps: number,
  duration: number,
  options: EncodeOptions,
): Promise<void> {
  const spinner = options.quiet
    ? null
    : ora({ text: SPINNER_TEXT.single, color: "cyan" }).start();

  // Without a size target, CRF alone drives quality — capping the bitrate would
  // only degrade the result for no reason.
  const rateControl = options.noCeiling
    ? ["-crf", String(options.crf ?? 23)]
    : [
        "-crf",
        "23",
        "-b:v",
        `${videoKbps}k`,
        "-maxrate",
        `${videoKbps * 1.5}k`,
        "-bufsize",
        `${videoKbps * 2}k`,
      ];

  const args = [
    "-hide_banner",
    "-y",
    "-i",
    inputPath,
    ...FPS_PASSTHROUGH,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    ...rateControl,
    "-pix_fmt",
    "yuv420p",
    ...(useAudio ? ["-c:a", "aac", "-b:a", `${audioKbps}k`] : ["-an"]),
    "-movflags",
    "+faststart",
    outputPath,
  ];

  const result = await runFfmpegWithProgress(
    ffmpegPath, args, "single", duration, options, spinner,
  );
  if (result.exitCode !== 0) {
    spinner?.fail("Encoding failed");
    throw new EncodingFailedError(
      result.stderr?.slice(-2000) ?? `ffmpeg exited ${result.exitCode}`,
    );
  }
  spinner?.succeed("Encoding complete");
}

/**
 * Two-pass H.264 + AAC encode targeting ~9.6 MiB effective size (see bitrate.ts).
 * Uses single-pass CRF for short videos (< 30s) to avoid pass mismatches.
 */
export async function encodeVideo(
  inputPath: string,
  outputPath: string,
  options: EncodeOptions = {},
): Promise<void> {
  const ffmpegPath = resolveFfmpegPath(options.ffmpegPath);
  if (!ffmpegPath) {
    throw new FfmpegNotFoundError(ffmpegInstallMessage());
  }

  const quiet = options.quiet === true;
  // Probing a header-less browser WebM walks every packet timestamp, which takes a
  // noticeable moment on big files — report it instead of looking idle.
  if (quiet) options.onProgress?.({ phase: "probe", percent: null });

  const probe = await probeVideo(inputPath);
  throwIfCancelled(options.signal);
  const audioKbpsDefault = options.audioBitrateKbps ?? 96;
  const useAudio = probe.hasAudio && !options.forceNoAudio;
  const audioKbps = useAudio ? audioKbpsDefault : 0;
  const requestedBytes = options.targetEffectiveBytes ?? TARGET_EFFECTIVE_BYTES;
  // Two-pass x264 overshoots its requested bitrate at the low bitrates this tool uses
  // (measured 1.5–6.5% on real recordings, worst on long clips). The fixed 0.2 MiB gap
  // between the effective target and the ceiling does not scale with duration, so aim
  // proportionally below the target instead. Single-pass CRF lands under the target
  // anyway, so this costs it nothing.
  const effectiveBytes =
    probe.durationSeconds >= 30
      ? Math.floor(requestedBytes * 0.92)
      : requestedBytes;
  const videoKbps = calculateVideoBitrate(
    effectiveBytes,
    probe.durationSeconds,
    audioKbps,
  );

  const singlePass = () =>
    runSinglePassEncode(
      ffmpegPath, inputPath, outputPath, videoKbps, useAudio, audioKbps,
      probe.durationSeconds, options,
    );

  // Use single-pass CRF for short videos to avoid two-pass frame mismatch errors.
  // Without a size target, two-pass has nothing to converge on, so always use CRF.
  if (options.noCeiling || probe.durationSeconds < 30) {
    await singlePass();
    return;
  }

  const workDir = join(tmpdir(), `felparizador-${randomUUID()}`);
  const passLogBase = join(workDir, "pass");
  await mkdir(workDir, { recursive: true });

  const pass1Args = [
    "-hide_banner",
    "-y",
    "-i",
    inputPath,
    // Must match pass 2 exactly, or pass 2 sees a different frame count and aborts.
    ...FPS_PASSTHROUGH,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    `${videoKbps}k`,
    "-pass",
    "1",
    "-passlogfile",
    passLogBase,
    "-an",
    "-f",
    "null",
    nullDevice(),
  ];

  const pass2Args = [
    "-hide_banner",
    "-y",
    "-i",
    inputPath,
    ...FPS_PASSTHROUGH,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    `${videoKbps}k`,
    "-pass",
    "2",
    "-passlogfile",
    passLogBase,
    ...(useAudio ? ["-c:a", "aac", "-b:a", `${audioKbps}k`] : ["-an"]),
    "-movflags",
    "+faststart",
    outputPath,
  ];

  const passes = [
    { phase: "pass1", args: pass1Args, label: "Pass 1" },
    { phase: "pass2", args: pass2Args, label: "Pass 2" },
  ] as const;

  try {
    for (const { phase, args, label } of passes) {
      const spinner = quiet
        ? null
        : ora({ text: SPINNER_TEXT[phase], color: "cyan" }).start();
      const result = await runFfmpegWithProgress(
        ffmpegPath, args, phase, probe.durationSeconds, options, spinner,
      );
      if (result.exitCode !== 0) {
        spinner?.fail(`${label} failed — falling back to single-pass`);
        // Surface why: a silent fallback hides real encoder problems behind a slow,
        // worse-quality retry.
        if (!quiet && result.stderr) console.error(result.stderr.slice(-800));
        await rm(workDir, { recursive: true, force: true });
        await singlePass();
        return;
      }
      spinner?.succeed(`${label} complete`);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** @internal */
export function __testOnlyParseTimeSeconds(line: string): number | null {
  return parseTimeSeconds(line);
}

/** @internal */
export function __testOnlyParseSpeed(line: string): number | null {
  return parseSpeed(line);
}
