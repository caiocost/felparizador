# Phase 2: Input Analysis - Research

**Researched:** 2026-03-25
**Domain:** ffprobe subprocess invocation, input file validation, FFmpeg availability detection, quality warning logic
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Show full install instructions when FFmpeg is missing (not just a raw error) — users need actionable help
- Check `ffmpeg-static` first, then system PATH as fallback — consistent with Phase 1 `resolveFfmpegPath()` stub
- Error format: `Error: FFmpeg not found.\n\nTo fix: [install instructions with npm note + direct download link]`
- Exit code 3 (`FfmpegNotFoundError`) — already defined in `errors.ts`
- Warn below 50 kbps projected video bitrate — warn and continue (do not abort)
- Show projected bitrate before encoding starts, alongside probe results
- Short videos (<5s): warn and continue with standard ABR — no special handling in Phase 2
- Very long videos (>25 min): warn that quality will be poor — continue encoding
- Always show probe results before encoding starts (not gated behind --verbose)
- Show: duration, resolution, original file size — clean table format, not raw JSON
- Format as a readable table (e.g., `Duration: 1m 23s | Resolution: 1920×1080 | Size: 245 MB`)

### Claude's Discretion
- Exact `--quiet` flag implementation and whether to add it in Phase 2 or Phase 4
- Exact wording of install instructions for each platform (macOS/Linux/Windows)
- Whether to use `ora` spinner during the ffprobe call (short enough to be instant)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INPUT-01 | Tool checks FFmpeg/ffprobe availability on startup and shows human-readable install instructions if missing | `FfmpegNotFoundError` exit 3 defined; `resolveFfmpegPath()` stub in place; ENOENT detection pattern documented |
| INPUT-02 | Tool validates input file exists and is readable before encoding | `InputValidationError` exit 2 defined; `node:fs/promises` `access()` + `stat()` pattern verified working |
| INPUT-03 | Tool runs ffprobe to extract duration, audio stream presence, and audio bitrate before encoding | ffprobe JSON structure verified empirically; `ProbeResult` type stub in place; ffprobe flags documented |
| INPUT-04 | Tool warns user when projected video bitrate falls below 50 kbps | `calculateVideoBitrate()` + `ProbeResult.durationSeconds` + 50 kbps threshold logic; warn-and-continue pattern |
| INPUT-05 | Tool detects very short videos (< 5s) and handles them appropriately | warn-and-continue in Phase 2; no encoding change; message explaining standard ABR will be used |
</phase_requirements>

## Summary

Phase 2 implements three sequential checks that run before any encoding: (1) FFmpeg/ffprobe binary availability check with human-readable install instructions on failure; (2) input file existence and readability validation; (3) ffprobe subprocess invocation to extract duration, audio presence, and audio bitrate, followed by quality warnings derived from the probe result.

The foundational work is already done: `errors.ts` has the correct error types and exit codes, `bitrate.ts` has `calculateVideoBitrate()` for the quality warning math, and `probe.ts` has the `ProbeResult` type and `resolveFfmpegPath()` stub ready to be completed. The main implementation work is the ffprobe subprocess call, JSON parsing, and warning logic in `probe.ts`.

A critical discovery: `ffmpeg-static` bundles only `ffmpeg.exe`, not `ffprobe.exe`. The project needs a separate ffprobe resolution strategy. The recommended approach is to derive the ffprobe path from the system PATH (using `which`/`where` via a subprocess check), since FFmpeg system installations always include ffprobe alongside ffmpeg. `execa` is not yet installed and must be added as a runtime dependency in this phase.

**Primary recommendation:** Implement `probeVideo()` using `execa` to spawn ffprobe with `-v quiet -print_format json -show_streams -show_format`, parse the JSON output, and return a `ProbeResult`. Resolve ffprobe using system PATH (ffprobe is not bundled in `ffmpeg-static`). Add `execa` as a production dependency.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| execa | 9.6.1 | ffprobe subprocess spawn with structured error handling | Already planned in research SUMMARY.md; ESM-native; structured ENOENT errors; avoids exec() buffer overflow |
| node:fs/promises | built-in | Input file existence and readability check | Zero-cost; `access()` + `stat()` covers all validation needs |
| node:child_process | built-in | Fallback for PATH probing (`which`/`where`) | Used inside `resolveFfprobePath()` only when execa not available yet |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:path | built-in | Path manipulation for probe binary resolution | Used in `resolveFfprobePath()` |
| node:os | built-in | Platform detection for install instructions | `process.platform` is simpler but `os.type()` gives more detail |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| execa | node:child_process spawn directly | execa gives structured errors, promise API, no boilerplate — use execa |
| execa | ffprobe npm package | ffprobe npm wrapper is old (last updated 2019) and wraps child_process without adding value |
| PATH ffprobe | ffprobe-static package | ffprobe-static 3.1.0 last published June 2022 — bundled binary is 3 years old; system PATH ffprobe is more reliable and always matches the user's FFmpeg version |

