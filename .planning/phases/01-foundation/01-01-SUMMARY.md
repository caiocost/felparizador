---
phase: 01-foundation
plan: 01
subsystem: infra
tags: [typescript, nodejs, esm, ffmpeg-static, npm]

# Dependency graph
requires: []
provides:
  - "ESM TypeScript project with NodeNext module resolution"
  - "ffmpeg-static bundled binary (ffmpeg.exe) resolved at install time"
  - "calculateVideoBitrate() pure function with binary MiB constants (9.6/9.8)"
  - "FfmpegToolError base class and 4 typed subclasses (exit codes 2-5)"
  - "Stub modules for probe.ts, encode.ts, verify.ts, index.ts"
affects: [02-probe, 03-encode, 04-cli]

# Tech tracking
tech-stack:
  added:
    - "typescript 6.0.2 — TypeScript compiler with NodeNext module resolution"
    - "tsx 4.21.0 — TypeScript runner for Node.js (ESM-native)"
    - "@types/node 25.5.0 — Node.js type definitions"
    - "ffmpeg-static 5.3.0 — bundled FFmpeg binary (platform-specific)"
  patterns:
    - "NodeNext ESM: all cross-file imports use .js extensions in .ts source files"
    - "Binary MiB constants: MIB_TO_BYTES = 1_048_576 (never decimal 1_000_000)"
    - "Typed error hierarchy: all tool errors extend FfmpegToolError with exitCode"
    - "Unit-suffixed variables: targetSizeBytes, durationSeconds, audioBitrateKbps, audioBitsTotal"
    - "CJS interop cast: ffmpeg-static (CJS) imported and cast via 'unknown as string | null' in NodeNext mode"

key-files:
  created:
    - "package.json — ESM project config with all dependencies"
    - "tsconfig.json — ES2022 target, NodeNext module resolution, strict mode"
    - ".gitignore — excludes node_modules/, dist/"
    - "src/errors.ts — FfmpegToolError + InputValidationError/FfmpegNotFoundError/EncodingFailedError/OutputOversizeError"
    - "src/bitrate.ts — calculateVideoBitrate(), TARGET_EFFECTIVE_MIB=9.6, TARGET_CEILING_MIB=9.8"
    - "src/probe.ts — ProbeResult interface, resolveFfmpegPath() stub, probeVideo() stub"
    - "src/encode.ts — encode() stub"
    - "src/verify.ts — verifyOutput() stub"
    - "src/index.ts — re-exports from bitrate.ts and errors.ts"
    - "package-lock.json — reproducible install lock"
  modified: []

key-decisions:
  - "Use Math.floor() on TARGET_EFFECTIVE_BYTES and TARGET_CEILING_BYTES to guarantee integer byte counts"
  - "Place tests in tests/ (not src/) to keep production build clean"
  - "Cast ffmpeg-static default export via 'unknown as string | null' for NodeNext CJS interop"

patterns-established:
  - "Pattern: All src/ imports use .js extensions for NodeNext compatibility"
  - "Pattern: Size constants use MIB_TO_BYTES = 1_048_576 with comments explaining binary vs decimal"
  - "Pattern: Error classes carry exitCode for process.exit() in CLI entry point"

requirements-completed: [FOUND-01, FOUND-02, FOUND-03, FOUND-04]

# Metrics
duration: 4min
completed: 2026-03-25
---

# Phase 1 Plan 01: Foundation Scaffold Summary

**Node.js 22 ESM TypeScript project with ffmpeg-static binary, binary MiB bitrate calculator, typed error hierarchy (exit codes 2-5), and stub modules for all future phases**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-25T22:07:45Z
- **Completed:** 2026-03-25T22:11:57Z
- **Tasks:** 2 of 2
- **Files modified:** 10

