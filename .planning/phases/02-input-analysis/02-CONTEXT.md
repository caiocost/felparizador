# Phase 2: Input Analysis - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning

<domain>
## Phase Boundary

FFmpeg availability check, input file validation, and ffprobe probe — catching every preventable failure before encoding starts and giving the user actionable information. No encoding occurs in this phase; it ends with a probe result handed off to the encoder.

</domain>

<decisions>
## Implementation Decisions

### FFmpeg Error UX
- Show full install instructions when FFmpeg is missing (not just a raw error) — users need actionable help
- Check `ffmpeg-static` first, then system PATH as fallback — consistent with Phase 1 `resolveFfmpegPath()` stub
- Error format: `Error: FFmpeg not found.\n\nTo fix: [install instructions with npm note + direct download link]`
- Exit code 3 (`FfmpegNotFoundError`) — already defined in `errors.ts`

### Quality Warning Behavior
- Warn below 50 kbps projected video bitrate — warn and continue (do not abort)
- Show projected bitrate before encoding starts, alongside probe results
- Short videos (<5s): warn and continue with standard ABR — no special handling in Phase 2
- Very long videos (>25 min): warn that quality will be poor — continue encoding

### Probe Output Display
- Always show probe results before encoding starts (not gated behind --verbose)
- Show: duration, resolution, original file size — clean table format, not raw JSON
- Format as a readable table (e.g., `Duration: 1m 23s | Resolution: 1920×1080 | Size: 245 MB`)
- `--quiet` flag to suppress probe display is Claude's discretion to implement

### Claude's Discretion
- Exact `--quiet` flag implementation and whether to add it in Phase 2 or Phase 4
- Exact wording of install instructions for each platform (macOS/Linux/Windows)
- Whether to use `ora` spinner during the ffprobe call (short enough to be instant)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project requirements
- `.planning/PROJECT.md` — Core value and constraints
- `.planning/REQUIREMENTS.md` — INPUT-01 through INPUT-05 define the acceptance criteria

### Research findings
- `.planning/research/ARCHITECTURE.md` — ffprobe JSON structure (`format.duration`, stream-level fallback), component boundaries
- `.planning/research/PITFALLS.md` — Pitfall #6 (FFmpeg not found poor UX), Pitfall #3 (duration probe inaccuracy), Pitfall #8 (very long video quality)
- `.planning/research/SUMMARY.md` — Phase 2 roadmap implications

### Phase 1 foundation
- `.planning/phases/01-foundation/01-CONTEXT.md` — FFmpeg path resolution strategy (`resolveFfmpegPath()` stub), error hierarchy with exit codes

No external specs beyond the above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/errors.ts` — `FfmpegNotFoundError` (exit 3), `InputValidationError` (exit 2) already defined; use these
- `src/bitrate.ts` — `calculateVideoBitrate()` and `TARGET_EFFECTIVE_BYTES` used in quality warning math
- `src/probe.ts` — stub exists with `ProbeResult` type defined; this phase implements the stub

### Established Patterns
- ESM imports with `.js` extension — established in Phase 1, must continue
- `execa` for subprocess calls — already installed, use for ffprobe invocation
- `node:assert/strict` for tests — pattern from Phase 1 unit tests

### Integration Points
- `src/probe.ts::probeVideo()` — implements the stub; returns `ProbeResult` consumed by `src/encode.ts` (Phase 3)
- `src/index.ts` — will call `resolveFfmpegPath()` then `probeVideo()` in sequence (Phase 4 wiring, but probe must export correctly now)

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches for probe display formatting and ffprobe subprocess handling.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 02-input-analysis*
*Context gathered: 2026-03-25*