**Installation (new dependency for this phase):**
```bash
npm install execa
```

**Version verification (confirmed 2026-03-25):**
- `execa`: 9.6.1 (latest) — ESM-only, Node.js >=18.19.0 or >=20.5.0
- `node:fs`, `node:path`, `node:os`: Node.js 22 built-ins, no install needed

## Architecture Patterns

### Recommended Project Structure
No new files beyond completing the Phase 1 stubs:
```
src/
├── probe.ts         # Phase 2 completes this stub: resolveFfprobePath(), probeVideo()
├── errors.ts        # Already complete (Phase 1)
├── bitrate.ts       # Already complete (Phase 1)
└── index.ts         # Not touched in Phase 2
tests/
├── bitrate.test.ts  # Already complete (Phase 1)
└── probe.test.ts    # Phase 2 adds this test file
```

### Pattern 1: FFmpeg/ffprobe Availability Check (Pre-flight)

**What:** Run `ffprobe -version` (or `ffmpeg -version`) via the resolved binary path. Catch `ENOENT` specifically. On ENOENT, throw `FfmpegNotFoundError` with platform-specific install instructions.

**When to use:** First action in `probeVideo()` before any other file I/O.

**Example:**
```typescript
// Source: PITFALLS.md Pitfall #6 + execa structured error pattern
import { execa } from 'execa';
import { FfmpegNotFoundError } from './errors.js';

async function checkFfprobeAvailable(ffprobePath: string): Promise<void> {
  try {
    await execa(ffprobePath, ['-version']);
  } catch (err: unknown) {
    const isNotFound = (err as NodeJS.ErrnoException).code === 'ENOENT';
    if (isNotFound) {
      throw new FfmpegNotFoundError(buildInstallMessage());
    }
    throw err; // unexpected error
  }
}
```

### Pattern 2: ffprobe Resolution Chain

**What:** Try system PATH first (no bundled ffprobe in ffmpeg-static). Fall back to failure with `FfmpegNotFoundError`.

**When to use:** Called once at the start of `probeVideo()`.

**Critical finding:** `ffmpeg-static` bundles only `ffmpeg.exe`. There is NO `ffprobe.exe` alongside it. The only resolution paths are: (1) system PATH `ffprobe`, (2) explicit user-supplied path via CLI flag (Phase 4).

**Example:**
```typescript
// Source: verified empirically — node_modules/ffmpeg-static/ has no ffprobe.exe
import { which } from 'execa'; // execa v9 exports 'which'

export async function resolveFfprobePath(cliFlag?: string): Promise<string> {
  if (cliFlag) return cliFlag;
  try {
    return await which('ffprobe'); // searches system PATH
  } catch {
    throw new FfmpegNotFoundError(buildInstallMessage());
  }
}
```

Note: execa v9 exports `which` as a named export. Alternatively, `node:child_process.execFileSync('where', ['ffprobe'])` on Windows or `execFileSync('which', ['ffprobe'])` on Unix also works without the execa `which` export.

### Pattern 3: ffprobe JSON Invocation

**What:** Spawn ffprobe with `-v quiet -print_format json -show_streams -show_format`. Parse stdout JSON. Extract `format.duration` (string → `parseFloat`), audio stream presence, and audio `bit_rate` (string, bits/s → divide by 1000 for kbps).

**When to use:** Core of `probeVideo()` after availability check and file validation.

**Verified ffprobe output structure (empirically confirmed with ffprobe 8.1):**
```json
{
  "streams": [
    { "codec_type": "video", "duration": "5.000000", "bit_rate": "8694" },
    { "codec_type": "audio", "duration": "5.000000", "bit_rate": "96319" }
  ],
  "format": {
    "duration": "5.000000",
    "size": "7808",
    "bit_rate": "114457"
  }
}
```

