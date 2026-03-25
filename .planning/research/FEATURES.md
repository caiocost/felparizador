# Feature Research

**Domain:** Video compression CLI tool — size-targeted output for Discord's 10MB upload limit
**Researched:** 2026-03-25
**Confidence:** HIGH (cross-verified with multiple existing tools in this exact niche)

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Accept any common video format as input | Users don't know what container their file uses; rejecting it is a failure | LOW | FFmpeg handles this natively — MP4, MKV, MOV, AVI, WebM, FLV, WMV all work without special handling |
| Output an MP4 at or under the target size | This is the entire product; missing the size means the video won't send on Discord | MEDIUM | Two-pass encoding is the standard approach; single-pass CRF cannot guarantee a target size |
| Guarantee the output actually fits | Users will be angry if the tool produces 10.1MB and Discord rejects it | MEDIUM | Use 9.8MB as the internal ceiling; the bitrate math must account for container overhead |
| Keep audio by default | Removing audio without asking is considered broken behavior | LOW | Reduce audio bitrate (96kbps AAC is sufficient) rather than strip it; audio bitrate must be subtracted from the budget |
| Clear error messages | Users don't know FFmpeg; a raw FFmpeg error means nothing to them | LOW | Translate common failures: file not found, unsupported format, corrupt file, FFmpeg not installed |
| Show progress during encoding | Two-pass encoding on a long video can take minutes; silence looks like a hang | MEDIUM | Parse FFmpeg stderr output (time=, speed=, bitrate= tokens) to display a progress indicator |
| Output path control | Users need to control where the file lands; defaulting to cwd is expected | LOW | Default: input filename + `_discord.mp4` in same directory; `--output` flag to override |
| Overwrite protection | Silently overwriting a previous output is destructive and unexpected | LOW | Check if output file exists before encoding; prompt or error, not silent overwrite |
| Cross-platform support | Tool audience is Windows/macOS/Linux Discord users | MEDIUM | Must run on all three; FFmpeg binary lookup must handle PATH on each platform |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Human-readable quality report after encoding | Tell the user "your 3min video compressed from 450MB to 9.8MB at 360kbps video bitrate" — builds trust | LOW | Capture ffprobe output on the result; format nicely |
| Warn when quality will be unacceptably low before encoding | A 20-minute video at 9.8MB = ~65kbps video — barely watchable. Warn the user so they can trim first | MEDIUM | Calculate projected bitrate during the probe phase; emit a warning below a defined threshold (e.g., <200kbps video) |
| Automatic resolution downscale when bitrate is very low | If projected bitrate is too low for the source resolution, scale down to recover visual quality | MEDIUM | Scale 1080p→720p→480p as bitrate budget shrinks; ffmpeg scale filter; requires threshold table |
| Custom target size flag | Some users know 8MB works better for their recipient's client; let them specify | LOW | `--target 8` flag; validate range (1–9.8); default remains 9.8 |
| `--no-audio` flag | Power users sometimes want silent clips; smaller file means more video quality | LOW | `ffmpeg -an`; trivial to add once audio handling is in place |
| Configurable audio bitrate | Users who don't care about audio can lower it to reclaim video budget; audiophiles can raise it | LOW | `--audio-bitrate` flag in kbps; default 96; validate reasonable range |
| Dry-run / estimate mode | Show what the output would look like (bitrate, expected quality) without actually encoding | MEDIUM | Run ffprobe + bitrate math only; no ffmpeg encode; useful for long videos before committing |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Batch processing | "Can I compress a whole folder?" is a natural ask | Multiplies error surface significantly; silent failures hide in a batch; progress display gets complex; one corrupt file stalls the queue | Document that a shell loop (`for f in *.mp4; do tool "$f"; done`) achieves this; keep v1 single-file |
| GUI / desktop app | Easier for non-technical users | Requires an entirely different delivery mechanism (Electron, Tauri), platform-specific installers, and maintenance burden completely separate from the core encoding logic | Keep CLI; consider a web wrapper in a later version if user research shows demand |
| Codec selection (H.265, AV1, VP9) | Better compression = better quality at same size | AV1 and H.265 have playback compatibility issues on Discord; Discord embeds and plays H.264 MP4 reliably; multi-codec adds complexity with no guarantee of a better Discord experience | Lock to H.264 (libx264) + AAC for v1; revisit if Discord's player support improves |
| Cloud upload to Discord directly | "One command to share" sounds great | Requires Discord API credentials, OAuth flow, bot setup, or user token handling (ToS risk); adds a network-failure failure mode with no recovery story | Output the file; user drags it to Discord — this is one extra step that is not worth the complexity |
| Trimming / editing | Compression tool users notice they can fix a 20-min video by trimming first | Opens a much larger feature surface (start/end times, cuts, multiple clips); distracts from the core guarantee | Document: trim with another tool first, then compress with this one |
| Subtitle preservation | Some users have embedded subtitles | Subtitle muxing with two-pass encoding has edge cases with container overhead; not relevant to Discord sharing | Strip subtitles in the MP4 output — Discord does not render embedded subtitles |
| Hardware acceleration (NVENC, QuickSync) | Faster encoding | Hardware encoders produce larger files at equivalent quality settings, making the size target harder to hit precisely; two-pass with hardware encoders has compatibility gaps across GPU generations | Use libx264 (CPU) for predictable, accurate bitrate targeting |

