# Phase 1: Foundation - Research

**Researched:** 2026-03-25
**Domain:** Node.js 22 ESM project scaffolding, TypeScript configuration, pure bitrate calculator, typed error hierarchy, node:test unit tests
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Language and Module Format**
- TypeScript (not plain JS) — type safety is critical for the bitrate formula where a type mismatch is an 8x size error
- `"type": "module"` in package.json — ESM required because `execa` v9 and `ora` v9 are ESM-only
- `tsconfig.json` targeting Node.js 22 (`"target": "ES2022"`, `"module": "NodeNext"`)

**Project Structure**
- One file per concern in `src/`: `bitrate.ts`, `probe.ts`, `encode.ts`, `verify.ts`, `errors.ts`, `index.ts`
- Phase 1 creates: `errors.ts`, `bitrate.ts`, and test file(s)
- Other `src/` files are stubs or do not yet exist

**FFmpeg Dependency Strategy**
- `ffmpeg-static` as primary bundled binary (no system install required)
- `--ffmpeg-path <path>` CLI flag as escape hatch for users with a custom FFmpeg build
- Path resolution logic: check `--ffmpeg-path` first, then `ffmpeg-static`, then system PATH as last resort
- This logic lives in a `resolveFfmpegPath()` helper (stubbed in Phase 1, implemented in Phase 2)

**Size Constants**
- All size constants use **binary MiB** (1 MiB = 1,048,576 bytes), NOT decimal MB
- `TARGET_CEILING_MIB = 9.8` — the hard output ceiling; tool exits non-zero if exceeded
- `TARGET_EFFECTIVE_MIB = 9.6` — what the bitrate formula targets (leaves headroom for MP4 container overhead)
- Every constant must have a comment explaining: binary MiB not decimal MB, and why there are two values
- Variables in `bitrate.ts` must carry unit suffixes: `targetSizeBytes`, `videoBitrateKbps`, `audioBitsTotal`, `durationSeconds`

**Bitrate Formula**
- `videoBitrateKbps = Math.floor((targetSizeBytes * 8 - audioBitrateKbps * 1000 * durationSeconds) / durationSeconds / 1000)`
- All intermediate values in bits — never mix bytes and bits without explicit conversion
- The formula is a pure function: `calculateVideoBitrate(targetSizeBytes, durationSeconds, audioBitrateKbps) => number`
- Returns the bitrate in kbps as an integer (Math.floor)
- Must return a minimum of 1 kbps (guard against negative or zero for extreme edge cases)

**Error Hierarchy**
- Typed classes extending a base `FfmpegToolError extends Error`
- Each error class has: `exitCode: number` property and a human-readable `message`
- Exit codes: 1 = general error, 2 = input validation, 3 = FFmpeg not found, 4 = encoding failed, 5 = output oversize
- Phase 1 creates the base class and initial error types; additional types added in later phases

**Test Framework**
- Node.js built-in `node:test` with `node:assert` — zero extra dependencies
- Test file: `src/bitrate.test.ts` (or `test/bitrate.test.ts`)
- Tests cover: known-good inputs, edge cases (1-second video, very long video), minimum bitrate guard, units

### Claude's Discretion
- Exact `tsconfig.json` compiler options beyond the target/module settings
- npm script names (`test`, `build`, `start`, `dev`)
- Whether to use a `bin/` entry point or `src/index.ts` directly
- How stubs for future modules are structured (empty exports vs TODO comments)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FOUND-01 | Project uses Node.js 22 LTS with ESM modules (`"type": "module"`) | package.json structure, tsconfig.json NodeNext module setting, ffmpeg-static ESM compatibility confirmed |
| FOUND-02 | `ffmpeg-static` bundles FFmpeg binary so users don't need to install FFmpeg separately | ffmpeg-static v5.3.0 verified on npm; exports binary path via default export; resolveFfmpegPath() stub pattern documented |
| FOUND-03 | Bitrate calculator is a pure function with explicit unit-suffixed variable names | Formula verified with concrete numeric example; naming convention and minimum-1-kbps guard researched |
| FOUND-04 | Target size constant is defined as `9.6 MiB` (effective) with `9.8 MiB` as the ceiling, with comments explaining binary MiB convention | MiB vs MB distinction, dual-constant rationale, and comment template all documented |
</phase_requirements>

