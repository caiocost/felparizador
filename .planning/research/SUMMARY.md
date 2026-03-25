# Project Research Summary

**Project:** ffmpeg10mb
**Domain:** CLI video compression tool — FFmpeg-based, exact file size targeting for Discord's 10MB upload limit
**Researched:** 2026-03-25
**Confidence:** HIGH

## Executive Summary

This is a single-purpose CLI tool with a well-understood algorithm at its core: two-pass H.264 encoding with an explicit bitrate target derived from a file size budget. The domain is mature and heavily documented — FFmpeg's two-pass ABR mode has been the industry standard for constrained-size encodes since H.264 became mainstream, and several open-source reference implementations exist (ffmpeg4discord, 8mb, 10mb.video). The recommended implementation is a Node.js CLI distributed via npm, using `ffmpeg-static` to bundle the FFmpeg binary so users never need to install FFmpeg separately. The critical algorithm — `video_bitrate_kbps = (target_bytes * 8 - audio_bits) / duration_seconds / 1000` — is proven and simple, but gets the tool into trouble the moment it is implemented without careful unit discipline or without subtracting audio budget.

The recommended approach is to build a sequential async pipeline with six clean module boundaries: CLI argument parsing, ffprobe probe, bitrate calculation (pure function, no I/O), pass 1 encode, pass 2 encode, and post-encode verification and cleanup. The bitrate calculator must be isolated as a pure function because it is the single most critical correctness invariant, and it is also the easiest component to unit-test. The pipeline must always clean up FFmpeg's passlog temp files in a `finally` block — not just on success — and must always verify the actual output file size, since the bitrate formula cannot account for MP4 container overhead with perfect precision.

The key risks are all well-understood and preventable with upfront engineering discipline. The top three are: (1) off-by-unit errors in the bitrate formula (bits vs bytes confusion produces an 8x size miss); (2) MP4 container overhead causing files to overshoot the 9.8MB target at low bitrates, particularly for long videos; and (3) a poor user experience when FFmpeg is missing or encoding is silent for minutes. None of these require complex solutions — they require explicit named constants with unit suffixes, a conservative overhead deduction constant (use `9.6 MiB` as the effective bitrate target), and a stderr-parsing progress display.

## Key Findings

### Recommended Stack

The tool should be a Node.js 22 LTS CLI distributed via npm. The ESM module format is required because the two best supporting libraries — `execa` v9 (process spawning) and `ora` v9 (spinner) — are pure ESM. `commander` v14 handles argument parsing with zero dependencies and auto-generated help. `ffmpeg-static` v5 bundles FFmpeg 6.1.1 and downloads the correct static binary per platform at `npm install` time, eliminating the "user must install FFmpeg" problem entirely. `cli-progress` v3 handles the progress bar during pass 2 by parsing FFmpeg's `time=` stderr output.

The most important "do not use" rules: `fluent-ffmpeg` is archived (May 2025) and broken with recent FFmpeg; `child_process.exec()` buffers FFmpeg's verbose stderr and will overflow on large videos — always use `spawn()`; single-pass CRF encoding cannot guarantee a target file size and must not be used.

**Core technologies:**
- Node.js 22 LTS: runtime — long-term support until 2027, fastest CLI startup, npm distribution is the lowest-friction install path
- ffmpeg-static 5.x: bundled FFmpeg binary — eliminates the user FFmpeg installation requirement; 420K+ weekly downloads; covers macOS x64/arm64, Linux x64/arm64/armhf, Windows x64/x86
- commander 14.x: CLI argument parsing — de-facto standard, zero dependencies, auto-generates `--help`; requires Node.js >= 20
- execa 9.x: ffprobe subprocess wrapper — promise-based, structured errors, clean stdout/stderr capture; ESM only
- ora 9.x: terminal spinner — shows activity during pass 1 and any phase without reliable progress percentage; ESM only
- cli-progress 3.x: progress bar — parses FFmpeg stderr `time=` tokens during pass 2; works on PowerShell/Windows 10+

### Expected Features

Research cross-referenced five existing open-source tools in this exact niche. The MVP feature set is well-defined by what competitors implement and where they fall short.

