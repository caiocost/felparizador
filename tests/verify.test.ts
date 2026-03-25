import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { TARGET_CEILING_BYTES } from '../src/bitrate.ts';
import { verifyOutput } from '../src/verify.ts';
import { OutputOversizeError } from '../src/errors.ts';

describe('verifyOutput', () => {
  let dir = '';
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'vfy-'));
  });
  after(async () => {
    try {
      await unlink(join(dir, 'small.bin'));
    } catch {
      /* ignore */
    }
    try {
      await unlink(join(dir, 'big.bin'));
    } catch {
      /* ignore */
    }
  });

  it('accepts file under ceiling', async () => {
    const p = join(dir, 'small.bin');
    await writeFile(p, Buffer.alloc(1024));
    const r = await verifyOutput(p);
    assert.strictEqual(r.sizeBytes, 1024);
  });

  it('rejects file over ceiling', async () => {
    const p = join(dir, 'big.bin');
    await writeFile(p, Buffer.alloc(TARGET_CEILING_BYTES + 1));
    await assert.rejects(() => verifyOutput(p), (e: unknown) => {
      assert.ok(e instanceof OutputOversizeError);
      return true;
    });
  });
});