---

## Summary

Phase 1 is a pure scaffolding and math-proof phase. The goal is to establish the project skeleton — `package.json`, `tsconfig.json`, `errors.ts`, `bitrate.ts`, and unit tests — with zero I/O and no FFmpeg invocation. Everything built here is the foundation that all downstream phases import from, so correctness and naming discipline matter more than completeness.

The technology choices are fully locked: TypeScript 6.x, Node.js ESM (`"type": "module"`), `ffmpeg-static` v5.3.0 for binary bundling, and the Node.js built-in `node:test` runner for unit tests with zero added test dependencies. The bitrate formula is a pure function whose correctness is the project's core invariant — unit testing it with known-good inputs (not just checking that it runs) is the primary deliverable of this phase.

The two constants `TARGET_EFFECTIVE_MIB = 9.6` and `TARGET_CEILING_MIB = 9.8` are binary MiB values. This distinction must be captured in comments from day one because the MiB-vs-MB confusion is an unrecoverable design debt if left implicit.

**Primary recommendation:** Build `errors.ts` first (no deps), then `bitrate.ts` with its unit tests immediately, then package.json/tsconfig.json scaffolding with stub modules for future phases. This ordering means tests are green before any scaffolding complexity is introduced.

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 6.0.2 | Typed superset of JavaScript | Enforces unit suffixes at compile time; prevents bits/bytes confusion; required by project decision |
| Node.js | 22 LTS (target; env is 20.19.5) | Runtime | Long-term support until 2027; NodeNext module resolution; Maglev JIT |
| ffmpeg-static | 5.3.0 | Bundled FFmpeg binary path resolver | Eliminates system FFmpeg install requirement; 420K+ weekly downloads; exports binary path string |
| node:test | built-in | Unit test runner | Zero dependencies; available in Node.js 18+; supports `describe`/`it`/`test` syntax |
| node:assert | built-in | Assertions | Strict mode (`assert.strictEqual`) available; pairs with node:test |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| tsx | 4.21.0 | TypeScript runner for Node.js | Running `.ts` files directly during development and for the test script without a separate compile step |
| @types/node | 25.5.0 | TypeScript type definitions for Node.js built-ins | Required whenever TypeScript code imports `node:test`, `node:assert`, `node:path`, `node:os` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| node:test | vitest / jest | No extra dependency; node:test sufficient for pure unit tests; jest/vitest add value only when mocking I/O is needed (later phases) |
| tsx (runner) | ts-node | tsx is faster, ESM-native, requires no `tsconfig` changes to run; ts-node requires `--esm` flag and stricter config |
| TypeScript 6.x | TypeScript 5.x | TS 6 is current stable (6.0.2); both are compatible with NodeNext targets; use latest |

**Installation:**
```bash
npm install --save-dev typescript tsx @types/node
npm install ffmpeg-static
```

**Version verification (confirmed 2026-03-25):**
```
ffmpeg-static  5.3.0  (npm dist-tags.latest)
typescript     6.0.2  (npm dist-tags.latest)
tsx            4.21.0 (npm dist-tags.latest)
@types/node    25.5.0 (npm dist-tags.latest)
```

---

## Architecture Patterns

### Recommended Project Structure

```
ffmpeg10mb/
├── src/
│   ├── errors.ts         # Typed error hierarchy — built first, no deps
│   ├── bitrate.ts        # Pure bitrate calculator — built second, no deps
│   ├── probe.ts          # STUB: empty export, implemented in Phase 2
│   ├── encode.ts         # STUB: empty export, implemented in Phase 3
│   ├── verify.ts         # STUB: empty export, implemented in Phase 3
│   └── index.ts          # STUB: empty export, implemented in Phase 4
├── tests/
│   └── bitrate.test.ts   # Unit tests for bitrate.ts — no subprocess
├── package.json          # "type": "module", scripts, dependencies
└── tsconfig.json         # ES2022 target, NodeNext module
```

