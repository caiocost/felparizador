// src/probe.ts — STUB: fully implemented in Phase 2
// ffmpeg-static is a CJS package; with NodeNext resolution the default export type is
// not directly inferred, so we cast through unknown to the documented string | null type.
import ffmpegStaticRaw from 'ffmpeg-static';
const ffmpegStaticPath = ffmpegStaticRaw as unknown as string | null;

/** Result of probing a video file with ffprobe */
export interface ProbeResult {
  durationSeconds: number;
  hasAudio: boolean;
  audioBitrateKbps: number;
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
  // Phase 2 will add: check system PATH via 'which'/'where'
  return null;
}

/** Stub — throws until implemented in Phase 2 */
export async function probeVideo(_inputPath: string): Promise<ProbeResult> {
  throw new Error('probe.ts not yet implemented — see Phase 2');
}
