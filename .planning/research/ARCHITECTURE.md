# Architecture Research

**Domain:** FFmpeg-based CLI video compression tool (exact file size targeting)
**Researched:** 2026-03-25
**Confidence:** HIGH

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        CLI Entry Point                        │
│   Parses args (input path, optional output path, target MB)  │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                      Probe Layer                              │
│   ffprobe → duration (seconds), audio stream presence,       │
│             audio codec, existing audio bitrate              │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                   Bitrate Calculator                          │
│   Inputs:  target_size_bytes, duration_s, audio_bitrate_kbps │
│   Output:  video_bitrate_kbps                                │
│   Formula: see "Two-Pass Bitrate Formula" section below      │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                   Encoder Layer                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Pass 1: Analysis — ffmpeg -pass 1 -f null /dev/null │    │
│  │  Produces: ffmpeg2pass-0.log + ffmpeg2pass-0.log.mbtree    │
│  └──────────────────────────┬───────────────────────────┘    │
│                             │ log files on disk               │
│  ┌──────────────────────────▼───────────────────────────┐    │
│  │  Pass 2: Encode — ffmpeg -pass 2 output.mp4          │    │
│  └──────────────────────────────────────────────────────┘    │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                  Post-Processing Layer                        │
│   Verify output file size ≤ target                           │
│   Clean up temp log files (ffmpeg2pass-*)                    │
│   Report final size to user                                  │
└──────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Communicates With |
|-----------|----------------|-------------------|
| CLI parser | Parse argv, validate input path, derive output path, validate target size | Probe layer |
| Probe (ffprobe) | Extract duration, detect audio stream, get format metadata | Bitrate calculator |
| Bitrate calculator | Pure function: compute video_bitrate_kbps from size + duration + audio | Encoder layer |
| Pass 1 executor | Run FFmpeg first pass; no output file, writes stat logs | Pass 2 executor |
| Pass 2 executor | Run FFmpeg second pass; produces final MP4 | Post-processor |
| Post-processor | Verify file size, clean temp files, print result | User (stdout) |
| Error handler | Catch ffprobe/ffmpeg non-zero exits, clean partial output, surface message | CLI |

## Recommended Project Structure

```
ffmpeg10mb/
├── src/
│   ├── index.ts          # CLI entry: parseArgs, orchestrates pipeline
│   ├── probe.ts          # ffprobe wrapper → ProbeResult type
│   ├── bitrate.ts        # Pure bitrate formula (no I/O)
│   ├── encode.ts         # Pass 1 + Pass 2 ffmpeg invocations
│   ├── verify.ts         # File size check, cleanup, user report
│   └── errors.ts         # Typed error classes, exit codes
├── tests/
│   ├── bitrate.test.ts   # Unit tests (pure function, no ffmpeg needed)
│   ├── probe.test.ts     # Integration test with sample fixtures
│   └── encode.test.ts    # Integration test (requires ffmpeg installed)
├── package.json
└── tsconfig.json
```

### Structure Rationale

- **probe.ts isolated:** ffprobe invocation is the only dependency before bitrate math — isolating it makes the calculator unit-testable without any subprocess.
- **bitrate.ts pure:** Zero I/O, zero side effects. Easiest component to test and reason about. The formula is the project's core invariant.
- **encode.ts owns both passes:** Pass 1 and Pass 2 are tightly coupled (same codec flags, same log file prefix) — splitting them would create fragile state between modules.
- **verify.ts last:** Size assertion and cleanup only happen after encoding succeeds; keeping it separate avoids mixing success/error paths in the encoder.

## Two-Pass Bitrate Formula

This is the core algorithm. All other components exist to feed or consume it.

```
target_size_bits  = target_size_bytes × 8
audio_total_bits  = audio_bitrate_kbps × 1000 × duration_seconds
available_bits    = target_size_bits - audio_total_bits
video_bitrate_kbps = floor(available_bits / duration_seconds / 1000)
```

**Concrete example — 9.8 MB target, 60-second video, 128 kbps audio:**

```
target_size_bits   = 9,800,000 × 8              = 78,400,000 bits
audio_total_bits   = 128,000 × 60               = 7,680,000 bits
available_bits     = 78,400,000 - 7,680,000     = 70,720,000 bits
video_bitrate_kbps = floor(70,720,000 / 60 / 1000) = 1178 kbps
```

**Unit: The formula works in bits throughout. Mixed KB/kbps math is the #1 source of off-by-8x bugs.**

### Audio Bitrate Strategy

- Default audio bitrate: **128 kbps** (AAC, acceptable quality, predictable size)
- For very long videos where 128 kbps eats too much budget: drop to **96 kbps** (still acceptable for speech/ambient)
- For very short videos where the target bitrate would be extreme: 128 kbps is fine — the cap matters more
- No audio stream detected: set `audio_bitrate_kbps = 0`, add `-an` to both passes

