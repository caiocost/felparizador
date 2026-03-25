# Milestones

## v1.0 v1.0 (Shipped: 2026-03-25)

**Phases completed:** 4 phases, 5 plans, 3 tasks

**Key accomplishments:**

- Node.js 22 ESM TypeScript project with ffmpeg-static binary, binary MiB bitrate calculator, typed error hierarchy (exit codes 2-5), and stub modules for all future phases
- 13 passing unit tests verifying the bitrate formula against known-good values, edge cases, minimum guard, and binary MiB constants using node:test built-in runner
- Implemented ffprobe-based probeVideo(), extended ProbeResult, execa dependency, and integration tests with generated MP4 fixtures.

---
