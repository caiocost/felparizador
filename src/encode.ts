import { execa } from "execa";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import ora from "ora";

import { calculateVideoBitrate, TARGET_EFFECTIVE_BYTES } from "./bitrate.js";
import { EncodingFailedError, FfmpegNotFoundError } from "./errors.js";
import {
  ffmpegInstallMessage,
  probeVideo,
  resolveFfmpegPath,
} from "./probe.js";

export type EncodeProgressEvent = {
  phase: "pass1" | "pass2" | "single";
  /** null = indeterminate (pass 1 start), 0–100 for pass 2/single */
  percent: number | null;
};

export interface EncodeOptions {
  ffmpegPath?: string;
  signal?: AbortSignal;
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

async function runSinglePassEncode(
  ffmpegPath: string,
  inputPath: string,
  outputPath: string,
  videoKbps: number,
  useAudio: boolean,
  audioKbps: number,
  duration: number,
  options: EncodeOptions,
  quiet: boolean,
  onProgress: ((e: EncodeProgressEvent) => void) | undefined,
): Promise<void> {
  const spinner = quiet
    ? null
    : ora({ text: "Encoding (CRF single-pass)…", color: "cyan" }).start();

  if (quiet) {
    onProgress?.({ phase: "single", percent: 0 });
  }

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

  const subprocess = execa(ffmpegPath, args, {
    cancelSignal: options.signal,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    reject: false,
  });

  let lastPct = -1;

  if (subprocess.stderr) {
    const rl = createInterface({ input: subprocess.stderr });
    rl.on("line", (line) => {
      const t = parseTimeSeconds(line);
      if (t === null) return;
      const pct = Math.min(100, (t / duration) * 100);
      if (Math.floor(pct) !== Math.floor(lastPct)) {
        lastPct = pct;
        if (quiet) {
          onProgress?.({ phase: "single", percent: pct });
        } else if (spinner) {
          spinner.text = `Encoding (CRF single-pass)… ${pct.toFixed(0)}%`;
        }
      }
    });
  }

  const result = await subprocess;
  if (result.exitCode !== 0) {
    spinner?.fail("Encoding failed");
    throw new EncodingFailedError(
      result.stderr?.slice(-2000) ?? `ffmpeg exited ${result.exitCode}`,
    );
  }
  spinner?.succeed("Encoding complete");
  if (quiet) {
    onProgress?.({ phase: "single", percent: 100 });
  }
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

  const probe = await probeVideo(inputPath);
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

  const quiet = options.quiet === true;
  const onProgress = options.onProgress;

  // Use single-pass CRF for short videos to avoid two-pass frame mismatch errors.
  // Without a size target, two-pass has nothing to converge on, so always use CRF.
  if (options.noCeiling || probe.durationSeconds < 30) {
    await runSinglePassEncode(
      ffmpegPath, inputPath, outputPath, videoKbps, useAudio, audioKbps,
      probe.durationSeconds, options, quiet, onProgress,
    );
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

  let spinner = quiet
    ? null
    : ora({ text: "Pass 1 (analysis)…", color: "cyan" }).start();

  try {
    if (quiet) onProgress?.({ phase: "pass1", percent: null });
    try {
      await execa(ffmpegPath, pass1Args, {
        cancelSignal: options.signal,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      spinner?.fail("Pass 1 failed — falling back to single-pass");
      // Fallback to single-pass if two-pass fails. Surface why: a silent fallback
      // hides real encoder problems behind a slow, worse-quality retry.
      if (!quiet) {
        const stderr = (err as { stderr?: string }).stderr;
        if (stderr) console.error(stderr.slice(-800));
      }
      await rm(workDir, { recursive: true, force: true });
      await runSinglePassEncode(
        ffmpegPath, inputPath, outputPath, videoKbps, useAudio, audioKbps,
        probe.durationSeconds, options, quiet, onProgress,
      );
      return;
    }
    if (quiet) {
      onProgress?.({ phase: "pass1", percent: 100 });
    } else {
      spinner?.succeed("Pass 1 complete");
    }

    if (!quiet) {
      spinner = ora({ text: "Pass 2 (encode)…", color: "cyan" }).start();
    } else {
      onProgress?.({ phase: "pass2", percent: 0 });
    }

    const subprocess = execa(ffmpegPath, pass2Args, {
      cancelSignal: options.signal,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
      reject: false,
    });

    const duration = Math.max(probe.durationSeconds, 0.001);
    let lastPct = -1;

    if (subprocess.stderr) {
      const rl = createInterface({ input: subprocess.stderr });
      rl.on("line", (line) => {
        const t = parseTimeSeconds(line);
        if (t === null) return;
        const pct = Math.min(100, (t / duration) * 100);
        if (Math.floor(pct) !== Math.floor(lastPct)) {
          lastPct = pct;
          if (quiet) {
            onProgress?.({ phase: "pass2", percent: pct });
          } else if (spinner) {
            spinner.text = `Pass 2 (encode)… ${pct.toFixed(0)}%`;
          }
        }
      });
    }

    const result = await subprocess;
    if (result.exitCode !== 0) {
      spinner?.fail("Pass 2 failed — falling back to single-pass");
      if (!quiet && result.stderr) console.error(result.stderr.slice(-800));
      // Fallback to single-pass if two-pass fails
      await rm(workDir, { recursive: true, force: true });
      await runSinglePassEncode(
        ffmpegPath, inputPath, outputPath, videoKbps, useAudio, audioKbps,
        probe.durationSeconds, options, quiet, onProgress,
      );
      return;
    }
    if (quiet) {
      onProgress?.({ phase: "pass2", percent: 100 });
    } else {
      spinner?.succeed("Pass 2 complete");
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

/** @internal */
export function __testOnlyParseTimeSeconds(line: string): number | null {
  return parseTimeSeconds(line);
}