## Feature Dependencies

```
[Input validation (ffprobe probe)]
    └──requires──> [FFmpeg / ffprobe available on PATH]
    └──enables──>  [Quality warning (low bitrate)]
    └──enables──>  [Dry-run mode]

[Two-pass encoding]
    └──requires──> [Input validation (duration needed for bitrate math)]
    └──requires──> [FFmpeg available]
    └──enables──>  [Guaranteed size output]

[Guaranteed size output]
    └──enables──>  [Output quality report]

[Audio bitrate control]
    └──enhances──> [Two-pass encoding] (audio budget subtracted from total)

[Automatic resolution downscale]
    └──requires──> [Input validation (source resolution needed)]
    └──requires──> [Quality warning threshold logic]

[Progress display]
    └──requires──> [Two-pass encoding] (stderr parsing during encode)

[Custom target size]
    └──enhances──> [Two-pass encoding] (changes the bitrate calculation input)
```

### Dependency Notes

- **Input validation requires ffprobe:** Duration (for bitrate math), resolution (for downscale decisions), and codec info must be extracted before any encoding starts. ffprobe ships with FFmpeg.
- **Two-pass encoding requires duration:** The formula `video_bitrate = (target_bytes * 8 - audio_bits) / duration_seconds` cannot run without knowing duration. This makes ffprobe the mandatory first step.
- **Audio bitrate control enhances two-pass encoding:** The audio bitrate is subtracted from the total budget before the video bitrate is calculated. Configuring audio bitrate changes the available video budget.
- **Automatic resolution downscale conflicts with fixed-resolution use cases:** If a user specifies a custom output resolution (future feature), the auto-downscale logic must be bypassed. These two features need a clear priority ordering.

## MVP Definition

### Launch With (v1)

Minimum viable product — what's needed to validate the concept.

- [ ] FFmpeg / ffprobe availability check on startup — clear error if missing
- [ ] Input file validation: exists, is readable, is a recognizable video format
- [ ] ffprobe probe: extract duration and stream info before encoding
- [ ] Two-pass H.264 encoding to 9.8MB ceiling (libx264 + AAC)
- [ ] Audio kept at 96kbps by default; `--no-audio` flag to strip
- [ ] Output file: `<input_stem>_discord.mp4` in same directory as input; `--output` flag to override
- [ ] Overwrite protection: error if output file already exists (with hint to use `--output` or delete first)
- [ ] Progress display during both encoding passes (parse FFmpeg stderr)
- [ ] Human-readable error messages for all common failure cases
- [ ] Post-encode quality report: original size, output size, duration, video bitrate achieved

### Add After Validation (v1.x)

Features to add once core is working.

