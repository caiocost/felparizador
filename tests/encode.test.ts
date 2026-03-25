import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { __testOnlyParseTimeSeconds } from '../src/encode.ts';

describe('encode progress parse', () => {
  it('parses ffmpeg time= from stderr line', () => {
    const t = __testOnlyParseTimeSeconds('frame=  100 fps= 25 q=28.0 size=     512kB time=00:00:02.50 bitrate=...');
    assert.ok(t !== null && Math.abs(t - 2.5) < 0.01);
  });

  it('returns null when no time=', () => {
    assert.strictEqual(__testOnlyParseTimeSeconds('configuration: --enable-libx264'), null);
  });
});
