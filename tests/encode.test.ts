import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execa } from 'execa';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { __testOnlyParseTimeSeconds, encodeVideo } from '../src/encode.ts';

const FIXTURE_DIR = resolve(import.meta.dirname, 'fixtures');
const SHORT_MP4 = resolve(FIXTURE_DIR, 'short.mp4');

describe('encode progress parse', () => {
  it('parses ffmpeg time= from stderr line', () => {
    const t = __testOnlyParseTimeSeconds('frame=  100 fps= 25 q=28.0 size=     512kB time=00:00:02.50 bitrate=...');
    assert.ok(t !== null && Math.abs(t - 2.5) < 0.01);
  });

  it('returns null when no time=', () => {
    assert.strictEqual(__testOnlyParseTimeSeconds('configuration: --enable-libx264'), null);
  });
});

describe('encodeVideo — frame count', () => {
  it('does not duplicate frames when re-encoding', async () => {
    // Guards -fps_mode passthrough. Browser MediaRecorder WebM reports r_frame_rate=1000/1,
    // and without passthrough ffmpeg duplicates frames up to that nominal rate — which made
    // encodes ~11x slower, broke two-pass ("2nd pass has more frames than 1st pass"), and
    // blew past the size ceiling.
    const dir = await mkdtemp(join(tmpdir(), 'felparizador-test-'));
    try {
      const out = join(dir, 'out.mp4');
      await encodeVideo(SHORT_MP4, out, { noCeiling: true, quiet: true });

      const countFrames = async (file: string): Promise<number> => {
        const { stdout } = await execa('ffprobe', [
          '-v', 'error', '-select_streams', 'v:0', '-count_packets',
          '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file,
        ]);
        return parseInt(stdout.trim(), 10);
      };

      const inFrames = await countFrames(SHORT_MP4);
      const outFrames = await countFrames(out);
      assert.ok(inFrames > 0, 'fixture should have frames');
      assert.strictEqual(
        outFrames,
        inFrames,
        `frame count changed: ${inFrames} in, ${outFrames} out`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('encodeVideo — noCeiling', () => {
  it('produces a larger file at a lower CRF, unconstrained by any size target', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'felparizador-test-'));
    try {
      const lowQuality = join(dir, 'crf40.mp4');
      const highQuality = join(dir, 'crf10.mp4');

      await encodeVideo(SHORT_MP4, lowQuality, { noCeiling: true, crf: 40, quiet: true });
      await encodeVideo(SHORT_MP4, highQuality, { noCeiling: true, crf: 10, quiet: true });

      const lowSize = (await stat(lowQuality)).size;
      const highSize = (await stat(highQuality)).size;

      assert.ok(lowSize > 0 && highSize > 0);
      assert.ok(
        highSize > lowSize,
        `expected crf 10 (${highSize}) to be larger than crf 40 (${lowSize})`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
