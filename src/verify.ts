import { stat } from 'node:fs/promises';

import { TARGET_CEILING_BYTES, TARGET_CEILING_MIB } from './bitrate.js';
import { OutputOversizeError } from './errors.js';

export interface VerifyResult {
  sizeBytes: number;
  /** True when over target ceiling but still within flexibleCeilingBytes (e.g. two-pass overshoot) */
  warnAboveTarget?: boolean;
}

export interface VerifyOptions {
  ceilingBytes?: number;
  ceilingMiB?: number;
  /**
   * If set, files between ceilingBytes and this value succeed with warnAboveTarget
   * instead of throwing (strict ceiling is still the primary target).
   */
  flexibleCeilingBytes?: number;
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
    const flex = options.flexibleCeilingBytes;
    if (flex !== undefined && s.size <= flex) {
      return { sizeBytes: s.size, warnAboveTarget: true };
    }
    throw new OutputOversizeError(
      `Output exceeds ${ceilingMiB} MiB ceiling (${s.size} bytes > ${ceilingBytes} bytes)`,
    );
  }
  return { sizeBytes: s.size };
}
