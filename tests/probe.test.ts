import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import { probeVideo, resolveFfprobePath } from '../src/probe.ts';
import { FfmpegNotFoundError, InputValidationError } from '../src/errors.ts';

const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures');
const SHORT_MP4 = resolve(FIXTURE_DIR, 'short.mp4');
const VIDEO_ONLY_MP4 = resolve(FIXTURE_DIR, 'video-only.mp4');

describe('resolveFfprobePath', () => {
  it('returns a string path when ffprobe is on PATH', async () => {
    const p = await resolveFfprobePath();
    assert.ok(typeof p === 'string' && p.length > 0);
  });
});

describe('FfmpegNotFoundError', () => {
  it('has exitCode 3 and message mentions FFmpeg not found', () => {
    const msg = `Error: FFmpeg not found.

To fix:
  winget install Gyan.FFmpeg`;
    const e = new FfmpegNotFoundError(msg);
    assert.strictEqual(e.exitCode, 3);
    assert.ok(e.message.includes('FFmpeg not found'));
  });
});

describe('probeVideo — INPUT-02', () => {
  it('throws InputValidationError when input file does not exist', async () => {
    await assert.rejects(
      () => probeVideo('/nonexistent/path/video.mp4'),
      (err: unknown) => {
        assert.ok(err instanceof InputValidationError);
        assert.ok((err as InputValidationError).message.includes('/nonexistent/path/video.mp4'));
        assert.strictEqual((err as InputValidationError).exitCode, 2);
        return true;
      },
    );
  });
});

describe('probeVideo — INPUT-03', () => {
  it('returns expected metadata for short.mp4', async () => {
    const r = await probeVideo(SHORT_MP4);
    assert.ok(Math.abs(r.durationSeconds - 3.0) < 0.5);
    assert.strictEqual(r.hasAudio, true);
    assert.ok(r.audioBitrateKbps > 0 && r.audioBitrateKbps <= 128);
    assert.strictEqual(r.widthPx, 320);
    assert.strictEqual(r.heightPx, 240);
    assert.ok(r.fileSizeBytes > 0);
  });

  it('returns expected metadata for video-only.mp4', async () => {
    const r = await probeVideo(VIDEO_ONLY_MP4);
    assert.strictEqual(r.hasAudio, false);
    assert.strictEqual(r.audioBitrateKbps, 0);
    assert.ok(Math.abs(r.durationSeconds - 10.0) < 0.5);
  });
});
