# Phase 1: Foundation - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Node.js ESM project scaffolding with all dependencies installed, the `errors.ts` typed error hierarchy, and the pure `bitrate.ts` calculator with full unit test coverage. No I/O, no FFmpeg invocation — just the project skeleton and proven math. All downstream phases depend on the constants and types defined here.

</domain>

<decisions>
## Implementation Decisions

### Language and Module Format
- TypeScript (not plain JS) — type safety is critical for the bitrate formula where a type mismatch is an 8x size error
- `"type": "module"` in package.json — ESM required because `execa` v9 and `ora` v9 are ESM-only
- `tsconfig.json` targeting Node.js 22 (`"target": "ES2022"`, `"module": "NodeNext"`)

### Project Structure
- One file per concern in `src/`: `bitrate.ts`, `probe.ts`, `encode.ts`, `verify.ts`, `errors.ts`, `index.ts`
- Phase 1 creates: `errors.ts`, `bitrate.ts`, and test file(s)
- Other `src/` files are stubs or do not yet exist

### FFmpeg Dependency Strategy
- `ffmpeg-static` as primary bundled binary (no system install required)
- `--ffmpeg-path <path>` CLI flag as escape hatch for users with a custom FFmpeg build
- Path resolution logic: check `--ffmpeg-path` first, then `ffmpeg-static`, then system PATH as last resort
- This logic lives in a `resolveFfmpegPath()` helper (stubbed in Phase 1, implemented in Phase 2)

### Size Constants
- All size constants use **binary MiB** (1 MiB = 1,048,576 bytes), NOT decimal MB
- `TARGET_CEILING_MIB = 9.8` — the hard output ceiling; tool exits non-zero if exceeded
- `TARGET_EFFECTIVE_MIB = 9.6` — what the bitrate formula targets (leaves headroom for MP4 container overhead)
- Every constant must have a comment explaining: binary MiB not decimal MB, and why there are two values
- Variables in `bitrate.ts` must carry unit suffixes: `targetSizeBytes`, `videoBitrateKbps`, `audioBitsTotal`, `durationSeconds`

### Bitrate Formula
- `videoBitrateKbps = Math.floor((targetSizeBytes * 8 - audioBitrateKbps * 1000 * durationSeconds) / durationSeconds / 1000)`
- All intermediate values in bits — never mix bytes and bits without explicit conversion
- The formula is a pure function: `calculateVideoBitrate(targetSizeBytes, durationSeconds, audioBitrateKbps) => number`
- Returns the bitrate in kbps as an integer (Math.floor)
- Must return a minimum of 1 kbps (guard against negative or zero for extreme edge cases)

### Error Hierarchy
- Typed classes extending a base `FfmpegToolError extends Error`
- Each error class has: `exitCode: number` property and a human-readable `message`
- Exit codes: 1 = general error, 2 = input validation, 3 = FFmpeg not found, 4 = encoding failed, 5 = output oversize
- Phase 1 creates the base class and initial error types; additional types added in later phases

### Test Framework
- Node.js built-in `node:test` with `node:assert` — zero extra dependencies
- Test file: `src/bitrate.test.ts` (or `test/bitrate.test.ts`)
- Tests cover: known-good inputs, edge cases (1-second video, very long video), minimum bitrate guard, units

### Claude's Discretion
- Exact `tsconfig.json` compiler options beyond the target/module settings
- npm script names (`test`, `build`, `start`, `dev`)
- Whether to use a `bin/` entry point or `src/index.ts` directly
- How stubs for future modules are structured (empty exports vs TODO comments)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project requirements
- `.planning/PROJECT.md` — Project vision, constraints, and key decisions
- `.planning/REQUIREMENTS.md` — FOUND-01 through FOUND-04 define the acceptance criteria for this phase

### Research findings
- `.planning/research/STACK.md` — Stack recommendations with versions (Node 22, ffmpeg-static 5.x, commander 14, execa 9, ora 9, cli-progress 3)
- `.planning/research/ARCHITECTURE.md` — Bitrate formula, component boundaries, build order, data types
- `.planning/research/PITFALLS.md` — Pitfall #2 (bits/bytes confusion) and Pitfall #9 (MiB vs MB) are directly relevant to this phase
- `.planning/research/SUMMARY.md` — Executive summary with Phase 1 roadmap implications

No external specs beyond the above — requirements are fully captured in decisions above and the research files.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — greenfield project, no existing code

### Established Patterns
- None yet — Phase 1 establishes the patterns all subsequent phases follow

### Integration Points
- `src/bitrate.ts` exports: `calculateVideoBitrate()` function and `TARGET_CEILING_MIB`, `TARGET_EFFECTIVE_MIB` constants
- `src/errors.ts` exports: `FfmpegToolError` base class and typed error subclasses with exit codes
- These two modules are the foundation that Phase 2 (probe.ts) and Phase 3 (encode.ts) import from

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for project scaffolding and test structure.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 01-foundation*
*Context gathered: 2026-03-25*