### FFmpeg Command Sequence

**Pass 1:**

```bash
ffmpeg -y \
  -i input.mp4 \
  -c:v libx264 \
  -b:v {video_bitrate_kbps}k \
  -pass 1 \
  -passlogfile {tempLogPrefix} \
  -an \
  -f null \
  /dev/null          # Windows: NUL
```

**Pass 2:**

```bash
ffmpeg -y \
  -i input.mp4 \
  -c:v libx264 \
  -b:v {video_bitrate_kbps}k \
  -pass 2 \
  -passlogfile {tempLogPrefix} \
  -c:a aac \
  -b:a {audio_bitrate_kbps}k \
  output.mp4
```

**Key flags:**
- `-passlogfile` — controls where `ffmpeg2pass-0.log` and `ffmpeg2pass-0.log.mbtree` are written; use a temp-dir-scoped prefix to avoid collision and simplify cleanup
- `-y` — overwrite output without prompting (required for non-interactive CLI)
- `-an` in Pass 1 — audio analysis is irrelevant in the first pass; skip it
- `NUL` vs `/dev/null` — platform-specific null device; must branch at runtime

**Temp files to clean up after Pass 2 completes:**

```
{tempLogPrefix}.log
{tempLogPrefix}.log.mbtree
```

## Data Flow

### Full Pipeline

```
User Input (argv)
    │ [input_path, output_path?, target_mb?]
    ▼
Validate input file exists
    │ error → exit 1
    ▼
ffprobe -of json -show_streams -show_format {input}
    │ JSON → { format.duration, streams[].codec_type, streams[].bit_rate }
    ▼
Parse ProbeResult
    │ { duration_s: float, has_audio: bool, audio_bitrate_kbps: int }
    ▼
calculateBitrate(target_bytes, duration_s, audio_bitrate_kbps)
    │ { video_bitrate_kbps: int }
    ▼
runPass1(input, video_bitrate_kbps, tempLogPrefix)
    │ writes: {tempLogPrefix}.log, {tempLogPrefix}.log.mbtree
    ▼
runPass2(input, output, video_bitrate_kbps, audio_bitrate_kbps, tempLogPrefix)
    │ writes: output.mp4
    ▼
verifyOutputSize(output, target_bytes)
    │ error → warn user (encoding still completed)
    ▼
cleanupTempFiles(tempLogPrefix)
    ▼
printResult(output, actual_size_bytes)
    │ stdout: "Done: output.mp4 (9.6 MB)"
    ▼
exit 0
```

### ffprobe Output Parsing

The ffprobe JSON structure relevant to this tool:

```json
{
  "streams": [
    { "codec_type": "video", "codec_name": "h264" },
    { "codec_type": "audio", "codec_name": "aac", "bit_rate": "128000" }
  ],
  "format": {
    "duration": "186.727000",
    "size": "12345678"
  }
}
```

**Parsing rules:**
- Duration source: prefer `format.duration` (container-level); fall back to `streams[0].duration` if format duration is absent (some raw streams omit it)
- Duration is a **string** in ffprobe JSON — parse to `parseFloat`
- Audio bitrate: `streams.find(s => s.codec_type === 'audio')?.bit_rate` — convert from bits/s string to kbps integer; default to 128 if absent
- Audio presence: `streams.some(s => s.codec_type === 'audio')`

## Architectural Patterns

### Pattern 1: Sequential Async Pipeline (Async/Await Chain)

**What:** Each stage is an async function that returns a typed result. The entry point awaits each stage in sequence. No shared mutable state between stages — data is passed explicitly.

**When to use:** Always for this tool. The pipeline is inherently sequential (probe before calculate, pass 1 before pass 2). Async/await makes error propagation straightforward.

**Trade-offs:** Simple, linear, easy to reason about. Does not parallelize work (not needed here — all stages depend on the previous).

**Example:**

```typescript
async function compress(input: string, output: string, targetBytes: number): Promise<void> {
  const probe = await probeVideo(input);
  const { videoBitrateKbps } = calculateBitrate(targetBytes, probe.durationSeconds, probe.audioBitrateKbps);
  const tempPrefix = path.join(os.tmpdir(), `ffmpeg10mb-${Date.now()}`);
  try {
    await runPass1(input, videoBitrateKbps, tempPrefix);
    await runPass2(input, output, videoBitrateKbps, probe.audioBitrateKbps, tempPrefix);
  } finally {
    await cleanupLogs(tempPrefix); // always runs, even on error
  }
  await verifySize(output, targetBytes);
}
```