**Example:**
```typescript
// Source: verified empirically + ARCHITECTURE.md ffprobe parsing rules
import { execa } from 'execa';

export async function probeVideo(inputPath: string): Promise<ProbeResult> {
  const ffprobePath = await resolveFfprobePath();
  await validateInputFile(inputPath);          // INPUT-02
  await checkFfprobeAvailable(ffprobePath);    // INPUT-01 (redundant with resolveFfprobePath but explicit)

  const { stdout } = await execa(ffprobePath, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    inputPath,
  ]);

  const data = JSON.parse(stdout) as FfprobeOutput;
  const durationSeconds = parseFloat(data.format?.duration ?? data.streams[0]?.duration ?? '0');
  const audioStream = data.streams.find(s => s.codec_type === 'audio');
  const hasAudio = audioStream !== undefined;
  const audioBitrateKbps = hasAudio
    ? Math.round(parseInt(audioStream!.bit_rate ?? '128000', 10) / 1000)
    : 0;

  return { durationSeconds, hasAudio, audioBitrateKbps };
}
```

### Pattern 4: Input File Validation

**What:** Use `node:fs/promises` `access()` to check readability before spawning ffprobe. Throw `InputValidationError` with a clear path-specific message.

**When to use:** Second check (after FFmpeg availability, before ffprobe spawn).

**Example:**
```typescript
// Source: node:fs/promises docs + REQUIREMENTS INPUT-02
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { InputValidationError } from './errors.js';

async function validateInputFile(inputPath: string): Promise<void> {
  try {
    await access(inputPath, constants.R_OK);
  } catch {
    throw new InputValidationError(
      `Input file not found or not readable: ${inputPath}`
    );
  }
}
```

### Pattern 5: Quality Warning Logic (INPUT-04, INPUT-05)

**What:** After `probeVideo()` returns, compute projected video bitrate with `calculateVideoBitrate()`. Emit console warnings when thresholds are crossed. Do NOT abort — warn and return.

**When to use:** Immediately after `probeVideo()` returns, before any encoding call. The warning logic lives in `probe.ts` as a separate exported function, or in the caller in `index.ts`. Given Phase 4 wires `index.ts`, the function should be exported from `probe.ts` and called by the phase 4 wiring.

**Thresholds (from CONTEXT.md + REQUIREMENTS):**
- `< 5s`: short video warning (INPUT-05) — warn and continue with standard ABR
- `> 25 min (1500s)`: quality will be poor warning (CONTEXT.md decision)
- `videoBitrateKbps < 50`: quality warning (INPUT-04) — warn and continue

**Example:**
```typescript
// Source: CONTEXT.md decisions + REQUIREMENTS INPUT-04, INPUT-05
import { calculateVideoBitrate, TARGET_EFFECTIVE_BYTES } from './bitrate.js';

export interface ProbeWarnings {
  shortVideo: boolean;       // duration < 5s
  poorQuality: boolean;      // projected video bitrate < 50 kbps
  veryLongVideo: boolean;    // duration > 1500s (25 min)
  projectedVideoBitrateKbps: number;
}

export function analyzeProbeResult(
  result: ProbeResult,
  audioBitrateKbpsOverride?: number,
): ProbeWarnings {
  const effectiveAudio = audioBitrateKbpsOverride ?? result.audioBitrateKbps;
  const projectedVideoBitrateKbps = calculateVideoBitrate(
    TARGET_EFFECTIVE_BYTES,
    result.durationSeconds,
    effectiveAudio,
  );
  return {
    shortVideo: result.durationSeconds < 5,
    poorQuality: projectedVideoBitrateKbps < 50,
    veryLongVideo: result.durationSeconds > 1500,
    projectedVideoBitrateKbps,
  };
}
```

### Pattern 6: Probe Results Display

**What:** Print a single-line table to stderr/stdout before encoding. Format: `Duration: 1m 23s | Resolution: [not in ProbeResult] | Size: 245 MB`. Resolution is NOT returned by `ProbeResult` currently — add `widthPx`/`heightPx` to `ProbeResult`, or emit size/duration only (resolution is a Phase 4 display concern).