**Must have (table stakes):**
- Two-pass H.264 encoding to 9.8 MiB ceiling — this is the entire product
- FFmpeg/ffprobe availability check on startup with human-readable install instructions on failure
- Input file validation: exists, readable, recognizable video format
- ffprobe probe before encoding: duration, audio stream presence, audio bitrate
- Audio kept at 96kbps AAC by default with `--no-audio` flag to strip
- Output path defaulting to `<input_stem>_discord.mp4` with `--output` flag to override
- Overwrite protection: error if output exists (not silent overwrite)
- Progress display during both encoding passes by parsing FFmpeg stderr
- Human-readable error messages translating all common FFmpeg failure modes
- Post-encode quality report: original size, output size, duration, video bitrate achieved

**Should have (competitive differentiators):**
- Quality warning when projected video bitrate falls below acceptable threshold (warn before a 10-minute encode produces an unwatchable file)
- `--target <MB>` custom size flag — some users need 8MB for older clients; parameterize from day one
- `--audio-bitrate <kbps>` flag — let users trade audio quality for video quality
- Dry-run / estimate mode — show projected bitrate and quality without encoding

**Defer (v2+):**
- Automatic resolution downscale — useful but requires threshold tuning; validate quality warnings first
- Batch processing — shell loops serve this; keep v1 single-file
- H.265/AV1 output — Discord's embed player does not reliably play these; defer until support improves

### Architecture Approach

The architecture is a linear sequential async pipeline. Each stage is an async function returning a typed result; no shared mutable state between stages. The pipeline flows: parse args → probe (ffprobe) → calculate bitrate (pure function) → pass 1 encode → pass 2 encode → verify size → cleanup → report. The bitrate calculator must be a pure function with zero I/O — it is the core correctness invariant and the most valuable unit test target.

The project structure should follow a one-file-per-concern layout (`probe.ts`, `bitrate.ts`, `encode.ts`, `verify.ts`, `errors.ts`, `index.ts`) with components built in dependency order: errors first, bitrate second (unit-testable immediately), probe third, encode fourth, verify fifth, CLI last.

**Major components:**
1. CLI parser (`index.ts`) — parse argv, validate input path, derive output path, validate target size; orchestrates pipeline
2. Probe layer (`probe.ts`) — ffprobe wrapper producing `ProbeResult` with duration, audio presence, audio bitrate
3. Bitrate calculator (`bitrate.ts`) — pure function: `video_bitrate_kbps = floor((target_bits - audio_bits) / duration_s / 1000)`
4. Encoder (`encode.ts`) — owns both pass 1 and pass 2 FFmpeg invocations with `-passlogfile` targeting OS temp dir
5. Post-processor (`verify.ts`) — verifies output file size, cleans up passlog files in `finally`, prints result
6. Error handler (`errors.ts`) — typed error classes, platform-aware messages, exit codes

### Critical Pitfalls

Research identified 10 pitfalls; the 5 highest-impact ones to address before writing any encoding code:

1. **Bits vs bytes unit confusion in the bitrate formula** — name every variable with a unit suffix (`targetSizeBytes`, `videoBitrateKbps`, `audioBitsTotal`); keep all intermediate values in bits; this is the #1 source of 8x size misses
2. **MP4 container overhead causes overshoot at low bitrates** — do not target `9.8 MiB` in the formula; use `9.6 MiB` as the effective target to leave headroom for the moov atom; always verify actual output file size programmatically and emit a non-zero exit code if it exceeds `9.8 MiB`
3. **Passlog file management: path collision and cleanup** — always pass `-passlogfile <os.tmpdir()>/<uuid>-ffmpeg2pass` to FFmpeg; clean up `{prefix}.log` and `{prefix}.log.mbtree` in a `finally` block unconditionally; never let them default to CWD
4. **Windows path spaces break subprocess invocation** — always use argv array form (`spawn('ffmpeg', ['-i', inputPath, ...])`), never construct shell strings from user-supplied paths; test on a Windows path with spaces before release
5. **Very long videos produce unacceptable quality silently** — compute expected video bitrate during the probe phase; warn and optionally abort if it falls below 50 kbps (roughly corresponds to videos over ~25 minutes at this target size)

## Implications for Roadmap

Based on research, the dependency graph is clear and suggests a 4-phase structure. Phase order is dictated by the build order in ARCHITECTURE.md (errors → bitrate → probe → encode → verify → CLI) and the pitfall-to-phase mapping in PITFALLS.md.

### Phase 1: Foundation — Project Setup and Core Algorithm

