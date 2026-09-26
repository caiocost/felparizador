import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execa } from 'execa';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  __testOnlyParseSpeed,
  __testOnlyParseTimeSeconds,
  encodeVideo,
  type EncodeProgressEvent,
} from '../src/encode.ts';
import { EncodingCancelledError } from '../src/errors.ts';
import { resolveFfmpegPath } from '../src/probe.ts';

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

  it('parses ffmpeg speed= from stderr line', () => {
    const line = 'frame= 900 fps=112 q=-0.0 size=N/A time=00:00:30.00 bitrate=N/A speed=3.74x';
    assert.strictEqual(__testOnlyParseSpeed(line), 3.74);
    assert.strictEqual(__testOnlyParseSpeed('speed=   0x'), null);
    assert.strictEqual(__testOnlyParseSpeed('speed=N/A'), null);
  });
});

/** ≥ 30s so encodeVideo takes the two-pass path. */
async function makeLongInput(dir: string): Promise<string> {
  const input = join(dir, 'long.mp4');
  await execa(resolveFfmpegPath()!, [
    '-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30',
    '-t', '32', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', input,
  ]);
  return input;
}

describe('encodeVideo — cancel', () => {
  it('stops ffmpeg and rejects with EncodingCancelledError instead of falling back', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'felparizador-test-'));
    try {
      const input = await makeLongInput(dir);
      const ac = new AbortController();
      const phases: string[] = [];
      const pids: number[] = [];
      const started = Date.now();
      await assert.rejects(
        encodeVideo(input, join(dir, 'out.mp4'), {
          quiet: true,
          signal: ac.signal,
          onSpawn: (pid) => pids.push(pid),
          onProgress: (e) => {
            phases.push(e.phase);
            if (e.phase === 'pass1' && (e.percent ?? 0) > 0) ac.abort();
          },
        }),
        EncodingCancelledError,
      );
      assert.ok(pids.length === 1, `expected only pass 1 to start, got ${pids.length} processes`);
      assert.ok(!phases.includes('single'), 'cancel must not trigger the single-pass fallback');
      assert.ok(Date.now() - started < 20_000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('encodeVideo — two-pass progress', () => {
  it('reports intermediate progress during pass 1, not just start and end', async () => {
    // Pass 1 used to report nothing until it finished, so the GUI sat on a fixed 25%
    // for minutes on long recordings and looked frozen.
    const dir = await mkdtemp(join(tmpdir(), 'felparizador-test-'));
    try {
      const input = await makeLongInput(dir);

      const events: EncodeProgressEvent[] = [];
      await encodeVideo(input, join(dir, 'out.mp4'), {
        quiet: true,
        onProgress: (e) => events.push(e),
      });

      assert.strictEqual(events[0]?.phase, 'probe');
      const pass1Mid = events.filter(
        (e) => e.phase === 'pass1' && e.percent !== null && e.percent > 0 && e.percent < 100,
      );
      assert.ok(pass1Mid.length > 0, `no intermediate pass1 progress: ${JSON.stringify(events)}`);
      assert.ok(events.some((e) => e.phase === 'pass2' && e.percent === 100));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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

describe('encodeVideo — duration-aware resolution', () => {
  async function frameSize(file: string): Promise<string> {
    const { stdout } = await execa('ffprobe', [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file,
    ]);
    return stdout.trim();
  }

  it('downscales when the budget leaves too few bits per pixel, and not otherwise', async () => {
    // Long clips at a fixed size budget used to keep full resolution with ~150 kbps
    // of video and fell apart; fewer pixels with the same bits look far better.
    const dir = await mkdtemp(join(tmpdir(), 'felparizador-test-'));
    try {
      const input = join(dir, 'hd.mp4');
      await execa(resolveFfmpegPath()!, [
        '-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30',
        '-t', '32', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', input,
      ]);

      // ~240 kbps for 32 s of 720p: far below the bits-per-pixel floor.
      const tight = join(dir, 'tight.mp4');
      await encodeVideo(input, tight, { quiet: true, targetEffectiveBytes: 1_048_576 });
      assert.strictEqual(await frameSize(tight), '640x360');

      // Convert-only has no budget to fit, so it never trades resolution away.
      const convert = join(dir, 'convert.mp4');
      await encodeVideo(input, convert, { quiet: true, noCeiling: true, crf: 35 });
      assert.strictEqual(await frameSize(convert), '1280x720');
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
