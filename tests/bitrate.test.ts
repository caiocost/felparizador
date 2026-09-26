import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateVideoBitrate,
  capAudioKbps,
  pickOutputSize,
  TARGET_EFFECTIVE_MIB,
  TARGET_CEILING_MIB,
  TARGET_EFFECTIVE_BYTES,
  TARGET_CEILING_BYTES,
  targetBytesFromCeilingMiB,
} from '../src/bitrate.ts';

describe('targetBytesFromCeilingMiB', () => {
  it('matches default 9.6 / 9.8 constants when ceiling is 9.8', () => {
    const { effectiveBytes, ceilingBytes } = targetBytesFromCeilingMiB(9.8);
    assert.strictEqual(effectiveBytes, TARGET_EFFECTIVE_BYTES);
    assert.strictEqual(ceilingBytes, TARGET_CEILING_BYTES);
  });
});

describe('calculateVideoBitrate', () => {
  it('returns 1246 kbps for a 60-second video with 96 kbps audio at 9.6 MiB target', () => {
    // Manual calculation:
    //   targetSizeBytes = Math.floor(9.6 * 1_048_576) = 10,066,329
    //   audioBitsTotal  = 96 * 1000 * 60 = 5,760,000 bits
    //   availableBits   = 10,066,329 * 8 - 5,760,000 = 74,770,632 bits
    //   videoBitrateKbps = floor(74,770,632 / 60 / 1000) = floor(1246.177) = 1246
    const result = calculateVideoBitrate(TARGET_EFFECTIVE_BYTES, 60, 96);
    assert.strictEqual(result, 1246);
  });

  it('returns at least 1 kbps for a 24-hour video (extreme edge case)', () => {
    // At 86400 seconds with 96 kbps audio, audio alone needs ~1,036,800,000 bytes
    // which exceeds the 10MB target — formula would go negative without the guard
    const result = calculateVideoBitrate(TARGET_EFFECTIVE_BYTES, 86400, 96);
    assert.ok(result >= 1, `Expected >= 1 kbps, got ${result}`);
  });

  it('returns higher bitrate when audio is absent (0 kbps)', () => {
    const withAudio = calculateVideoBitrate(TARGET_EFFECTIVE_BYTES, 60, 96);
    const withoutAudio = calculateVideoBitrate(TARGET_EFFECTIVE_BYTES, 60, 0);
    assert.ok(
      withoutAudio > withAudio,
      `Without audio (${withoutAudio}) should be > with audio (${withAudio})`,
    );
  });

  it('always returns an integer (Math.floor applied)', () => {
    const result = calculateVideoBitrate(TARGET_EFFECTIVE_BYTES, 7, 96);
    assert.strictEqual(result, Math.floor(result), 'Result must be an integer');
  });

  it('returns correct value for a 1-second video with 96 kbps audio', () => {
    // Manual calculation:
    //   audioBitsTotal  = 96 * 1000 * 1 = 96,000 bits
    //   availableBits   = 10,066,329 * 8 - 96,000 = 80,434,632 bits
    //   videoBitrateKbps = floor(80,434,632 / 1 / 1000) = 80434
    const result = calculateVideoBitrate(TARGET_EFFECTIVE_BYTES, 1, 96);
    assert.strictEqual(result, 80434);
  });

  it('returns at least 1 kbps even for impossibly large audio budget', () => {
    // 10000 kbps audio for 60 seconds = 600,000,000 bits, far exceeding target
    const result = calculateVideoBitrate(TARGET_EFFECTIVE_BYTES, 60, 10000);
    assert.strictEqual(result, 1, 'Minimum guard should clamp to 1 kbps');
  });

  it('handles fractional duration correctly', () => {
    // 30.5 seconds — result should still be a floored integer
    const result = calculateVideoBitrate(TARGET_EFFECTIVE_BYTES, 30.5, 96);
    assert.strictEqual(result, Math.floor(result), 'Result must be an integer for fractional duration');
    assert.ok(result > 0, 'Result must be positive');
  });
});