**Rationale:** The bitrate calculator is the project's core correctness invariant with zero external dependencies. Building and verifying it first means all downstream work rests on a tested foundation. This phase also establishes the module structure and constants that every other phase depends on.
**Delivers:** Initialized Node.js ESM project with all dependencies installed; `errors.ts` error hierarchy; `bitrate.ts` pure function with full unit test coverage; named constants with explicit unit documentation (target size in MiB, not MB, with a comment explaining the binary convention).
**Addresses features:** None user-visible, but correctly lays the groundwork for the size guarantee.
**Avoids pitfalls:** Bits vs bytes confusion (Pitfall 2); Discord MiB vs MB ambiguity (Pitfall 9) — both resolved at the constants definition stage.

### Phase 2: Input Analysis — Probe and Validation

**Rationale:** The encoder cannot run without duration from ffprobe; validation and quality warnings must fire before encoding starts to avoid wasting user time on hopeless encodes. This phase is independently testable with sample fixture files.
**Delivers:** `probe.ts` ffprobe wrapper with robust duration parsing (container-level with stream-level fallback); input file existence check; FFmpeg/ffprobe availability pre-flight with human-readable install instructions; quality warning when projected video bitrate is below threshold; short video and very long video detection with appropriate messages.
**Addresses features:** FFmpeg availability check with human-readable errors (P1); input file validation (P1); quality warning (P2).
**Avoids pitfalls:** FFmpeg not found poor UX (Pitfall 6); duration probe inaccuracy (Pitfall 3); very long video unacceptable quality (Pitfall 8).

### Phase 3: Core Encoding — Two-Pass Pipeline

**Rationale:** This is the central deliverable. It must be built after probe (needs `ProbeResult`) and bitrate calculator (needs `videoBitrateKbps`). Both passes belong in one module because they share codec flags and the passlog file prefix.
**Delivers:** `encode.ts` with pass 1 and pass 2 FFmpeg invocations; `-passlogfile` targeting OS temp dir with UUID prefix; cleanup in `finally` block; real-time progress parsing from FFmpeg stderr (spinner for pass 1, progress bar with percentage for pass 2); platform-aware null device (`/dev/null` vs `NUL`); `verify.ts` post-encode size check with non-zero exit on overshoot; graceful SIGINT/SIGTERM handling that kills the subprocess and cleans temp files.
**Addresses features:** Two-pass encoding to size target (P1); progress display (P1); keep audio at reduced bitrate (P1); post-encode quality report (P1).
**Avoids pitfalls:** Container overhead overshoot (Pitfall 1); passlog collision and cleanup (Pitfall 4); Windows path spaces (Pitfall 5); very short video overshoot (Pitfall 7); square/static content overshoot (Pitfall 10); using `exec` instead of `spawn` (anti-pattern from ARCHITECTURE.md).

### Phase 4: CLI Polish and Power-User Flags

**Rationale:** The CLI wiring and optional flags are last because they depend on all pipeline stages being stable. Adding flags before the core is proven creates integration confusion.
**Delivers:** `index.ts` CLI with `commander`; `--output` flag; overwrite protection; `--no-audio` flag; `--target <MB>` custom size flag; `--audio-bitrate <kbps>` flag; dry-run / estimate mode; complete `--help` text; human-readable error message wrapping for all common FFmpeg failure strings; final post-encode summary line.
**Addresses features:** Output path control and overwrite protection (P1); human-readable errors (P1); `--no-audio` (P2); custom target size (P2); audio bitrate flag (P2); dry-run mode (P2).

### Phase Ordering Rationale

- Bitrate calculator must precede probe and encode because both depend on its type definitions and formula constants.
- Probe must precede encoding because the encoder's `videoBitrateKbps` input is derived from probe output.
- Both encoding passes belong in the same phase because they are tightly coupled through the passlog prefix and codec flags — splitting them would create fragile cross-module state.
- CLI polish is last because it is purely additive and does not affect the correctness of the encoding pipeline; shipping an opinionated single-command tool is better than delaying the core to add flags.
- The pitfall research strongly favors addressing container overhead, unit discipline, and passlog management at the earliest phase rather than retrofitting them — these are cheap to get right from the start and expensive to fix after the fact.

### Research Flags

Phases with well-documented patterns (can skip `research-phase`):
- **Phase 1 (Foundation):** Pure Node.js ESM project setup and math — entirely standard
- **Phase 2 (Probe):** ffprobe JSON parsing is well-documented in official FFmpeg docs and multiple high-confidence sources
- **Phase 3 (Encoding):** Two-pass FFmpeg commands are documented exhaustively; the subprocess spawn pattern is standard Node.js
- **Phase 4 (CLI):** commander v14 has complete official documentation; flag patterns are standard