### Pattern 2: Subprocess Wrapper with Promise + stderr Capture

**What:** Wrap `child_process.spawn` in a Promise that resolves on exit code 0 and rejects on non-zero, capturing stderr for error messages.

**When to use:** Both ffprobe and ffmpeg invocations. FFmpeg writes progress to stderr even on success — capture it but don't treat it as an error unless exit code is non-zero.

**Trade-offs:** More verbose than `exec` but avoids buffer overflow on large video files and allows streaming stderr for progress reporting.

**Example:**

```typescript
function spawnAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    const stderr: string[] = [];
    proc.stderr.on('data', (chunk) => stderr.push(chunk.toString()));
    proc.on('close', (code) => {
      if (code === 0) resolve(stderr.join(''));
      else reject(new Error(`${cmd} exited ${code}:\n${stderr.join('')}`));
    });
    proc.on('error', reject); // handles "command not found"
  });
}
```

### Pattern 3: Pure Bitrate Calculator (No I/O)

**What:** The bitrate formula is a pure function with no dependencies on the filesystem or subprocess system.

**When to use:** Always — keep the math isolated.

**Trade-offs:** Maximally testable. Changing the target size or audio defaults only requires changing the caller, not the calculator.

## Edge Cases and Handling

### Very Short Videos (< 5 seconds)

**Problem:** The computed `video_bitrate_kbps` will be extremely high (tens of thousands of kbps). FFmpeg will happily encode at this bitrate, but the output may actually exceed the target because the codec has a practical upper limit on how much data it generates for a short clip.

**Handling:**
- Cap `video_bitrate_kbps` at a sensible maximum (e.g., 50,000 kbps)
- Set `-maxrate` equal to `video_bitrate_kbps` and `-bufsize` to 2× that value to prevent burst overruns
- Warn the user: "Video is very short; output size may undershoot the target"
- Verify actual output size after encoding

### Very Long Videos (> 60 minutes)

**Problem:** The computed `video_bitrate_kbps` will be very low (< 200 kbps). At this level, H.264 produces visible blocking artifacts. Audio at 128 kbps may consume a significant fraction of the budget.

**Handling:**
- If `video_bitrate_kbps < 100`, warn user that quality will be severely degraded
- Consider reducing audio to 64 kbps for very long videos to recover video budget
- Do not refuse to encode — let the user decide

**Example thresholds:**

| Duration | ~video kbps at 9.8MB | Quality |
|----------|-----------------------|---------|
| 30 s | ~2,485 kbps | Excellent |
| 5 min | ~214 kbps | Acceptable |
| 30 min | ~34 kbps | Unusable |
| 60 min | ~17 kbps | Unusable |

### Silent Video (No Audio Stream)

**Problem:** If `has_audio = false`, the encode command must not include `-c:a aac -b:a ...` or it will fail. The full target budget is available for video.

**Handling:**
- In bitrate calculation: `audio_bitrate_kbps = 0`
- In Pass 1: `-an` (already standard)
- In Pass 2: `-an` (no audio mapping; omit `-c:a` and `-b:a` entirely)

### ffprobe Cannot Read Duration

**Problem:** Some files (e.g., broken MP4, raw H.264 streams, certain MKV containers) do not expose duration in `format.duration`. The field may be `"N/A"` or absent entirely.

**Handling:**
- Try `streams[video_stream].duration` as fallback
- If both are absent/`"N/A"`: run `ffprobe -count_frames -show_entries stream=nb_read_frames` to count frames and estimate duration from frame rate — expensive but reliable
- If all methods fail: exit with a clear error message rather than encoding with duration=0

### Interrupted Encoding (Ctrl+C / Process Kill)

**Problem:** Partial output file is written, temp log files remain on disk.

**Handling:**
- Register `process.on('SIGINT', ...)` and `process.on('SIGTERM', ...)` handlers
- In signal handler: kill the active ffmpeg subprocess, then run cleanup (delete partial output + log files)

## Build Order (Component Dependencies)

Build in this order to maximize testability at each step:

```
1. errors.ts          — no dependencies; defines exit codes and error types
2. bitrate.ts         — no dependencies; pure math; write unit tests immediately
3. probe.ts           — depends on: errors.ts; integration-testable with a sample video
4. encode.ts          — depends on: errors.ts, bitrate.ts (for type); needs ffmpeg installed
5. verify.ts          — depends on: errors.ts; tests can use real output from encode
6. index.ts (CLI)     — depends on: all above; end-to-end integration test last
```

**Rationale:** The bitrate calculator is the most critical correctness invariant and has zero external dependencies — test it first and thoroughly. Probe comes before encode because encode's inputs are derived from probe's outputs. The CLI wires everything together and should be the last thing built.

## Anti-Patterns

