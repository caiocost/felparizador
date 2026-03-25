# ffmpeg10mb

## What This Is

A CLI tool that compresses any video — regardless of size, length, or resolution — into an MP4 file of exactly 9.8MB using FFmpeg. Built specifically to fit within Discord's 10MB free-tier file upload limit, letting users share any video on Discord without needing Nitro.

## Core Value

Any video in, 9.8MB MP4 out — guaranteed to be sendable on Discord.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Accept any video file as input regardless of size, resolution, or format
- [ ] Output a single MP4 file of ≤9.8MB
- [ ] Use FFmpeg for encoding (two-pass bitrate targeting)
- [ ] Preserve as much visual quality as possible within the size constraint
- [ ] Simple CLI interface: input path, optional output path
- [ ] Cross-platform support (Windows, macOS, Linux)

### Out of Scope

- GUI / web interface — CLI is sufficient for v1
- Batch processing — single file focus for v1
- Audio-only stripping by default — audio should be kept (reduced bitrate)
- Cloud upload to Discord — tool outputs the file, user uploads manually

## Context

- FFmpeg must be installed on the user's system (or bundled)
- Two-pass encoding is the standard approach to hit exact file size targets
- Target bitrate = (target_size_bits - audio_bits) / duration_seconds
- Discord's free upload limit is 10MB; 9.8MB leaves ~200KB safety margin
- Project lives at D:/GitHub/ffmpeg10mb

## Constraints

- **Tech stack**: FFmpeg (external dependency or bundled binary)
- **Output size**: Must be ≤9.8MB — this is the core invariant
- **Format**: Output must be MP4 (H.264 video + AAC audio) for maximum Discord compatibility
- **Runtime**: Node.js or Python CLI (to be decided during planning)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| 9.8MB target (not 10MB) | Leave ~200KB safety margin for Discord's byte-level check | — Pending |
| Two-pass FFmpeg encoding | Industry standard for accurate file size targeting | — Pending |
| CLI-first interface | Simplest delivery, no dependencies beyond FFmpeg | — Pending |

---
*Last updated: 2026-03-25 after initialization*
