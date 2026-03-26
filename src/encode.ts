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
  phase: "pass1" | "pass2";
  /** null = indeterminate (pass 1 start), 0–100 for pass 2 */
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
  /** Skip terminal spinner (Electron / programmatic use) */
  quiet?: boolean;
  /** Fired during encode when `quiet` is true (and optional alongside CLI spinner) */
  onProgress?: (evt: EncodeProgressEvent) => void;
}

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

/**
 * Two-pass H.264 + AAC encode targeting ~9.6 MiB effective size (see bitrate.ts).
 * Passlog files live under a unique temp directory per run (ENC-04/05).
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
  const effectiveBytes = options.targetEffectiveBytes ?? TARGET_EFFECTIVE_BYTES;
  const videoKbps = calculateVideoBitrate(
    effectiveBytes,
    probe.durationSeconds,
    audioKbps,
  );

  const workDir = join(tmpdir(), `ffmpeg10mb-${randomUUID()}`);
  const passLogBase = join(workDir, "pass");
  await mkdir(workDir, { recursive: true });

  const pass1Args = [
    "-hide_banner",
    "-y",
    "-i",
    inputPath,
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

  const quiet = options.quiet === true;
  const onProgress = options.onProgress;
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
      spinner?.fail("Pass 1 failed");
      throw new EncodingFailedError(
        err instanceof Error ? err.message : String(err),
      );
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
      spinner?.fail("Pass 2 failed");
      throw new EncodingFailedError(
        result.stderr?.slice(-2000) ?? `ffmpeg exited ${result.exitCode}`,
      );
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
