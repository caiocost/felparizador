import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateVideoBitrate,
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
