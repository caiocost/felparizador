# Stack Research

**Domain:** CLI video compression tool (FFmpeg-based, exact file size targeting)
**Researched:** 2026-03-25
**Confidence:** HIGH

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22 LTS | Runtime | Long-term support until 2027, fastest startup for short-lived CLI scripts (V8 Maglev compiler on by default), `npm` distribution is the most friction-free install path for developers across all platforms |
| ffmpeg-static | 5.x (bundles FFmpeg 6.1.1) | Bundled FFmpeg binary | Eliminates the "user must install FFmpeg separately" problem; downloads the correct static binary for the host OS/arch at `npm install` time; 420K+ weekly downloads; supports macOS (x64 + arm64), Linux (x64 + arm64 + armhf), Windows (x64 + x86) |
| commander | 14.x | CLI argument parsing | De-facto standard Node.js CLI framework; 122K+ dependent packages; actively maintained (v14.0.3 published Feb 2025); auto-generates `--help`; requires Node.js >=20; zero dependencies |
| child_process (stdlib) | built-in | FFmpeg process spawning | Native Node.js API; streaming stdout/stderr access needed to parse FFmpeg progress output in real time; no added dependency; `spawn()` (not `exec()`) is correct because FFmpeg runs for minutes and buffers would overflow with `exec()` |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| execa | 9.x (ESM) | FFmpeg/ffprobe process wrapper | Use instead of raw `child_process` to get promise-based control flow, structured error objects, and clean stdout/stderr capture; particularly useful for the ffprobe probe step where you need the full JSON output |
| ora | 9.x (ESM) | Terminal spinner | Show spinner during pass 1 and pass 2 while there is no reliable percentage progress; widely used in shadcn/ui, create-react-app, and other major CLI tools |
| cli-progress | 3.x | Progress bar for pass 2 | Show percentage progress during pass 2 encoding by parsing FFmpeg's `time=` output from stderr; works on PowerShell/Windows 10+ and Unix terminals |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| ESM (`"type": "module"` in package.json) | Module format | Both execa and ora v9 are pure ESM; set `"type": "module"` to avoid dual-module friction |
| Node.js >= 20 | Runtime minimum | Required by commander v14; Node 22 LTS is the deployment target |

## Installation

```bash
# Core runtime dependencies
npm install commander ffmpeg-static execa ora cli-progress

# No dev dependencies required for a simple CLI script
# (add eslint/prettier if linting is desired)
```

## Two-Pass Encoding: The Core Algorithm

This is the heart of the tool. The formula is established FFmpeg practice and unchanged since H.264 became mainstream.

**Step 1 — Probe duration with ffprobe:**
```bash
ffprobe -v quiet -print_format json -show_format "<input>"
# Parse format.duration (float seconds) from JSON output
```

**Step 2 — Calculate video bitrate:**
```
target_size_bytes  = 9.8 * 1024 * 1024          # 10,276,044 bytes
target_size_kbits  = target_size_bytes * 8 / 1000  # ~82,208 kbits
audio_bitrate_kbps = 96                           # kbps (mono/stereo at acceptable quality)
audio_total_kbits  = audio_bitrate_kbps * duration_sec
video_bitrate_kbps = (target_size_kbits - audio_total_kbits) / duration_sec
```

**Step 3 — Two-pass encode:**
```bash
# Pass 1 (analysis — fast, no output written):
ffmpeg -y -i "<input>" \
  -c:v libx264 -b:v <video_bitrate_kbps>k \
  -pass 1 -an -f mp4 /dev/null

# Pass 2 (encode — writes the output file):
ffmpeg -y -i "<input>" \
  -c:v libx264 -b:v <video_bitrate_kbps>k \
  -pass 2 \
  -c:a aac -b:a 96k \
  -movflags +faststart \
  "<output>.mp4"
```