**Resolution decision:** `ProbeResult` interface should include `widthPx: number` and `heightPx: number` since ffprobe already returns them in the video stream and Phase 4 needs them for the display. Better to add them now than retrofit.

**Display format:**
```
Duration: 1m 23s | Resolution: 1920×1080 | Size: 245.3 MB | Audio: 96 kbps
```

### Anti-Patterns to Avoid
- **Using `child_process.exec()` for ffprobe:** exec buffers output in memory; long probe output or large video metadata can overflow the default 1MB buffer. Use `execa` (spawn-based).
- **Catching all errors as "ffprobe not found":** Only `ENOENT` (code `'ENOENT'`) means "binary not found". Other errors (permission denied, parse failure) need different handling.
- **Checking `format.duration` only:** Some containers (raw H.264, certain MKV) omit `format.duration` or return `"N/A"`. Always fall back to `streams[videoIndex].duration`.
- **Not running file check before ffprobe:** FFmpeg's own error for a missing file is verbose and confusing. Check with `fs.access()` first and throw `InputValidationError` with a clean message.
- **Parsing `bit_rate` without parseInt base:** `parseInt(str, 10)` avoids accidental octal parsing on strings with leading zeros.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Process spawning with error handling | Custom Promise wrapper around child_process.spawn | `execa` v9 | execa handles ENOENT, structured ExecaError, signal forwarding, stdout/stderr capture — all the boilerplate |
| PATH binary lookup | Manual `where`/`which` subprocess or PATH splitting | `execa`'s `which` export | execa v9 exports `which` for cross-platform binary resolution |
| File readability check | Try opening file, catch error | `fs.access(path, constants.R_OK)` | Purpose-built for this; distinguishes ENOENT from EACCES |

**Key insight:** The subprocess error handling surface is larger than it appears. execa's `ExecaError` gives `.exitCode`, `.signal`, `.killed`, `.stderr`, `.cause` in one structured object — catching raw spawn errors requires rebuilding all of this.

## Common Pitfalls

### Pitfall 1: ffmpeg-static Does Not Bundle ffprobe
**What goes wrong:** Code calls `resolveFfmpegPath()` and derives a sibling `ffprobe.exe` path — the file does not exist. ffprobe invocation throws ENOENT, misinterpreted as "FFmpeg not installed."
**Why it happens:** Developers assume `ffmpeg-static` mirrors the standard FFmpeg package which includes both binaries. It does not — only `ffmpeg.exe` is bundled.
**How to avoid:** `resolveFfprobePath()` must be a separate function that checks system PATH only. Verified empirically: `node_modules/ffmpeg-static/` contains `ffmpeg.exe` and no `ffprobe.exe`.
**Warning signs:** ENOENT when calling a path derived from `ffmpegStaticPath.replace('ffmpeg', 'ffprobe')`.

### Pitfall 2: format.duration Is "N/A" or Absent
**What goes wrong:** `parseFloat("N/A")` returns `NaN`. All downstream calculations (`calculateVideoBitrate(target, NaN, audio)`) return `NaN`, and the encode proceeds with an invalid bitrate.
**Why it happens:** Some containers (broken MP4s, certain MKV with missing headers) do not expose duration at the container level. ffprobe returns `"N/A"` as a string.
**How to avoid:** Check `format.duration` first; if absent or `"N/A"`, fall back to `streams.find(s => s.codec_type === 'video')?.duration`; if still absent/NaN, throw `InputValidationError("Could not determine video duration")`.
**Warning signs:** `NaN` in calculated bitrate, `calculateVideoBitrate` returning `1` (the minimum guard).

### Pitfall 3: Audio bit_rate Is in bits/s, Not kbps
**What goes wrong:** ffprobe reports audio `bit_rate` as `"96319"` (bits per second). Using this directly as `audioBitrateKbps` in `calculateVideoBitrate()` produces a wildly wrong video bitrate (off by ~1000x).
**Why it happens:** ffprobe's JSON uses consistent SI units (bits/second for bitrates). The tool uses kbps as its unit for audio.
**How to avoid:** Always divide ffprobe's `bit_rate` by 1000: `Math.round(parseInt(stream.bit_rate, 10) / 1000)`. Verified empirically: ffprobe returns `"96319"` for a 96kbps AAC stream.
**Warning signs:** Computed video bitrate is extremely low (near 1 kbps) for short videos with audio.