### Pattern 1: Pure Function Bitrate Calculator

**What:** `calculateVideoBitrate` takes three typed inputs and returns a number. No side effects, no I/O, no imports.

**When to use:** Exactly as implemented — the formula must be isolated so it can be unit-tested without any test infrastructure beyond `node:assert`.

**Example:**
```typescript
// src/bitrate.ts

// 1 MiB = 1,048,576 bytes (binary, NOT 1,000,000 decimal MB)
// TARGET_EFFECTIVE_MIB is lower than CEILING to leave headroom for MP4 moov atom overhead.
// Two-pass H.264 can overshoot by ~200KB on low-bitrate encodes.
export const TARGET_EFFECTIVE_MIB = 9.6; // binary MiB — what the formula targets
export const TARGET_CEILING_MIB = 9.8;   // binary MiB — hard limit; exit non-zero if exceeded

const MIB_TO_BYTES = 1_048_576; // 1024 * 1024

export const TARGET_EFFECTIVE_BYTES = TARGET_EFFECTIVE_MIB * MIB_TO_BYTES;
export const TARGET_CEILING_BYTES   = TARGET_CEILING_MIB  * MIB_TO_BYTES;

/**
 * Calculate the video bitrate needed to hit a target file size.
 *
 * All intermediate math is done in BITS to avoid mixing bytes and bits.
 * The formula: available_bits = (targetSizeBytes * 8) - (audioBitrateKbps * 1000 * durationSeconds)
 * Then convert available_bits to kbps: / durationSeconds / 1000
 *
 * @param targetSizeBytes  - Target file size in bytes (use TARGET_EFFECTIVE_BYTES)
 * @param durationSeconds  - Video duration in seconds (float)
 * @param audioBitrateKbps - Audio stream bitrate in kbps (0 if no audio)
 * @returns videoBitrateKbps as an integer >= 1
 */
export function calculateVideoBitrate(
  targetSizeBytes: number,
  durationSeconds: number,
  audioBitrateKbps: number,
): number {
  const audioBitsTotal = audioBitrateKbps * 1000 * durationSeconds;
  const availableBits  = targetSizeBytes * 8 - audioBitsTotal;
  const videoBitrateKbps = Math.floor(availableBits / durationSeconds / 1000);
  return Math.max(1, videoBitrateKbps); // never return 0 or negative
}
```

### Pattern 2: Typed Error Hierarchy

**What:** A base class with `exitCode: number` that all tool errors extend. Downstream code can `catch (e)` and check `instanceof FfmpegToolError` to decide exit behavior.

**When to use:** Every error path in the tool should throw a typed subclass, never a plain `new Error()`.

**Example:**
```typescript
// src/errors.ts

export class FfmpegToolError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

// exitCode 2: input validation failures
export class InputValidationError extends FfmpegToolError {
  constructor(message: string) { super(message, 2); }
}

// exitCode 3: FFmpeg binary not found anywhere in resolution chain
export class FfmpegNotFoundError extends FfmpegToolError {
  constructor(message: string) { super(message, 3); }
}

// exitCode 4: FFmpeg subprocess returned non-zero
export class EncodingFailedError extends FfmpegToolError {
  constructor(message: string) { super(message, 4); }
}

// exitCode 5: output file exceeds TARGET_CEILING_MIB after encoding
export class OutputOversizeError extends FfmpegToolError {
  constructor(message: string) { super(message, 5); }
}
```

### Pattern 3: Stub Modules for Future Phases

**What:** Files that future phases will implement are created as empty typed exports. This ensures TypeScript can compile the full project even before all functionality exists.

**When to use:** Phase 1 creates stubs for `probe.ts`, `encode.ts`, `verify.ts`, `index.ts`.