Key flags:
- `-movflags +faststart` moves the MP4 moov atom to the front — required for Discord to play the file inline before full download
- `-passlogfile` temp files default to `ffmpeg2pass` in the cwd; clean them up after pass 2

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Node.js | Python | Python is equally viable technically; choose Python if the team is Python-first or if the tool will be distributed as a `pip`-installable package rather than via npm |
| Node.js | Go | Go produces a single statically-linked binary with no runtime requirement; worth considering if the goal is zero-install distribution (e.g., GitHub Releases binary downloads) |
| Node.js | Shell script (bash) | Shell scripts work and require no runtime, but cross-platform support on Windows (PowerShell ≠ bash) is painful; not recommended for this project given the Windows requirement |
| ffmpeg-static | System FFmpeg (PATH lookup) | Fall back to PATH lookup if ffmpeg-static binary is not available; expose `--ffmpeg-path` flag so power users can point to their own FFmpeg build |
| execa | child_process (raw) | Raw `child_process.spawn` is fine if you want zero dependencies; execa saves ~20 lines of boilerplate for the ffprobe probe step |
| ora + cli-progress | No progress display | Acceptable for a v1 MVP, but FFmpeg runs silently from the user's perspective — a spinner at minimum prevents "is it frozen?" confusion |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| fluent-ffmpeg | Archived May 2025, no longer maintained, does not work correctly with recent FFmpeg versions | Raw `child_process.spawn()` or `execa` |
| `child_process.exec()` for FFmpeg | Buffers all output in memory; will silently corrupt or crash on large video files when the buffer fills | `child_process.spawn()` or `execa` |
| `@ffmpeg/ffmpeg` (WebAssembly) | WASM port designed for browser-side encoding; prohibitively slow for multi-minute encodes; not cross-platform compatible in the same way as native binaries | `ffmpeg-static` (native binary) |
| Single-pass encoding (`-crf` only) | CRF targets quality, not file size; output size is unpredictable; cannot guarantee ≤9.8MB | Two-pass encoding with explicit `-b:v` bitrate target |
| `yargs` | Heavier than commander for a single-command CLI; yargs shines for multi-command tools with complex subcommand trees | `commander` |

## Stack Patterns by Variant

**If user does NOT have Node.js installed and wants a one-file download:**
- Package with `pkg` or use Node.js's built-in Single Executable Application feature (Node 22+)
- ffmpeg-static binary must be bundled separately since it is a platform binary
- This approach is significantly more complex — defer to v2

**If target file size needs to change (e.g., Discord Nitro = 500MB, email = 25MB):**
- The bitrate formula is parameterized by target size; expose `--target-mb` flag from day one
- 9.8MB is the default; the algorithm is identical for any target

**If audio should be stripped (silent video):**
- Replace `-c:a aac -b:a 96k` with `-an`
- The full target size then goes to video bitrate, improving quality

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| commander@14.x | Node.js >= 20 | Do not use commander@12 or earlier on Node 22 — use the current major |
| execa@9.x | Node.js >= 18, ESM only | `"type": "module"` in package.json required; CJS projects must use execa@8 |
| ora@9.x | Node.js >= 18, ESM only | Same ESM constraint as execa; both from sindresorhus's ESM-first packages |
| cli-progress@3.x | Node.js >= 12, CJS and ESM | No ESM constraint; works in both module systems |
| ffmpeg-static@5.x | Node.js >= 10 | Downloads binary at install time; requires internet access during `npm install`; binary is ~50MB per platform |

## Sources

- [fluent-ffmpeg Archived - GitHub Issue #1324](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/1324) — Confirmed archived May 2025
- [Hitting a Target File Size With FFmpeg (Discord Clips)](https://zzzachzzz.github.io/blog/hitting-a-target-file-size-with-ffmpeg-perfect-for-discord-clips) — Bitrate formula and two-pass commands verified (MEDIUM confidence — blog post)
- [Two-Pass encoding with FFmpeg - Martin Riedl](https://www.martin-riedl.de/2022/01/09/two-pass-encoding-with-ffmpeg/) — Two-pass command structure (MEDIUM confidence)
- [FFmpeg Documentation](https://www.ffmpeg.org/ffmpeg.html) — Official reference for flags (HIGH confidence)
- [commander npm](https://www.npmjs.com/package/commander) — v14.0.3, 122K+ dependents (HIGH confidence)
- [ffmpeg-static npm](https://www.npmjs.com/package/ffmpeg-static) — v5.x, 420K+ weekly downloads (HIGH confidence)
- [execa v9 release notes](https://medium.com/@ehmicky/execa-9-release-d0d5daaa097f) — ESM-only, v9.6.1 current (HIGH confidence)
- [ora npm](https://www.npmjs.com/package/ora) — v9.0.0, ESM-only (HIGH confidence)
- [Node.js 22 LTS Release](https://nodejs.org/en/blog/release/v22.0.0) — Active LTS, Maglev compiler default (HIGH confidence)

---
*Stack research for: FFmpeg CLI video compression tool (Discord 9.8MB target)*
*Researched: 2026-03-25*