- [ ] Quality warning when projected video bitrate is below a threshold — add when user feedback confirms this is a pain point
- [ ] `--target <MB>` custom size flag — add when users report needing 8MB target for older Discord clients
- [ ] `--audio-bitrate <kbps>` flag — add when users want to trade audio quality for video quality
- [ ] Dry-run / estimate mode — add when users report wanting to preview quality before committing to a long encode

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] Automatic resolution downscale — requires tuning the threshold table and is complex to test; defer until quality warnings are validated as useful
- [ ] Batch processing — single-file focus is the core constraint for v1; defer until CLI loops prove insufficient
- [ ] H.265 / AV1 output option — defer until Discord's embed player reliably plays these; currently risky for user experience

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Two-pass encoding to size target | HIGH | MEDIUM | P1 |
| FFmpeg availability check + clear error | HIGH | LOW | P1 |
| Input file validation | HIGH | LOW | P1 |
| Progress display | HIGH | MEDIUM | P1 |
| Keep audio at reduced bitrate | HIGH | LOW | P1 |
| Output path control + overwrite protection | HIGH | LOW | P1 |
| Post-encode quality report | MEDIUM | LOW | P1 |
| Human-readable error messages | HIGH | LOW | P1 |
| Quality warning (low projected bitrate) | HIGH | LOW | P2 |
| Custom target size flag | MEDIUM | LOW | P2 |
| `--no-audio` flag | MEDIUM | LOW | P2 |
| Audio bitrate flag | MEDIUM | LOW | P2 |
| Dry-run / estimate mode | MEDIUM | MEDIUM | P2 |
| Automatic resolution downscale | MEDIUM | HIGH | P3 |
| Batch processing | LOW | HIGH | P3 |
| H.265 / AV1 output | LOW | MEDIUM | P3 |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

## Competitor Feature Analysis

Tools researched: `ffmpeg4discord` (zfleeman), `8mb` (matthewbaggett), `CLI-Video-Compressor` (ivansaul), `Atem` (nevinpuri), `DVC` (KickerMix)

| Feature | ffmpeg4discord | 8mb script | CLI-Video-Compressor | Our Approach |
|---------|--------------|--------------|---------------------|--------------|
| Size targeting | Yes (--target-filesize) | Yes (iterative) | No (quality %, not size) | Yes (9.8MB default, configurable) |
| Two-pass encoding | Yes | No (iterative re-encode) | No | Yes — two-pass is more accurate than iteration |
| Progress display | Minimal (verbose flag) | Per-iteration output | Not documented | Real-time progress bar parsing FFmpeg stderr |
| Quality warning | No | No | No | Yes (projected bitrate check before encoding) |
| Audio control | Yes (--no-audio, --audio-br) | Not mentioned | No | Yes (default 96kbps, --no-audio flag) |
| Output naming | Yes (--output) | Not documented | Yes (auto-suffix) | Yes (auto-suffix + --output flag) |
| Overwrite protection | Not documented | Not documented | --overwrite flag | Default-protect, explicit flag to allow overwrite |
| Post-encode report | No | Yes (per iteration) | No | Yes (clean summary after encode) |
| Codec options | 6 profiles | Not documented | h264 / h265 | H.264 only for v1 (Discord compatibility) |
| Cross-platform | Yes (Python) | Bash + Python + Docker | Yes (Python) | Yes (Node.js or Python) |

## Sources

- [ffmpeg4discord GitHub — Python two-pass Discord compressor](https://github.com/zfleeman/ffmpeg4discord)
- [8mb GitHub — iterative bash/Python compression script](https://github.com/matthewbaggett/8mb)
- [CLI-Video-Compressor GitHub — general-purpose CLI compressor](https://github.com/ivansaul/CLI-Video-Compressor)
- [9 Best Video Compressors for Discord — videoproc.com](https://www.videoproc.com/video-editor/video-compressor-for-discord.htm)
- [Video Compressor for Discord: 9 Options in 2025 — videocandy.com](https://videocandy.com/blog/video-compressor-for-discord.html)
- [CLI UX best practices: progress displays — Evil Martians](https://evilmartians.com/chronicles/cli-ux-best-practices-3-patterns-for-improving-progress-displays)
- [FFmpeg two-pass encoding guide — VideoHelp Forum](https://forum.videohelp.com/threads/383629-ffmpeg-how-to-encode-target-size-and-2passes)
- [FFprobe documentation — ffmpeg.org](https://ffmpeg.org/ffprobe.html)
- [Discord Video Upload Quality Settings FAQ — Discord Support](https://support.discord.com/hc/en-us/articles/9665451164951-Video-Upload-Quality-Settings-on-Mobile-FAQ)

---
*Feature research for: Video compression CLI targeting Discord's 10MB limit*
*Researched: 2026-03-25*