**Example:**
```typescript
// src/probe.ts — STUB: implemented in Phase 2
export interface ProbeResult {
  durationSeconds: number;
  hasAudio: boolean;
  audioBitrateKbps: number;
}

// Stub — throws until implemented
export async function probeVideo(_inputPath: string): Promise<ProbeResult> {
  throw new Error('probe.ts not yet implemented');
}
```

### Pattern 4: node:test Unit Test Structure

**What:** Tests run with `node --import tsx/esm --test tests/*.test.ts` (or a script alias). Each test exercises the pure function with known-good inputs and checks outputs with `assert.strictEqual`.

**When to use:** Every exported function in `bitrate.ts` must have tests before Phase 1 is complete.

**Example:**
```typescript
// tests/bitrate.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateVideoBitrate, TARGET_EFFECTIVE_BYTES, TARGET_CEILING_BYTES } from '../src/bitrate.ts';

describe('calculateVideoBitrate', () => {
  it('returns correct kbps for a 60-second video with 96 kbps audio', () => {
    // targetSizeBytes = 9.6 MiB = 10,066,329.6 bytes → Math.floor = 10,066,329
    // audioBitsTotal  = 96 * 1000 * 60 = 5,760,000 bits
    // availableBits   = 10,066,329 * 8 - 5,760,000 = 74,770,632 bits
    // videoBitrateKbps = floor(74,770,632 / 60 / 1000) = 1246 kbps
    const result = calculateVideoBitrate(TARGET_EFFECTIVE_BYTES, 60, 96);
    assert.strictEqual(result, 1246);
  });

  it('returns at least 1 kbps for extreme edge cases (very long video)', () => {
    // e.g., 24-hour video at 9.6 MiB target would produce negative bitrate without guard
    const result = calculateVideoBitrate(TARGET_EFFECTIVE_BYTES, 86400, 96);
    assert.ok(result >= 1, `Expected >= 1 kbps, got ${result}`);
  });

  it('handles zero-audio case (silent video)', () => {
    const result = calculateVideoBitrate(TARGET_EFFECTIVE_BYTES, 60, 0);
    // full budget goes to video; should be strictly higher than with audio
    const withAudio = calculateVideoBitrate(TARGET_EFFECTIVE_BYTES, 60, 96);
    assert.ok(result > withAudio);
  });

  it('returns an integer (Math.floor applied)', () => {
    const result = calculateVideoBitrate(TARGET_EFFECTIVE_BYTES, 7, 96);
    assert.strictEqual(result, Math.floor(result));
  });
});

describe('Constants', () => {
  it('TARGET_EFFECTIVE_BYTES is 9.6 binary MiB', () => {
    assert.strictEqual(TARGET_EFFECTIVE_BYTES, 9.6 * 1_048_576);
  });

  it('TARGET_CEILING_BYTES is 9.8 binary MiB', () => {
    assert.strictEqual(TARGET_CEILING_BYTES, 9.8 * 1_048_576);
  });

  it('effective target is strictly less than ceiling', () => {
    assert.ok(TARGET_EFFECTIVE_BYTES < TARGET_CEILING_BYTES);
  });
});
```

### Anti-Patterns to Avoid

- **Plain `new Error()` for tool failures:** Every thrown error must be a typed subclass so the CLI entry point can use `exitCode` to call `process.exit()`. Using plain errors means exit codes are always 1.
- **Decimal MB constants:** `9.8 * 1_000_000` is wrong — Discord's limit is binary. Use `9.8 * 1_048_576`. This must be enforced in comments, not just in code.
- **Implicit unit mixing in the formula:** Any intermediate value named `size` or `bitrate` without a unit suffix is a bug waiting to happen. The formula must use `targetSizeBytes`, `audioBitsTotal`, `availableBits`, `videoBitrateKbps` — never naked names.
- **tsconfig `"module": "CommonJS"` with ESM dependencies:** execa v9 and ora v9 will fail to import. The project requires `"module": "NodeNext"` and `"moduleResolution": "NodeNext"`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TypeScript compilation | Custom build scripts | `tsc` (via typescript package) | Handles declaration files, source maps, project references — all edge cases already solved |
| TypeScript-in-Node runner | Transpile-then-run shell scripts | `tsx` | Native ESM support, no intermediate build step needed for dev/test |
| FFmpeg binary bundling | Download/extract scripts | `ffmpeg-static` | Handles platform detection, architecture detection, network fetching, and binary permissions at install time |
| Unit test runner | Custom test harness | `node:test` + `node:assert` | Built into Node.js 18+; supports parallel subtests, tap output, coverage hooks |