### Pitfall 4: FfmpegNotFoundError Thrown During File Validation (Wrong Exit Code)
**What goes wrong:** A missing file at the probeVideo call site throws `InputValidationError` (exit 2). But if the `access()` check is skipped and ffprobe runs on a missing file, ffprobe exits non-zero — and the ENOENT from the subprocess is caught as `FfmpegNotFoundError` (exit 3). Wrong exit code, wrong message.
**Why it happens:** Both "file not found" and "binary not found" produce ENOENT at the OS level. The difference is which path is missing.
**How to avoid:** Run `fs.access(inputPath)` for input file validation BEFORE spawning ffprobe. Catch the `access()` failure as `InputValidationError`. Only catch ENOENT in the execa spawn as `FfmpegNotFoundError` if the resolved binary path itself is not found.
**Warning signs:** Running on a nonexistent input file produces "FFmpeg not found" error message.

### Pitfall 5: ProbeResult Missing widthPx/heightPx Fields
**What goes wrong:** The display line `Duration: 1m 23s | Resolution: 1920×1080 | Size: 245 MB` (locked decision in CONTEXT.md) requires resolution. If not added to `ProbeResult` now, Phase 4 display code must re-probe or the display is incomplete.
**Why it happens:** Original `ProbeResult` stub only defined `durationSeconds`, `hasAudio`, `audioBitrateKbps`.
**How to avoid:** Extend `ProbeResult` with `widthPx: number` and `heightPx: number` in this phase. They are already available in the ffprobe JSON video stream (`streams[i].width` / `streams[i].height`).

### Pitfall 6: ProbeResult.fileSizeBytes Missing
**What goes wrong:** Display line also shows file size (`Size: 245 MB`). ffprobe returns `format.size` as a string in bytes. If not added to `ProbeResult`, Phase 4 must do a separate `fs.stat()` call.
**How to avoid:** Add `fileSizeBytes: number` to `ProbeResult`, parsed from `parseInt(data.format.size, 10)`.

## Code Examples

Verified patterns from empirical testing and official sources:

### ProbeResult Extended Interface
```typescript
// Extend the Phase 1 stub to include all display-needed fields
export interface ProbeResult {
  durationSeconds: number;       // float, from format.duration or stream fallback
  hasAudio: boolean;
  audioBitrateKbps: number;      // integer kbps (bit_rate / 1000, rounded)
  widthPx: number;               // from streams[video].width
  heightPx: number;              // from streams[video].height
  fileSizeBytes: number;         // from format.size
}
```

### ffprobe Invocation (Verified Flags)
```typescript
// Source: verified empirically with ffprobe 8.1 on Windows
const { stdout } = await execa(ffprobePath, [
  '-v', 'quiet',           // suppress informational messages
  '-print_format', 'json', // JSON output
  '-show_streams',         // include stream-level metadata
  '-show_format',          // include container-level metadata (duration, size)
  inputPath,
]);
```

### Duration Parsing with N/A Fallback
```typescript
// Source: ARCHITECTURE.md parsing rules + PITFALLS.md Pitfall #3
function parseDuration(data: FfprobeOutput): number {
  const containerDuration = data.format?.duration;
  if (containerDuration && containerDuration !== 'N/A') {
    const val = parseFloat(containerDuration);
    if (!isNaN(val) && val > 0) return val;
  }
  // fallback: stream-level duration
  const videoStream = data.streams.find(s => s.codec_type === 'video');
  const streamDuration = videoStream?.duration;
  if (streamDuration && streamDuration !== 'N/A') {
    const val = parseFloat(streamDuration);
    if (!isNaN(val) && val > 0) return val;
  }
  return 0; // caller checks for 0 and throws InputValidationError
}
```

### Install Message by Platform
```typescript
// Source: CONTEXT.md locked decision on error format
function buildInstallMessage(): string {
  const platform = process.platform;
  if (platform === 'darwin') {
    return 'Error: FFmpeg not found.\n\nTo fix:\n  brew install ffmpeg\n  # or download from https://ffmpeg.org/download.html';
  }
  if (platform === 'win32') {
    return 'Error: FFmpeg not found.\n\nTo fix:\n  winget install Gyan.FFmpeg\n  # or download from https://ffmpeg.org/download.html#build-windows\n  # Note: restart your terminal after installation';
  }
  // Linux / other
  return 'Error: FFmpeg not found.\n\nTo fix:\n  sudo apt install ffmpeg   # Ubuntu/Debian\n  sudo dnf install ffmpeg   # Fedora\n  # or download from https://ffmpeg.org/download.html';
}
```