describe('Size constants', () => {
  it('TARGET_EFFECTIVE_BYTES is Math.floor(9.6 * 1,048,576) = 10,066,329', () => {
    assert.strictEqual(TARGET_EFFECTIVE_BYTES, Math.floor(9.6 * 1_048_576));
    assert.strictEqual(TARGET_EFFECTIVE_BYTES, 10_066_329);
  });

  it('TARGET_CEILING_BYTES is Math.floor(9.8 * 1,048,576) = 10,276,044', () => {
    assert.strictEqual(TARGET_CEILING_BYTES, Math.floor(9.8 * 1_048_576));
    assert.strictEqual(TARGET_CEILING_BYTES, 10_276_044);
  });

  it('effective target is strictly less than ceiling', () => {
    assert.ok(
      TARGET_EFFECTIVE_BYTES < TARGET_CEILING_BYTES,
      `Effective (${TARGET_EFFECTIVE_BYTES}) must be < ceiling (${TARGET_CEILING_BYTES})`,
    );
  });

  it('TARGET_EFFECTIVE_MIB is 9.6', () => {
    assert.strictEqual(TARGET_EFFECTIVE_MIB, 9.6);
  });

  it('TARGET_CEILING_MIB is 9.8', () => {
    assert.strictEqual(TARGET_CEILING_MIB, 9.8);
  });

  it('constants use binary MiB (1,048,576 bytes) not decimal MB (1,000,000 bytes)', () => {
    // If decimal MB were used, TARGET_EFFECTIVE_BYTES would be 9,600,000
    // With binary MiB, it should be 10,066,329
    assert.ok(
      TARGET_EFFECTIVE_BYTES > 10_000_000,
      `Expected > 10,000,000 (binary MiB), got ${TARGET_EFFECTIVE_BYTES} — likely using decimal MB`,
    );
  });
});

// Budget encodeVideo uses for clips >= 30 s: 9.6 MiB with its 8% overshoot margin.
const LONG_BUDGET = Math.floor(TARGET_EFFECTIVE_BYTES * 0.92);

describe('capAudioKbps', () => {
  it('keeps the requested bitrate when audio is a small share of the budget', () => {
    assert.strictEqual(capAudioKbps(96, LONG_BUDGET, 127), 96);
  });

  it('lowers audio on long clips, where 96 kbps would eat ~40% of the budget', () => {
    // 300 s: the whole file averages ~247 kbps, so 96 kbps of audio starved the video.
    assert.strictEqual(capAudioKbps(96, LONG_BUDGET, 300), 49);
  });

  it('never drops below 48 kbps, however long the clip', () => {
    assert.strictEqual(capAudioKbps(96, LONG_BUDGET, 3600), 48);
  });

  it('never raises a bitrate the user set below the floor', () => {
    assert.strictEqual(capAudioKbps(32, LONG_BUDGET, 3600), 32);
    assert.strictEqual(capAudioKbps(0, LONG_BUDGET, 300), 0);
  });
});

describe('pickOutputSize', () => {
  // Expected sizes are the best-scoring (VMAF) choice measured on real recordings.
  it('keeps native resolution when bits per pixel are plentiful (44 s clip)', () => {
    assert.deepStrictEqual(pickOutputSize(720, 1012, 1571), { width: 720, height: 1012 });
  });

  it('steps down to 480 on a ~2 min 720p recording', () => {
    assert.deepStrictEqual(pickOutputSize(720, 1280, 486), { width: 480, height: 854 });
  });

  it('steps down to 360 on a busy ~3 min recording, where 480 still looked starved', () => {
    assert.deepStrictEqual(pickOutputSize(720, 1292, 355), { width: 360, height: 646 });
  });

  it('steps down to 360 on a ~5 min recording, keeping the aspect ratio and even sizes', () => {
    assert.deepStrictEqual(pickOutputSize(720, 1132, 198), { width: 360, height: 566 });
    assert.deepStrictEqual(pickOutputSize(1280, 720, 221), { width: 640, height: 360 });
  });

  it('stops at 360 even when the budget is hopeless — text below that is unreadable', () => {
    assert.deepStrictEqual(pickOutputSize(1920, 1080, 20), { width: 640, height: 360 });
  });

  it('never upscales a source that is already small', () => {
    assert.deepStrictEqual(pickOutputSize(396, 360, 50), { width: 396, height: 360 });
    assert.deepStrictEqual(pickOutputSize(320, 180, 10), { width: 320, height: 180 });
  });

  it('takes the largest rung that fits, not the smallest', () => {
    assert.deepStrictEqual(pickOutputSize(2560, 1440, 2400), { width: 1920, height: 1080 });
  });
});
