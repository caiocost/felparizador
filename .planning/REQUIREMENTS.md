# Requirements: ffmpeg10mb

**Defined:** 2026-03-25
**Core Value:** Any video in, 9.8MB MP4 out — guaranteed to be sendable on Discord.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Foundation

- [ ] **FOUND-01**: Project uses Node.js 22 LTS with ESM modules (`"type": "module"`)
- [ ] **FOUND-02**: `ffmpeg-static` bundles FFmpeg binary so users don't need to install FFmpeg separately
- [ ] **FOUND-03**: Bitrate calculator is a pure function with explicit unit-suffixed variable names (`targetSizeBytes`, `videoBitrateKbps`, `audioBitsTotal`)
- [ ] **FOUND-04**: Target size constant is defined as `9.6 MiB` (effective) with `9.8 MiB` as the ceiling, with comments explaining binary MiB convention

### Input Validation

- [ ] **INPUT-01**: Tool checks FFmpeg/ffprobe availability on startup and shows human-readable install instructions if missing
- [ ] **INPUT-02**: Tool validates input file exists and is readable before encoding
- [ ] **INPUT-03**: Tool runs ffprobe to extract duration, audio stream presence, and audio bitrate before encoding
- [ ] **INPUT-04**: Tool warns user when projected video bitrate falls below 50 kbps (video quality will be very poor)
- [ ] **INPUT-05**: Tool detects very short videos (< 5s) and handles them appropriately

### Encoding

- [ ] **ENC-01**: Tool performs two-pass H.264 encoding targeting the calculated bitrate
- [ ] **ENC-02**: Output is an MP4 file with H.264 video and AAC audio
- [ ] **ENC-03**: Tool keeps audio at 96 kbps AAC by default
- [ ] **ENC-04**: Pass 1 and pass 2 use `-passlogfile` pointing to OS temp dir with UUID prefix to avoid collisions
- [ ] **ENC-05**: Temp passlog files (`*.log`, `*.log.mbtree`) are always cleaned up in a `finally` block
- [ ] **ENC-06**: Tool uses array-form `spawn()` for all subprocess invocations (never shell string interpolation)
- [ ] **ENC-07**: Platform null device is detected at runtime (`/dev/null` vs `NUL` on Windows)

### Output & UX

- [ ] **UX-01**: Tool shows a spinner during pass 1 and a progress bar with percentage during pass 2
- [ ] **UX-02**: Output defaults to `<input_stem>_discord.mp4` in the same directory as input
- [ ] **UX-03**: Tool errors if output file already exists (no silent overwrite)
- [ ] **UX-04**: Tool displays a post-encode report: original size, output size, duration, video bitrate achieved
- [ ] **UX-05**: All common FFmpeg error messages are translated to human-readable explanations

### Verification

- [ ] **VER-01**: Tool verifies actual output file size after encoding and exits with non-zero code if it exceeds 9.8 MiB
- [ ] **VER-02**: Tool handles SIGINT/SIGTERM by killing the FFmpeg subprocess and cleaning up temp files before exit

### CLI

- [ ] **CLI-01**: CLI accepts a positional input file argument
- [ ] **CLI-02**: `--output <path>` flag overrides the default output path
- [ ] **CLI-03**: `--no-audio` flag strips audio from the output
- [ ] **CLI-04**: `--target <MB>` flag sets a custom size target (default: 9.8)
- [ ] **CLI-05**: `--audio-bitrate <kbps>` flag overrides default 96 kbps audio bitrate
- [ ] **CLI-06**: `--dry-run` flag shows projected bitrate and quality estimate without encoding
- [ ] **CLI-07**: `--help` displays complete usage instructions

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Advanced Encoding

- **ADV-01**: Automatic resolution downscale when video bitrate would be too low for acceptable quality
- **ADV-02**: H.265/HEVC output option for smaller files (when Discord support improves)
- **ADV-03**: Automatic retry with lower target if first encode overshoots

### Batch Processing

- **BATCH-01**: Accept multiple input files and compress each
- **BATCH-02**: Progress display across multiple files

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| GUI / web interface | CLI is sufficient; unnecessary complexity for v1 |
| Direct Discord upload | Tool outputs the file; user uploads manually |
| H.265 / AV1 output | Discord embed player has compatibility gaps; defer |
| Batch processing | Shell loops satisfy power users; keep v1 single-file |
| Cloud/remote encoding | Local tool; no server-side processing |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Pending |
| FOUND-02 | Phase 1 | Pending |
| FOUND-03 | Phase 1 | Pending |
| FOUND-04 | Phase 1 | Pending |
| INPUT-01 | Phase 2 | Pending |
| INPUT-02 | Phase 2 | Pending |
| INPUT-03 | Phase 2 | Pending |
| INPUT-04 | Phase 2 | Pending |
| INPUT-05 | Phase 2 | Pending |
| ENC-01 | Phase 3 | Pending |
| ENC-02 | Phase 3 | Pending |
| ENC-03 | Phase 3 | Pending |
| ENC-04 | Phase 3 | Pending |
| ENC-05 | Phase 3 | Pending |
| ENC-06 | Phase 3 | Pending |
| ENC-07 | Phase 3 | Pending |
| UX-01 | Phase 3 | Pending |
| UX-02 | Phase 3 | Pending |
| UX-03 | Phase 3 | Pending |
| UX-04 | Phase 3 | Pending |
| UX-05 | Phase 4 | Pending |
| VER-01 | Phase 3 | Pending |
| VER-02 | Phase 3 | Pending |
| CLI-01 | Phase 4 | Pending |
| CLI-02 | Phase 4 | Pending |
| CLI-03 | Phase 4 | Pending |
| CLI-04 | Phase 4 | Pending |
| CLI-05 | Phase 4 | Pending |
| CLI-06 | Phase 4 | Pending |
| CLI-07 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-25*
*Last updated: 2026-03-25 after initial definition*
