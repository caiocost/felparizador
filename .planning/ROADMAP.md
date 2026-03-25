# Roadmap: ffmpeg10mb

## Overview

Four sequential phases that build the pipeline from the inside out: the bitrate math foundation first, then the input analysis layer, then the two-pass encoding core, and finally CLI wiring and polish. Each phase produces a tested, usable slice of the system. The invariant — output file ≤9.8 MiB, playable on Discord — is verifiable by Phase 3 and tightened by Phase 4.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - Node.js ESM project scaffolding, bundled FFmpeg, and the pure bitrate calculator
- [ ] **Phase 2: Input Analysis** - FFmpeg availability check, input file validation, and ffprobe probe
- [ ] **Phase 3: Core Encoding** - Two-pass H.264 pipeline with progress display, temp-file safety, and output verification
- [ ] **Phase 4: CLI Polish** - Full CLI flags, overwrite protection, human-readable errors, and dry-run mode

## Phase Details

### Phase 1: Foundation
**Goal**: A testable project skeleton exists with the core bitrate formula proven correct before any I/O is written
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03, FOUND-04
**Success Criteria** (what must be TRUE):
  1. Running `npm install` succeeds and `ffmpeg-static` resolves the bundled FFmpeg binary path without requiring a system FFmpeg install
  2. The bitrate calculator returns the correct `videoBitrateKbps` for known inputs (e.g., a 60-second video produces a value within 1 kbps of the expected result)
  3. All variable names in the bitrate module carry explicit unit suffixes (`targetSizeBytes`, `videoBitrateKbps`, `audioBitsTotal`) and the 9.6 MiB / 9.8 MiB constants are documented with binary-vs-decimal comments
  4. Unit tests for the bitrate calculator pass with zero failures
**Plans:** 1/2 plans executed

Plans:
- [ ] 01-01-PLAN.md — Project scaffold, error hierarchy, bitrate calculator, and stub modules
- [ ] 01-02-PLAN.md — Unit tests for bitrate calculator and size constants

### Phase 2: Input Analysis
**Goal**: The tool catches every preventable failure before encoding starts and gives the user actionable information
**Depends on**: Phase 1
**Requirements**: INPUT-01, INPUT-02, INPUT-03, INPUT-04, INPUT-05
**Success Criteria** (what must be TRUE):
  1. Running the tool without FFmpeg on PATH prints a human-readable install message (not a raw Node.js error) and exits non-zero
  2. Passing a nonexistent input path prints a clear file-not-found error before any FFmpeg call is made
  3. Passing a valid video file prints its detected duration, audio presence, and audio bitrate before encoding begins
  4. Passing a video whose projected video bitrate falls below 50 kbps prints a quality warning before the encode starts
  5. Passing a video under 5 seconds produces a clear message explaining how it will be handled
**Plans**: TBD

### Phase 3: Core Encoding
**Goal**: The tool can compress any video to ≤9.8 MiB and reliably clean up after itself
**Depends on**: Phase 2
**Requirements**: ENC-01, ENC-02, ENC-03, ENC-04, ENC-05, ENC-06, ENC-07, UX-01, UX-04, VER-01, VER-02
**Success Criteria** (what must be TRUE):
  1. Running the tool on any video produces an MP4 output file whose size is ≤9.8 MiB (verified programmatically; tool exits non-zero if it overshoots)
  2. A spinner appears during pass 1 and a progress bar with percentage appears during pass 2 — the terminal is never silent for more than a second
  3. After encoding completes, a post-encode report shows original size, output size, duration, and video bitrate achieved
  4. Interrupting the tool with Ctrl-C kills the FFmpeg subprocess and removes all temp passlog files — no orphaned files remain in the OS temp directory
  5. Two simultaneous encode runs do not corrupt each other's passlog files
**Plans**: TBD

### Phase 4: CLI Polish
**Goal**: Users have full control over the tool's behavior through documented flags, and every failure mode produces a clear explanation
**Depends on**: Phase 3
**Requirements**: UX-02, UX-03, UX-05, CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06, CLI-07
**Success Criteria** (what must be TRUE):
  1. Running `ffmpeg10mb input.mp4` without flags produces output at `input_discord.mp4` in the same directory; passing `--output out.mp4` writes to the specified path instead
  2. Running the tool when the output file already exists prints an error and exits without overwriting the file
  3. Running `ffmpeg10mb --help` displays all flags (`--output`, `--no-audio`, `--target`, `--audio-bitrate`, `--dry-run`) with descriptions
  4. Running with `--dry-run` prints the projected video bitrate and quality estimate without creating any output file or passlog
  5. Common FFmpeg failure strings (codec not found, permission denied, invalid data) are translated to plain-English explanations in the error output
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 1/2 | In Progress|  |
| 2. Input Analysis | 0/TBD | Not started | - |
| 3. Core Encoding | 0/TBD | Not started | - |
| 4. CLI Polish | 0/TBD | Not started | - |
