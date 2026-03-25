// ffmpeg-static is a CJS package; with NodeNext resolution the default export type is
// not directly inferred, so we cast through unknown to the documented string | null type.
import ffmpegStaticRaw from 'ffmpeg-static';
import { execa } from 'execa';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';

import { FfmpegNotFoundError, InputValidationError } from './errors.js';

const ffmpegStaticPath = ffmpegStaticRaw as unknown as string | null;

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
 * Resolves ffprobe: optional CLI override, then PATH, then next to bundled ffmpeg-static.
 */
export async function resolveFfprobePath(cliFlag?: string): Promise<string> {
  if (cliFlag) return cliFlag;

  try {
    await execa('ffprobe', ['-version']);
    return 'ffprobe';
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
  }

  if (ffmpegStaticPath) {
    const dir = dirname(ffmpegStaticPath);
    const name = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const adjacent = join(dir, name);
    try {
      await execa(adjacent, ['-version']);
      return adjacent;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw err;
    }
  }

  throw new FfmpegNotFoundError(buildInstallMessage());
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
    if (sd !== undefined) durationSeconds = parseFloat(sd);
  }
  if (Number.isNaN(durationSeconds)) {
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