**Key insight:** Phase 1 has almost no risk of premature hand-rolling because the scope is narrow — the only "custom" code is the bitrate formula itself, which is intentionally hand-rolled because it IS the project's core algorithm.

---

## Common Pitfalls

### Pitfall 1: Bits vs Bytes in the Formula (Off-by-8x Bug)

**What goes wrong:** The formula mixes bytes and bits without conversion. `targetSizeBytes * 8` is in bits, but if a developer writes `audioBitrateKbps * durationSeconds` without multiplying by 1000, the audio term is in kbits not bits, and the result is wrong by a factor of 1000.

**Why it happens:** The formula has three different units in play simultaneously: bytes (file size), bits (intermediate), and kbps (bitrate). The conversion chain is easy to lose track of.

**How to avoid:** Keep all intermediate values in bits until the final division. Name every variable with its unit suffix. Document the conversion chain as a comment block next to the formula:
```
targetSizeBytes * 8          → total bits available
audioBitrateKbps * 1000      → audio bits per second
* durationSeconds            → total audio bits
targetBits - audioBitsTotal  → available bits for video
/ durationSeconds            → video bits per second
/ 1000                       → video kbits per second (kbps)
Math.floor(...)              → integer kbps
```

**Warning signs:** Computed `videoBitrateKbps` is several thousand times higher or lower than expected for typical inputs (e.g., 60-second video should yield ~1200 kbps at 9.6 MiB target; if you see 1,200,000 or 1.2, a unit conversion is missing).

### Pitfall 2: MiB vs MB in Constants (Off-by-4.86% Error)

**What goes wrong:** Constants use decimal `1_000_000` instead of binary `1_048_576` as the MiB multiplier. The resulting file target is ~480KB too conservative (9.6 MB decimal = 9,600,000 bytes vs 9.6 MiB binary = 10,066,330 bytes), producing files that are artificially small.

**Why it happens:** "MB" is ambiguous; JavaScript numbers have no unit system.

**How to avoid:** Always compute `MiB = value * 1_048_576` (which equals `value * 1024 * 1024`). Add a comment next to every constant: `// binary MiB, NOT decimal MB (1 MiB = 1,048,576 bytes)`. Define `MIB_TO_BYTES = 1_048_576` as a named constant so the multiplication is readable.

**Warning signs:** `9.6 * 1_000_000 = 9,600,000` appears anywhere in the codebase instead of `9.6 * 1_048_576 = 10,066,330`.

### Pitfall 3: TypeScript ESM Import Extension Omission

**What goes wrong:** TypeScript files import each other without the `.js` extension (e.g., `import { calculateVideoBitrate } from './bitrate'`). With `"module": "NodeNext"`, Node.js requires the `.js` extension in the compiled output — and TypeScript's NodeNext mode requires the extension even in `.ts` source files.

**Why it happens:** TypeScript historically did not require extensions; the NodeNext module mode is stricter and newer.

**How to avoid:** Always use `.js` extensions in import paths in `.ts` files:
```typescript
import { calculateVideoBitrate } from './bitrate.js'; // correct for NodeNext
```
TypeScript resolves `.js` to `.ts` at compile time — this is the documented pattern.

**Warning signs:** `ERR_MODULE_NOT_FOUND` errors when running `node` on compiled output. TypeScript compiler emitting `Cannot find module './bitrate'` with `"moduleResolution": "NodeNext"`.

