/**
 * Base error class for all felparizador tool errors.
 * Each subclass carries a numeric exitCode for process.exit().
 */
export class FfmpegToolError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** exitCode 2: input file validation failures (not found, not readable, not a video) */
export class InputValidationError extends FfmpegToolError {
  constructor(message: string) { super(message, 2); }
}

/** exitCode 3: FFmpeg/ffprobe binary not found anywhere in resolution chain */
export class FfmpegNotFoundError extends FfmpegToolError {
  constructor(message: string) { super(message, 3); }
}

/** exitCode 4: FFmpeg subprocess returned non-zero during encoding */
export class EncodingFailedError extends FfmpegToolError {
  constructor(message: string) { super(message, 4); }
}

/** exitCode 5: output file exceeds TARGET_CEILING_MIB after encoding */
export class OutputOversizeError extends FfmpegToolError {
  constructor(message: string) { super(message, 5); }
}

/** exitCode 6: the caller aborted the encode via `signal` (e.g. the GUI's stop button) */
export class EncodingCancelledError extends FfmpegToolError {
  constructor(message = "Encoding cancelled") { super(message, 6); }
}