No phases require additional research-phase work. All critical domain knowledge is captured in the four research files at HIGH confidence.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All packages verified on npm with download counts and release dates; Node.js 22 LTS release confirmed; fluent-ffmpeg archive confirmed on GitHub |
| Features | HIGH | Cross-verified with 5 open-source reference implementations in the exact same niche; competitor feature table provides direct comparison |
| Architecture | HIGH | Sequential async pipeline pattern is industry-standard for CLI subprocess tools; FFmpeg command flags verified in official documentation and multiple independent sources |
| Pitfalls | HIGH | Most pitfalls sourced from real issues in production tools (immich, staxrip, ffmpeg-python, fluent-ffmpeg) plus the 10mb.video Go reference implementation which documented the square-content overshoot specifically |

**Overall confidence:** HIGH

### Gaps to Address

- **Discord's exact byte threshold:** The 10MB limit is confirmed but whether Discord enforces `10,000,000 bytes` (decimal) or `10,485,760 bytes` (binary MiB) has not been empirically verified by uploading test files. Use `9.8 MiB` (= `10,276,044 bytes`) as the effective ceiling constant, which is safe under either interpretation. Validate with test uploads during Phase 3.
- **Container overhead constant:** The architecture recommends a `9.6 MiB` effective target to reserve headroom for the moov atom, but this constant was derived from the literature (200–500KB is the cited range for H.264/AAC MP4 files). Validate this empirically across a range of durations during Phase 3 testing. Adjust if the headroom proves too conservative or insufficient.
- **Short video CRF threshold:** Research recommends switching from ABR to CRF for videos under ~5 seconds, but the exact duration threshold and optimal CRF value need tuning with real test content during Phase 3.

## Sources

### Primary (HIGH confidence)
- [FFmpeg Documentation — ffmpeg.org](https://www.ffmpeg.org/ffmpeg.html) — official flag reference for two-pass encoding, `-passlogfile`, `-movflags +faststart`
- [ffprobe Documentation — ffmpeg.org](https://ffmpeg.org/ffprobe.html) — JSON output format, `-show_streams`, `-show_format` flags
- [Node.js 22 LTS Release](https://nodejs.org/en/blog/release/v22.0.0) — LTS schedule, Maglev compiler
- [commander npm — v14.0.3](https://www.npmjs.com/package/commander) — 122K+ dependents, Node.js >= 20 requirement
- [ffmpeg-static npm — v5.x](https://www.npmjs.com/package/ffmpeg-static) — 420K+ weekly downloads, platform binary matrix
- [execa v9 release notes](https://medium.com/@ehmicky/execa-9-release-d0d5daaa097f) — ESM-only constraint, v9.6.1 current
- [ora npm — v9.0.0](https://www.npmjs.com/package/ora) — ESM-only, spinner API
- [10mb.video (Go reference implementation)](https://github.com/ugjka/10mb.video) — documented x264 overshoot with square static content; `-down 512` workaround
- [Quantifying Packaging Overhead — Mux](https://www.mux.com/blog/quantifying-packaging-overhead-2) — container overhead analysis at low bitrates

### Secondary (MEDIUM confidence)
- [Hitting a Target File Size With FFmpeg (Discord Clips) — zzzachzzz](https://zzzachzzz.github.io/blog/hitting-a-target-file-size-with-ffmpeg-perfect-for-discord-clips) — bitrate formula and two-pass commands
- [Two-Pass encoding with FFmpeg — Martin Riedl](https://www.martin-riedl.de/2022/01/09/two-pass-encoding-with-ffmpeg/) — pass 1/2 accuracy validation (5992 kbps achieved vs 6000 kbps target)
- [ffmpeg4discord GitHub — zfleeman](https://github.com/zfleeman/ffmpeg4discord) — Python two-pass reference; competitor feature comparison
- [Understanding Rate Control Modes — slhck.info](https://slhck.info/video/2017/03/01/rate-control.html) — VBV, bitrate accuracy, overshoot causes
- [FFmpeg two-pass log file cleanup — immich issue #2600](https://github.com/immich-app/immich/issues/2600) — temp file accumulation in production
- [FFmpeg multipass fails due to passlog location — staxrip issue #388](https://github.com/staxrip/staxrip/issues/388) — write permission failure for passlog
- [CLI UX best practices: progress displays — Evil Martians](https://evilmartians.com/chronicles/cli-ux-best-practices-3-patterns-for-improving-progress-displays) — progress display patterns

---
*Research completed: 2026-03-25*
*Ready for roadmap: yes*
