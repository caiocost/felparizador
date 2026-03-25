---
phase: 02-input-analysis
plan: 01
subsystem: probe
tags: [ffprobe, execa, node:test, typescript]

requires:
  - phase: 01-foundation
    provides: errors.ts, bitrate.ts stubs, ProbeResult stub
provides:
  - probeVideo() with ffprobe JSON parsing
  - resolveFfprobePath() async resolution
  - tests/probe.test.ts and fixtures short.mp4, video-only.mp4
affects: [03-core-encoding]

tech-stack:
  added: [execa]
  patterns: [execa for ffprobe spawn, fs access for input validation]

key-files:
  created:
    - tests/probe.test.ts
    - tests/fixtures/short.mp4
    - tests/fixtures/video-only.mp4
  modified:
    - src/probe.ts
    - package.json
    - package-lock.json
    - tsconfig.json

key-decisions:
  - "Added tsconfig types node for Node built-in modules in probe.ts"
  - "ffprobe required on PATH or adjacent to ffmpeg-static; winget/Gyan typical on Windows"

requirements-completed: [INPUT-01, INPUT-02, INPUT-03]

duration: 15min
completed: 2026-03-25
---

# Phase 2 Plan 1: Input analysis — probe pipeline

**Implemented ffprobe-based probeVideo(), extended ProbeResult, execa dependency, and integration tests with generated MP4 fixtures.**

## Accomplishments

- Installed `execa` and extended `ProbeResult` with `widthPx`, `heightPx`, `fileSizeBytes`
- Generated `tests/fixtures/short.mp4` and `video-only.mp4` via bundled `ffmpeg.exe`
- Implemented `resolveFfprobePath`, `validateInputFile` (internal), `probeVideo` with JSON parsing
- Added `tests/probe.test.ts` covering PATH resolution, InputValidationError, and fixture metadata

## Verification

- `npx tsc --noEmit` — pass
- `node --import tsx/esm --test tests/bitrate.test.ts tests/probe.test.ts` — pass

## Self-Check: PASSED