### Anti-Pattern 1: Mixing Bits and Bytes Without Explicit Labels

**What people do:** Use variables named `bitrate` or `size` without unit suffix; mix KB, KiB, kbps, Kbps in the same calculation.

**Why it's wrong:** The off-by-8 error (bytes vs bits) causes the output to be either 8× too large or 8× too small. This is the most common bug in target-size implementations.

**Do this instead:** Name every variable with its unit: `targetSizeBytes`, `videoBitrateKbps`, `audioBitsTotal`. In the formula, keep all values in bits until the final division.

### Anti-Pattern 2: Not Cleaning Up Pass-1 Log Files

**What people do:** Skip cleanup of `ffmpeg2pass-0.log` and `ffmpeg2pass-0.log.mbtree` after a successful encode.

**Why it's wrong:** These files persist in the working directory (or temp dir), accumulate across runs, and can cause incorrect behavior if a second invocation of FFmpeg picks up a stale log file from a different video.

**Do this instead:** Use `-passlogfile` with a unique, timestamped prefix in the system temp directory. Clean up in a `finally` block so cleanup runs even if Pass 2 fails.

### Anti-Pattern 3: Using `exec` Instead of `spawn` for FFmpeg

**What people do:** `child_process.exec('ffmpeg ...')` — buffers all output in memory.

**Why it's wrong:** FFmpeg writes verbose progress to stderr for the duration of encoding. For long videos this can exhaust the default buffer size (200KB), causing the process to hang or crash.

**Do this instead:** Use `child_process.spawn` and consume stderr via event listeners. Stream it to `process.stderr` for pass-through or discard it after capturing any error message.

### Anti-Pattern 4: Hardcoding NUL or /dev/null

**What people do:** Hardcode `/dev/null` in the Pass 1 command.

**Why it's wrong:** The tool targets Windows, macOS, and Linux. `/dev/null` is not valid on Windows; `NUL` is not valid on Linux/macOS.

**Do this instead:**

```typescript
const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
```

## Integration Points

### External Dependencies

| Dependency | Integration | Notes |
|------------|-------------|-------|
| ffmpeg binary | `child_process.spawn('ffmpeg', args)` | Must be in PATH or bundled; check at startup |
| ffprobe binary | `child_process.spawn('ffprobe', args)` | Usually ships with ffmpeg; check separately |
| OS temp dir | `os.tmpdir()` | For passlogfile prefix; avoids CWD pollution |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| probe.ts → bitrate.ts | `ProbeResult` typed object | Duration as float seconds, audio kbps as integer |
| bitrate.ts → encode.ts | `BitrateResult` typed object | `videoBitrateKbps`, `audioBitrateKbps` |
| encode.ts → verify.ts | output file path on disk | Encode writes file; verify reads stat |
| index.ts → all | direct async function calls | No event bus needed; linear pipeline |

## Sources

- [Hitting a Target File Size With FFmpeg (Discord Clips)](https://zzzachzzz.github.io/blog/hitting-a-target-file-size-with-ffmpeg-perfect-for-discord-clips) — bitrate formula and two-pass algorithm (HIGH confidence)
- [Doing 2-Pass Encoding with FFmpeg — corbpie](https://write.corbpie.com/doing-2-pass-encoding-with-ffmpeg/) — exact command flags for pass 1 and pass 2 (HIGH confidence)
- [ffprobe Documentation — ffmpeg.org](https://ffmpeg.org/ffprobe.html) — JSON output format, `-show_streams`, `-show_format` flags (HIGH confidence)
- [FFmpeg VideoHelp Forum — two-pass target size](https://forum.videohelp.com/threads/383629-ffmpeg-how-to-encode-target-size-and-2passes) — real-world bitrate formula validation (MEDIUM confidence)
- [ffprobe npm / eugeneware/ffprobe](https://github.com/eugeneware/ffprobe) — Node.js ffprobe JSON structure: `format.duration`, `streams[].codec_type` (HIGH confidence)
- [Two-Pass encoding accuracy — Martin Riedl](https://www.martin-riedl.de/2022/01/09/two-pass-encoding-with-ffmpeg/) — accuracy: 5992 kbps achieved vs 6000 kbps target (HIGH confidence)
- [FFmpeg two-pass log file cleanup — immich issue #2600](https://github.com/immich-app/immich/issues/2600) — temp file accumulation pitfall (MEDIUM confidence)
- [Three Things to Know About 2-Pass x265 — Streaming Learning Center](https://streaminglearningcenter.com/encoding/three-things-to-know-about-2-pass-x265-encoding.html) — codec-level size accuracy behavior (MEDIUM confidence)

---
*Architecture research for: FFmpeg two-pass video compression CLI tool*
*Researched: 2026-03-25*