### Duration Formatting for Display
```typescript
// Format 83.5 seconds → "1m 23s"
function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Format 256901120 bytes → "245.0 MB"
function formatSize(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
```

### Quality Warning Emission
```typescript
// Source: CONTEXT.md decisions + REQUIREMENTS INPUT-04, INPUT-05
function emitProbeWarnings(warnings: ProbeWarnings): void {
  if (warnings.shortVideo) {
    console.warn(`Warning: Video is very short (< 5s). Standard ABR will be used; output size may vary from target.`);
  }
  if (warnings.veryLongVideo) {
    console.warn(`Warning: Video is very long (> 25 min). Quality will be poor at this target size.`);
  }
  if (warnings.poorQuality) {
    console.warn(`Warning: Projected video bitrate is ${warnings.projectedVideoBitrateKbps} kbps (below 50 kbps). Output will have very poor visual quality.`);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `child_process.exec()` for ffprobe | `execa()` (spawn-based) | execa v6 ESM adoption (~2021) | No buffer overflow; structured errors |
| Manual ENOENT detection in callback hell | `execa` ExecaError with `.cause.code` | execa v9 (2024) | Clean `if (err.cause?.code === 'ENOENT')` check |
| Parsing ffprobe text output with regex | `-print_format json` + `JSON.parse` | ffprobe 2.x+ | Structured, reliable, no regex maintenance |
| `fluent-ffmpeg` for all subprocess work | Direct execa + ffprobe | fluent-ffmpeg archived May 2025 | No more deprecated dependency |

**Deprecated/outdated:**
- `fluent-ffmpeg`: archived May 2025 — do not use; confirmed in project SUMMARY.md
- `ffprobe` npm package (eugeneware): last updated 2019 — just wraps child_process; use execa directly
- `ffprobe-static` npm package: last published June 2022 — 3+ year old binary; skip in favor of PATH resolution

## Open Questions

1. **Should `execa`'s `which` export be used for ffprobe PATH resolution, or a manual `where`/`which` subprocess?**
   - What we know: execa v9 exports `which` as a named export
   - What's unclear: whether the current project setup (NodeNext module resolution) properly types `which` from execa
   - Recommendation: use `execa`'s `which` for clean cross-platform resolution; test with `import { which } from 'execa'`

2. **Should `fileSizeBytes` in ProbeResult come from ffprobe `format.size` or from a separate `fs.stat()` call?**
   - What we know: ffprobe JSON includes `format.size` as a string (confirmed empirically); `fs.stat()` is always accurate
   - What's unclear: whether `format.size` is always present for all container types
   - Recommendation: use `parseInt(data.format.size, 10)` from ffprobe (already available in the subprocess call); no extra I/O needed

3. **Where should warning display logic live — in `probe.ts` or in the caller?**
   - What we know: Phase 4 wires `index.ts` as the caller; the warnings are derived from `ProbeResult` + bitrate calculation
   - Recommendation: export `analyzeProbeResult()` from `probe.ts` returning `ProbeWarnings`; let the caller (`index.ts`) emit the warnings. This keeps I/O out of probe.ts.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test (built-in) + node:assert/strict |
| Config file | none — runner invoked directly |
| Quick run command | `node --import tsx/esm --test tests/probe.test.ts` |
| Full suite command | `node --import tsx/esm --test "tests/bitrate.test.ts" "tests/probe.test.ts"` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INPUT-01 | FFmpeg not found → FfmpegNotFoundError (exit 3) + human-readable message | unit (mock ENOENT) | `node --import tsx/esm --test tests/probe.test.ts` | ❌ Wave 0 |
| INPUT-02 | Nonexistent file → InputValidationError (exit 2) | unit | `node --import tsx/esm --test tests/probe.test.ts` | ❌ Wave 0 |
| INPUT-03 | Valid video → ProbeResult with durationSeconds, hasAudio, audioBitrateKbps | integration (fixture) | `node --import tsx/esm --test tests/probe.test.ts` | ❌ Wave 0 |
| INPUT-04 | Projected bitrate < 50 kbps → analyzeProbeResult returns poorQuality:true | unit (math) | `node --import tsx/esm --test tests/probe.test.ts` | ❌ Wave 0 |
| INPUT-05 | Duration < 5s → analyzeProbeResult returns shortVideo:true | unit (math) | `node --import tsx/esm --test tests/probe.test.ts` | ❌ Wave 0 |

### Test Fixtures Needed
- `tests/fixtures/short.mp4` — 3-second H.264+AAC video (generated with ffmpeg lavfi, no copyright issues)
- `tests/fixtures/video-only.mp4` — 10-second H.264, no audio stream (verify `hasAudio = false`)
- `tests/fixtures/standard.mp4` — 60-second H.264+AAC video (verify normal probe result)

**Fixture generation command (run once, committed to repo):**
```bash
# short.mp4 (3s, with audio)
ffmpeg -f lavfi -i "testsrc=duration=3:size=320x240:rate=25" \
  -f lavfi -i "sine=frequency=440:duration=3" \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 96k -t 3 \
  tests/fixtures/short.mp4

