import { stat } from 'node:fs/promises';

import { TARGET_CEILING_BYTES, TARGET_CEILING_MIB } from './bitrate.js';
import { OutputOversizeError } from './errors.js';

export interface VerifyResult {
  sizeBytes: number;
}

export interface VerifyOptions {
  ceilingBytes?: number;
  ceilingMiB?: number;
}

/**
 * Ensures encoded output does not exceed the hard ceiling (VER-01).
 */
export async function verifyOutput(
  outputPath: string,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const ceilingBytes = options.ceilingBytes ?? TARGET_CEILING_BYTES;
  const ceilingMiB = options.ceilingMiB ?? TARGET_CEILING_MIB;
  const s = await stat(outputPath);
  if (s.size > ceilingBytes) {
    throw new OutputOversizeError(
      `Output exceeds ${ceilingMiB} MiB ceiling (${s.size} bytes > ${ceilingBytes} bytes)`,
    );
  }
  return { sizeBytes: s.size };
}