## Accomplishments
- Scaffolded package.json with ESM (`"type": "module"`), Node>=22 engine, and all dependencies — npm install succeeds, ffmpeg-static resolves `node_modules/ffmpeg-static/ffmpeg.exe`
- Created `src/bitrate.ts` with `calculateVideoBitrate()` pure function using binary MiB constants (TARGET_EFFECTIVE_MIB=9.6, TARGET_CEILING_MIB=9.8) and unit-suffixed variables throughout
- Created `src/errors.ts` with `FfmpegToolError` base class and four typed subclasses (InputValidationError=2, FfmpegNotFoundError=3, EncodingFailedError=4, OutputOversizeError=5)
- Created stubs for probe.ts (with ProbeResult interface and resolveFfmpegPath), encode.ts, verify.ts, and index.ts — TypeScript compiles all 6 source files with zero errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Create project scaffold with ESM configuration and dependencies** - `3259156` (chore)
2. **Task 2: Create error hierarchy, bitrate calculator, and stub modules** - `1e2c969` (feat)
3. **Extra: package-lock.json** - `2db9b3c` (chore)

**Plan metadata:** (docs commit — to be created)

## Files Created/Modified
- `package.json` — ESM project config: type:module, node>=22, ffmpeg-static + devDeps
- `tsconfig.json` — ES2022 target, NodeNext module + resolution, strict mode
- `.gitignore` — excludes node_modules/, dist/, *.log
- `src/errors.ts` — FfmpegToolError base + 4 typed subclasses with exit codes 2-5
- `src/bitrate.ts` — pure calculateVideoBitrate(), TARGET_EFFECTIVE_BYTES/CEILING_BYTES via Math.floor
- `src/probe.ts` — ProbeResult interface, resolveFfmpegPath() stub, probeVideo() stub
- `src/encode.ts` — encode() stub for Phase 3
- `src/verify.ts` — verifyOutput() stub for Phase 3
- `src/index.ts` — re-exports using .js extensions (NodeNext requirement)
- `package-lock.json` — reproducible install lockfile

## Decisions Made
- Used `Math.floor()` on TARGET_EFFECTIVE_BYTES/TARGET_CEILING_BYTES to ensure integer byte counts (avoids float-byte confusion downstream)
- Tests will live in `tests/` (not `src/`) so tsconfig.json excludes them from the production build
- Cast ffmpeg-static import via `unknown as string | null` for TypeScript NodeNext CJS interop (not a bug in the package — NodeNext mode sees CJS default exports as namespace types without an `exports` field)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript CJS interop error for ffmpeg-static in NodeNext mode**
- **Found during:** Task 2 (Create error hierarchy, bitrate calculator, and stub modules)
- **Issue:** `import ffmpegStaticPath from 'ffmpeg-static'` caused TS2322 error: "Type 'typeof import(...)' is not assignable to type 'string'" — TypeScript NodeNext treats CJS modules without an `"exports"` field as module namespace types rather than their documented default export type
- **Fix:** Added intermediate variable with `as unknown as string | null` cast (matching the package's documented `types/index.d.ts` return type)
- **Files modified:** src/probe.ts
- **Verification:** `npx tsc --noEmit` exits 0 after fix
- **Committed in:** `1e2c969` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Required for TypeScript to compile. No scope creep. The cast matches the package's own documented type (`string | null`).

## Issues Encountered
- Node.js engine warning during `npm install`: environment runs v20.19.5 but package.json requires >=22. This is expected — the research file documents this discrepancy and it does not affect functionality at this stage.

## User Setup Required
None - no external service configuration required. ffmpeg-static downloads the binary at `npm install` time automatically.

## Next Phase Readiness
- All source files compile cleanly — ready for Phase 1 Plan 02 (unit tests for bitrate.ts)
- `calculateVideoBitrate()` and all constants are ready to be unit-tested with node:test
- Stub modules typed correctly — Phase 2 can implement probe.ts by replacing the stub with real ffprobe logic
- No blockers

---
*Phase: 01-foundation*
*Completed: 2026-03-25*

## Self-Check: PASSED

- FOUND: package.json
- FOUND: tsconfig.json
- FOUND: .gitignore
- FOUND: src/errors.ts
- FOUND: src/bitrate.ts
- FOUND: src/probe.ts
- FOUND: src/encode.ts
- FOUND: src/verify.ts
- FOUND: src/index.ts
- FOUND: .planning/phases/01-foundation/01-01-SUMMARY.md
- FOUND commit: 3259156 (Task 1)
- FOUND commit: 1e2c969 (Task 2)
- FOUND commit: 2db9b3c (package-lock)
