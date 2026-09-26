// ffmpeg-static is a CJS package; with NodeNext resolution the default export type is
// not directly inferred, so we cast through unknown to the documented string | null type.
import ffmpegStaticRaw from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { execa } from 'execa';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';

import { FfmpegNotFoundError, InputValidationError } from './errors.js';

// In the packaged Electron app the binary is unpacked next to app.asar (see "asarUnpack"
// in package.json) — a path inside the archive can't be spawned.
const ffmpegStaticPath =
  (ffmpegStaticRaw as unknown as string | null)?.replace(
    /app\.asar([\\/])/,
    'app.asar.unpacked$1',
  ) ?? null;
const ffprobeStaticPath = ffprobeStatic.path.replace(
  /app\.asar([\\/])/,
  'app.asar.unpacked$1',
);

/** Result of probing a video file with ffprobe */
export interface ProbeResult {
  durationSeconds: number;
  hasAudio: boolean;
  audioBitrateKbps: number;
  widthPx: number;
  heightPx: number;
  fileSizeBytes: number;
}

/** Shared install hint when FFmpeg binary cannot be resolved (encoding path). */
export function ffmpegInstallMessage(): string {
  return buildInstallMessage();
}

function buildInstallMessage(): string {
  switch (process.platform) {
    case 'darwin':
      return `Error: FFmpeg not found.

To fix:
  brew install ffmpeg
  # or download from https://ffmpeg.org/download.html`;
    case 'win32':
      return `Error: FFmpeg not found.

To fix:
  winget install Gyan.FFmpeg
  # or download from https://ffmpeg.org/download.html#build-windows
  # Note: restart your terminal after installation`;
    default:
      return `Error: FFmpeg not found.

To fix:
  sudo apt install ffmpeg   # Ubuntu/Debian
  sudo dnf install ffmpeg   # Fedora
  # or download from https://ffmpeg.org/download.html`;
  }
}

/**
 * Resolves the FFmpeg binary path in priority order:
 *   1. --ffmpeg-path CLI flag value (not yet wired in Phase 1)
 *   2. ffmpeg-static bundled binary
 *   3. System PATH (fallback — implemented in Phase 2)
 * Returns null if no binary is found anywhere.
 */
export function resolveFfmpegPath(cliFlag?: string): string | null {
  if (cliFlag) return cliFlag;
  if (ffmpegStaticPath) return ffmpegStaticPath;
  return null;
}

/**
 * Resolves ffprobe: optional CLI override, then PATH, then next to bundled ffmpeg-static,
 * then the ffprobe-static binary — the packaged app runs on machines with no ffmpeg install.
 */
export async function resolveFfprobePath(cliFlag?: string): Promise<string> {
  if (cliFlag) return cliFlag;

  const name = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
  const candidates = [
    'ffprobe',
    ...(ffmpegStaticPath ? [join(dirname(ffmpegStaticPath), name)] : []),
    ffprobeStaticPath,
  ];
  for (const candidate of candidates) {
    // Any failure means "not usable here", not just ENOENT: on Windows a command missing
    // from PATH can come back as exit code 1 from cmd.exe ("não é reconhecido…").
    try {
      await execa(candidate, ['-version']);
      return candidate;
    } catch {
      // try the next candidate
    }
  }

  throw new FfmpegNotFoundError(buildInstallMessage());
}

/**
 * Last-resort duration probe for containers that carry no duration in their header —
 * notably WebM/Matroska written by browser MediaRecorder, which leaves the Segment
 * duration unset. Reads packet timestamps of the given stream and returns the end
 * time of the last one. Only timestamps are decoded, so this stays fast even on
 * large files.
 */
async function probeDurationFromPackets(
  ffprobePath: string,
  inputPath: string,
  streamSpecifier: string,
): Promise<number> {
  const { stdout } = await execa(ffprobePath, [
    '-v',
    'quiet',
    '-select_streams',
    streamSpecifier,
    '-show_entries',
    'packet=pts_time,duration_time',
    '-print_format',
    'csv=p=0',
    inputPath,
  ]);

  let end = Number.NaN;
  for (const line of stdout.split('\n')) {
    const [ptsRaw, durRaw] = line.trim().split(',');
    if (ptsRaw === undefined) continue;
    const pts = parseFloat(ptsRaw);
    if (Number.isNaN(pts)) continue;
    const dur = parseFloat(durRaw ?? '');
    const candidate = pts + (Number.isNaN(dur) ? 0 : dur);
    if (Number.isNaN(end) || candidate > end) end = candidate;
  }
  return end;
}

async function validateInputFile(inputPath: string): Promise<void> {
  try {
    await access(inputPath, constants.R_OK);
  } catch {
    throw new InputValidationError(`Input file not found or not readable: ${inputPath}`);
  }
}

export async function probeVideo(inputPath: string): Promise<ProbeResult> {
  const ffprobePath = await resolveFfprobePath();
  await validateInputFile(inputPath);

  const { stdout } = await execa(ffprobePath, [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_streams',
    '-show_format',
    inputPath,
  ]);

  const data = JSON.parse(stdout) as {
    format?: { duration?: string; size?: string };
    streams?: Array<{
      codec_type?: string;
      duration?: string;
      width?: number;
      height?: number;
      bit_rate?: string;
    }>;
  };

  let durationSeconds = Number.NaN;
  const formatDur = data.format?.duration;
  if (formatDur !== undefined && formatDur !== 'N/A') {
    durationSeconds = parseFloat(formatDur);
  }
  if (Number.isNaN(durationSeconds)) {
    const videoStream = data.streams?.find((s) => s.codec_type === 'video');
    const sd = videoStream?.duration;
    if (sd !== undefined && sd !== 'N/A') durationSeconds = parseFloat(sd);
  }
  if (Number.isNaN(durationSeconds)) {
    durationSeconds = await probeDurationFromPackets(ffprobePath, inputPath, 'v:0');
  }
  if (Number.isNaN(durationSeconds)) {
    // Audio-only inputs, or video streams whose packets carry no timestamps.
    durationSeconds = await probeDurationFromPackets(ffprobePath, inputPath, 'a:0');
  }
  if (Number.isNaN(durationSeconds) || durationSeconds <= 0) {
    throw new InputValidationError('Could not determine video duration');
  }

  const videoStream = data.streams?.find((s) => s.codec_type === 'video');
  const audioStream = data.streams?.find((s) => s.codec_type === 'audio');

  const widthPx = videoStream?.width ?? 0;
  const heightPx = videoStream?.height ?? 0;
  const fileSizeBytes = parseInt(data.format?.size ?? '0', 10);

  return {
    durationSeconds,
    hasAudio: audioStream !== undefined,
    audioBitrateKbps: audioStream
      ? Math.round(parseInt(audioStream.bit_rate ?? '128000', 10) / 1000)
      : 0,
    widthPx,
    heightPx,
    fileSizeBytes,
  };
}
