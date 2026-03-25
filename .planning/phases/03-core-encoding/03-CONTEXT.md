# Phase 3: Core Encoding - Context

**Gathered:** 2026-03-25
**Status:** Ready for planning (retro-filled after implementation)
**Mode:** Auto-generated — roadmap goal + codebase conventions

<domain>
## Phase Boundary

Two-pass H.264 + AAC encoding to TARGET_EFFECTIVE_BYTES, hard ceiling check, unique temp passlogs, terminal feedback (spinner + progress), minimal runnable CLI.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
- `execa` with `cancelSignal` for VER-02; `ora` for pass 1 spinner and pass 2 text updates
- Progress via stderr `time=` parsing
- `ffmpegInstallMessage` exported from probe for missing bundled ffmpeg

</decisions>

<code_context>
## Existing Code Insights

- probeVideo, calculateVideoBitrate, resolveFfmpegPath, TARGET_* constants
- errors: EncodingFailedError, OutputOversizeError

</code_context>

<specifics>
## Specific Ideas

None beyond ROADMAP success criteria.

</specifics>

<deferred>
## Deferred Ideas

Full CLI flags and help deferred to Phase 4.

</deferred>