### Pitfall 4: ffmpeg-static Returns null on Some Platforms

**What goes wrong:** `import ffmpegPath from 'ffmpeg-static'` returns `null` on platforms where no pre-built binary is available (some Linux ARM configurations). Code that does `spawn(ffmpegPath!, ...)` crashes with a null dereference.

**Why it happens:** `ffmpeg-static` documents that it may return `null` when no binary is bundled for the current platform.

**How to avoid:** The `resolveFfmpegPath()` stub in Phase 1 should be designed (even as a stub) to return `string | null` and the Phase 2 implementation must handle null by falling back to system PATH. The stub should be typed as `(): string | null` so callers are forced to handle nullability.

**Warning signs:** TypeScript `!` non-null assertion on the `ffmpeg-static` import value anywhere in the codebase.

---

## Code Examples

### package.json (ESM + TypeScript scaffold)
```json
{
  "name": "ffmpeg10mb",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "tsc",
    "test": "node --import tsx/esm --test tests/**/*.test.ts",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "ffmpeg-static": "^5.3.0"
  },
  "devDependencies": {
    "@types/node": "^25.5.0",
    "tsx": "^4.21.0",
    "typescript": "^6.0.2"
  }
}
```

### tsconfig.json (NodeNext, ES2022 target)
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

Note: Tests live in `tests/` not `src/`, so they are excluded from the production build.

### resolveFfmpegPath stub (Phase 1 version)
```typescript
// src/probe.ts — partial stub showing resolveFfmpegPath signature
// Full implementation in Phase 2.
import ffmpegStaticPath from 'ffmpeg-static';

/**
 * Resolves the FFmpeg binary path in priority order:
 *   1. --ffmpeg-path CLI flag value (not yet wired in Phase 1)
 *   2. ffmpeg-static bundled binary
 *   3. System PATH (fallback)
 * Returns null if no binary is found anywhere.
 */
export function resolveFfmpegPath(cliFlag?: string): string | null {
  if (cliFlag) return cliFlag;
  if (ffmpegStaticPath) return ffmpegStaticPath;
  // Phase 2 will add: check system PATH via 'which'/'where'
  return null;
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `"module": "CommonJS"` with `.mjs` workarounds | `"module": "NodeNext"` + `.js` extensions in imports | TypeScript 4.7 (2022) | Clean ESM without dual-module hacks |
| `ts-node` for running TypeScript directly | `tsx` | 2023 | tsx is faster, ESM-native, no tsconfig tweaks required |
| TypeScript 4.x / 5.x | TypeScript 6.0.2 | 2025 | Current stable; fully compatible with NodeNext |
| `jest` for Node.js unit tests | `node:test` (built-in) | Node.js 18+ (2022) | Zero dependencies for pure unit tests |
| `fluent-ffmpeg` for FFmpeg control | `execa` + raw subprocess | Archived May 2025 | fluent-ffmpeg is unmaintained; do not use |

**Deprecated/outdated:**
- `ts-node`: Still functional but slower and more complex to configure for ESM; `tsx` is the current community preference.
- `fluent-ffmpeg`: Archived May 2025, not maintained. Do not use anywhere in this project.
- `child_process.exec()` for FFmpeg: Buffers all output; unsuitable for long video processing. Use `spawn()` or `execa`.

---

## Open Questions

1. **Exact byte value of TARGET_EFFECTIVE_BYTES**
   - What we know: `9.6 * 1_048_576 = 10,066,329.6` — JavaScript will evaluate this as a float
   - What's unclear: Should the constant use `Math.floor()` to get exactly `10,066,329`, or is the float `10,066,329.6` acceptable as the byte target?
   - Recommendation: Use `Math.floor(9.6 * 1_048_576)` to ensure an integer byte count. Alternatively, define as `10_066_329` explicitly with a comment. Either is defensible; pick one and stay consistent.

2. **Test file location: `src/bitrate.test.ts` vs `tests/bitrate.test.ts`**
   - What we know: CONTEXT.md says "Test file: `src/bitrate.test.ts` (or `test/bitrate.test.ts`)" — either is acceptable
   - What's unclear: If tests are inside `src/`, the `tsconfig.json` must either include them (polluting the build) or use a separate `tsconfig.test.json`
   - Recommendation: Place tests in `tests/` (at project root) and exclude from `tsconfig.json` build. This is the cleaner separation and avoids shipping test files in `dist/`.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | node:test (built-in, Node.js 20+) + node:assert/strict |
| Config file | None — flags passed directly to `node` |
| Quick run command | `node --import tsx/esm --test tests/bitrate.test.ts` |
| Full suite command | `node --import tsx/esm --test "tests/**/*.test.ts"` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOUND-01 | package.json has `"type": "module"` and tsconfig has `"module": "NodeNext"` | smoke (manual inspect) | `node -e "import('./dist/bitrate.js').then(m => console.log('ESM OK'))"` | ❌ Wave 0 |
| FOUND-02 | `ffmpeg-static` resolves to a non-null string after `npm install` | smoke | `node -e "import('ffmpeg-static').then(m => { if (!m.default) throw new Error('null path'); console.log(m.default); })"` | ❌ Wave 0 |
| FOUND-03 | `calculateVideoBitrate` returns correct integer kbps, uses unit-suffixed vars | unit | `node --import tsx/esm --test tests/bitrate.test.ts` | ❌ Wave 0 |
| FOUND-04 | Constants are binary MiB values with comments | unit | `node --import tsx/esm --test tests/bitrate.test.ts` (constants describe block) | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `node --import tsx/esm --test tests/bitrate.test.ts`
- **Per wave merge:** `node --import tsx/esm --test "tests/**/*.test.ts"`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/bitrate.test.ts` — covers FOUND-03 and FOUND-04
- [ ] `src/bitrate.ts` — the module under test
- [ ] `src/errors.ts` — error hierarchy (no tests needed in Phase 1; just existence)
- [ ] `package.json` — must exist with correct `"type": "module"` before any test can run
- [ ] `tsconfig.json` — must exist with NodeNext module before TypeScript can compile
- [ ] Framework install: `npm install --save-dev typescript tsx @types/node` — no test framework installation needed (node:test is built-in)