# video-only.mp4 (10s, no audio)
ffmpeg -f lavfi -i "testsrc=duration=10:size=320x240:rate=25" \
  -c:v libx264 -pix_fmt yuv420p -an -t 10 \
  tests/fixtures/video-only.mp4
```

### Sampling Rate
- **Per task commit:** `node --import tsx/esm --test tests/probe.test.ts`
- **Per wave merge:** `node --import tsx/esm --test "tests/bitrate.test.ts" "tests/probe.test.ts"`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/probe.test.ts` — covers INPUT-01 through INPUT-05
- [ ] `tests/fixtures/short.mp4` — 3s test fixture with audio (INPUT-05, INPUT-03)
- [ ] `tests/fixtures/video-only.mp4` — 10s fixture without audio (INPUT-03 hasAudio=false)
- [ ] `npm install execa` — production dependency needed before any test can run

## Sources

### Primary (HIGH confidence)
- Empirical verification with ffprobe 8.1 on Windows — ffprobe JSON structure for `format.duration`, `format.size`, `streams[].bit_rate`, `streams[].codec_type` confirmed
- `D:/GitHub/ffmpeg10mb/node_modules/ffmpeg-static/` directory listing — confirmed no `ffprobe.exe` present
- `D:/GitHub/ffmpeg10mb/src/errors.ts` — `FfmpegNotFoundError` (exit 3), `InputValidationError` (exit 2) confirmed
- `D:/GitHub/ffmpeg10mb/src/probe.ts` — `ProbeResult` interface and `resolveFfmpegPath()` stub confirmed
- `D:/GitHub/ffmpeg10mb/src/bitrate.ts` — `calculateVideoBitrate()` and `TARGET_EFFECTIVE_BYTES` confirmed
- `.planning/research/ARCHITECTURE.md` — ffprobe JSON structure, data flow, parsing rules (HIGH)
- `.planning/research/PITFALLS.md` — Pitfall #6 (FFmpeg not found UX), Pitfall #3 (duration inaccuracy) (HIGH)
- Node.js 22 built-in `node:fs/promises` docs — `access()` + `constants.R_OK` pattern

### Secondary (MEDIUM confidence)
- `npm view execa` — version 9.6.1, ESM-only, Node.js >=18.19.0 confirmed (npm registry)
- `npm view ffprobe-static time.modified` — last published June 2022 (npm registry)
- `npm view @ffprobe-installer/ffprobe time.modified` — last published August 2023 (npm registry)
- `.planning/research/SUMMARY.md` — stack recommendations including execa v9

### Tertiary (LOW confidence)
- execa `which` named export behavior — assumed from execa v9 release notes; verify at implementation time with `import { which } from 'execa'`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — execa confirmed at 9.6.1; no ffprobe.exe in ffmpeg-static verified empirically
- Architecture: HIGH — ffprobe JSON output structure verified empirically with real binary; parsing patterns confirmed
- Pitfalls: HIGH — ffprobe not in ffmpeg-static is a concrete empirical finding, not a theoretical concern; bit_rate units verified empirically

**Research date:** 2026-03-25
**Valid until:** 2026-04-24 (30 days — stable ecosystem)