---

## Sources

### Primary (HIGH confidence)
- npm registry: `npm view ffmpeg-static version` → 5.3.0 (verified 2026-03-25)
- npm registry: `npm view typescript version` → 6.0.2 (verified 2026-03-25)
- npm registry: `npm view tsx version` → 4.21.0 (verified 2026-03-25)
- npm registry: `npm view @types/node version` → 25.5.0 (verified 2026-03-25)
- `.planning/research/STACK.md` — stack decisions with version validation
- `.planning/research/ARCHITECTURE.md` — bitrate formula, component boundaries, build order
- `.planning/research/PITFALLS.md` — Pitfall #2 (audio subtraction), Pitfall #9 (MiB vs MB) — directly relevant to this phase

### Secondary (MEDIUM confidence)
- `.planning/phases/01-foundation/01-CONTEXT.md` — locked decisions from user discussion
- Node.js 20 documentation: `node:test` module available since Node.js 18.x

### Tertiary (LOW confidence)
- tsx ESM import flag: `--import tsx/esm` pattern — verified against tsx docs as of 4.x series; flag form may differ in future tsx versions

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against npm registry on 2026-03-25
- Architecture: HIGH — locked decisions from CONTEXT.md; no ambiguity
- Pitfalls: HIGH — bits/bytes and MiB/MB pitfalls documented from prior project research with concrete numeric examples
- Test architecture: HIGH — node:test is built-in to Node.js 20+; no external framework uncertainty

**Research date:** 2026-03-25
**Valid until:** 2026-06-25 (stable ecosystem — TypeScript and Node.js built-ins do not change rapidly; ffmpeg-static version should be re-verified if >90 days pass before implementation)
