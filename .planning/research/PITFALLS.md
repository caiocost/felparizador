# Pitfalls Research

**Domain:** FFmpeg two-pass video compression CLI targeting exact file sizes (Discord 10MB limit)
**Researched:** 2026-03-25
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: Target Size Calculation Ignores Container Overhead

**What goes wrong:**
The bitrate formula `(target_size_bytes * 8 - audio_bits) / duration_seconds` computes the raw stream bitrate, but the resulting MP4 file is always larger than the sum of its streams. The MP4 container adds a `moov` atom (metadata: frame offsets, timing, codec info) plus a `mdat` atom header, which together typically add 10–100KB for short videos and grow proportionally for long ones. For very low-bitrate encodes (under ~1 Mbps), container overhead can exceed 10% of the target size. The output file overshoots the target.

**Why it happens:**
Developers calculate video bitrate as if the file bytes equal stream bytes. FFmpeg's own documentation and most tutorial formulas omit the container overhead because it is a small percentage at high bitrates and becomes significant only at low bitrates — exactly the regime this tool operates in.

**How to avoid:**
Apply a conservative overhead deduction (200–500KB is a reasonable empirical constant for H.264/AAC MP4 files targeting ~10MB) before computing video bitrate. The project already uses 9.8MB as the target (leaving ~200KB below Discord's 10MB), which partially addresses this, but the bitrate calculation must use a further-reduced effective target — something like 9.6MB — to leave room for actual moov atom overhead. Verify final file size programmatically after encoding and log a warning if it exceeds 9.8MB.

**Warning signs:**
- Output file is consistently 50–150KB larger than the configured target
- Discrepancy grows with video duration
- Very low-bitrate encodes (long videos) show the worst overshoot

**Phase to address:**
Core encoding logic phase — the bitrate calculation must embed this constant from day one.

---

### Pitfall 2: Audio Bitrate Not Subtracted Before Computing Video Bitrate

**What goes wrong:**
The video bitrate target is computed from the full file size budget without subtracting the audio stream's size. The encoder is told to use more bits than are available after audio, so the total file overshoots the target.

**Why it happens:**
The standard formula is: `video_bitrate = (target_bytes * 8 - audio_bitrate * duration) / duration`. Developers who skip the subtraction step produce a video bitrate equal to the full budget, leaving no room for audio. With AAC audio at 128kbps on a 60-second video, the audio stream alone consumes ~960KB — nearly 10% of a 10MB budget.

**How to avoid:**
Always compute: `video_bitrate_kbps = ((target_bytes * 8) / duration_seconds / 1000) - audio_bitrate_kbps`. Choose a fixed, low audio bitrate (64–96kbps AAC for general content, 32kbps for voice-only) and hold it constant so the video bitrate calculation is deterministic. Document the audio bitrate as a named constant, not a magic number.

**Warning signs:**
- Final file size is consistently larger than target by approximately `audio_bitrate * duration / 8` bytes
- The calculated video bitrate equals the total target bitrate (no audio deduction visible in code)

**Phase to address:**
Core encoding logic phase — part of the foundational bitrate formula.

---

### Pitfall 3: Duration Probe Inaccuracy Causes Bitrate Miscalculation

**What goes wrong:**
`ffprobe` reports an inaccurate duration for certain input files — particularly variable frame rate (VFR) content, screen recordings, files with corrupted headers, and some container formats. If the probed duration is longer than the actual encoded duration, the calculated bitrate is set too low and the file undershoots the size target (poor quality). If the probed duration is shorter, the bitrate is too high and the file overshoots.

**Why it happens:**
Some containers store duration in the container header (which may be wrong) while stream-level duration is correct, or vice versa. VFR files do not have a fixed frame interval, so frame-count-based estimation disagrees with timestamp-based measurement. FFprobe defaults may read only the header without scanning the full stream.

**How to avoid:**
Use `ffprobe -v error -show_entries format=duration -of csv=p=0 -i <file>` to get the container-level duration, which is generally reliable for common formats. For robustness, also read stream-level duration and take the maximum. After encoding, check the actual output duration to confirm alignment. Add a warning if probed duration differs from encoded duration by more than 1%.

**Warning signs:**
- Very short videos that are "known good" produce files significantly different from the target size
- Output quality is unexpectedly high or low compared to what the bitrate should produce
- Screen recordings and GIF-converted files are most prone to this

**Phase to address:**
Input analysis phase — validate duration before feeding it into the bitrate formula.

---

### Pitfall 4: Two-Pass Log File Left Behind / Path Collision

**What goes wrong:**
FFmpeg's first pass writes a passlog file (default prefix: `ffmpeg2pass`) to the current working directory. If the tool is invoked multiple times concurrently, or if a previous run was interrupted, the stale log file from a prior run may be used by the second pass, producing an incorrect encode. Additionally, if the tool is run from a directory where it lacks write permissions (e.g., `C:\Program Files\`), the first pass silently fails or errors, and the second pass runs without log data, degrading to single-pass quality.

**Why it happens:**
FFmpeg's default passlogfile location is the current working directory. Tools that invoke FFmpeg as a subprocess inherit the CWD of the calling process, which may be read-only or shared. The `-passlogfile` option exists specifically to redirect log files but is often omitted.

**How to avoid:**
Always pass `-passlogfile <tmpdir>/ffmpeg2pass-<uuid>` using a temp directory (OS temp via `os.tmpdir()` in Node or `tempfile.gettempdir()` in Python) with a unique prefix per invocation. Clean up all `<prefix>-*.log` files in a `finally` block regardless of whether encoding succeeded or failed. Never assume write permission to the directory containing the input file or the tool's installation directory.

**Warning signs:**
- First pass exits quickly without apparent progress (failed silently)
- Second pass output quality is worse than expected (running as single-pass)
- Multiple simultaneous invocations produce corrupted outputs

**Phase to address:**
Core encoding logic phase — implement `-passlogfile` with temp dir and cleanup from the start.

---

### Pitfall 5: Windows Path Spaces Break FFmpeg Subprocess Invocation

**What goes wrong:**
On Windows, paths containing spaces (e.g., `C:\Users\John Doe\Videos\my clip.mp4`) cause FFmpeg subprocess calls to fail with cryptic errors if the path is not properly quoted. The subprocess module in both Node.js and Python has differences in how arguments are tokenized on Windows vs. Unix, and naive string concatenation into a shell command breaks on the first space.

**Why it happens:**
On Unix, spawning a process with an array of arguments bypasses the shell entirely and spaces in arguments are safe. On Windows, the subprocess must pass through `cmd.exe` in some invocation modes, which requires proper quoting. Developers test on paths without spaces and never encounter the issue.

**How to avoid:**
Always spawn FFmpeg using the array form (not shell string): `spawn('ffmpeg', ['-i', inputPath, ...])` rather than `exec('ffmpeg -i ' + inputPath)`. This bypasses the shell on all platforms and eliminates quoting issues. Never construct a shell string with user-supplied paths. The `-passlogfile` path must also be passed as a discrete array argument, not embedded in a shell string.

**Warning signs:**
- Works on developer machine but fails for users whose usernames or video folder names contain spaces
- Error message references unexpected file names (truncated at the space)
- Windows-specific failure mode — tests on macOS/Linux all pass

**Phase to address:**
CLI interface and subprocess invocation phase — verify array-form spawn from the first line of FFmpeg integration.

---

### Pitfall 6: FFmpeg Not Found — Poor Error Message Kills UX

**What goes wrong:**
When FFmpeg is not installed or not on the system PATH, the subprocess call throws a low-level OS error (ENOENT on Unix, WinError 2 on Windows). The raw error message — `spawn ffmpeg ENOENT` — is meaningless to a non-technical user. The tool appears broken rather than providing actionable guidance.

**Why it happens:**
Most subprocess wrappers propagate the OS error directly. Developers who have FFmpeg installed never see this error path during development.

**How to avoid:**
Before attempting any encode, probe for FFmpeg by running `ffmpeg -version` and catching the ENOENT error explicitly. On failure, print a human-readable message with installation instructions for the user's detected platform (Windows: winget/choco/direct download; macOS: `brew install ffmpeg`; Linux: `apt install ffmpeg` or distro equivalent). Exit with a non-zero status code. This probe adds negligible latency (< 100ms) and prevents confusing failures.

**Warning signs:**
- CI/CD passes but end users on clean machines report opaque errors
- Error message contains words like "ENOENT", "WinError 2", or "spawn"
- Windows users report failure even when they have installed FFmpeg (PATH not updated — check `where ffmpeg` vs. fresh shell)

**Phase to address:**
CLI interface phase — implement the FFmpeg probe as the very first check before any other logic runs.

---

### Pitfall 7: Very Short Videos (Under ~5 Seconds) Produce Oversized Output

**What goes wrong:**
For a 2-second video targeting 9.8MB, the computed video bitrate would be approximately `(9.8 * 1024 * 1024 * 8 - 128000 * 2) / 2 ≈ 40 Mbps`. At extremely high bitrates, x264's VBV constraints, minimum quantizer floors, and I-frame sizing mean the encoder cannot reliably hit an average bitrate this high using two-pass ABR. The output may undershoot the bitrate (good for size but the video is tiny anyway) or overshoot it unexpectedly.

**Why it happens:**
Two-pass ABR is designed for files where duration gives the encoder a meaningful bitrate distribution problem to solve. At under ~5 seconds, there is insufficient content for the two-pass analysis to be useful, and codec-level constraints dominate. Additionally, a single IDR (keyframe) for a 2-second video can be several MB on its own.

**How to avoid:**
Detect very short videos (< 5 seconds) and special-case them: use CRF mode (e.g., `-crf 18`) instead of ABR targeting, since the output will be small regardless and quality preservation is the correct goal. Alternatively, compute the effective bitrate and clamp it to a maximum (e.g., 50 Mbps) to prevent absurd targets, then verify the resulting file size post-encode. Log a warning to the user that short videos are encoded at high quality rather than size-targeted.

**Warning signs:**
- Test videos under 5 seconds produce files far from the 9.8MB target (either direction)
- FFmpeg log shows warnings about VBV or quantizer limits
- Very high computed bitrate in the bitrate formula output

**Phase to address:**
Core encoding logic phase — add duration-based branching with explicit handling for short content.

---

### Pitfall 8: Very Long Videos Produce Unacceptably Low Quality

**What goes wrong:**
For a 3-hour (10800-second) video targeting 9.8MB, the available video bitrate is approximately `(9.8 * 1024 * 1024 * 8 - 96000 * 10800) / 10800 ≈ 7.5 kbps`. At this bitrate, x264 cannot produce a watchable video at any standard resolution — the minimum meaningful video bitrate for 1080p is around 200 kbps and for the lowest meaningful resolution (144p) is around 50 kbps. The encoder may produce a technically valid file that is unwatchable, or may silently fail to honor the bitrate target.

**Why it happens:**
The bitrate formula has no floor. Users do not anticipate that compressing a feature film to 10MB means approximately 1 frame of video data per second at 144p.

**How to avoid:**
Calculate the video bitrate first, then if it falls below a meaningful threshold (e.g., 30 kbps), warn the user that the requested compression is extreme and output quality will be very poor. Consider making this a soft error that requires explicit acknowledgment. Document the maximum practical duration for acceptable quality (roughly: `max_seconds = target_bytes * 8 / (min_quality_bitrate + audio_bitrate)`). For a 9.8MB target at a 50kbps floor, that is about 1500 seconds (25 minutes) of reasonable compression.

**Warning signs:**
- Calculated video bitrate below 50 kbps
- Resolution scaling logic reduced output to 240p or below
- User complaints that output is unwatchable

**Phase to address:**
Input validation phase — warn before encoding, not after.

---

### Pitfall 9: Discord's 10MB Limit May Be Binary (10 MiB = 10,485,760 bytes) Not Decimal

**What goes wrong:**
Discord says "10MB" but the actual enforcement threshold may be 10 mebibytes (10 * 1024 * 1024 = 10,485,760 bytes) rather than 10 megabytes (10,000,000 bytes). If the tool targets 9.8 decimal MB (9,800,000 bytes) but Discord enforces 10 binary MiB, the tool is being unnecessarily conservative by ~480KB. More critically, if the tool targets 9.8 MiB (10,276,044 bytes) but Discord enforces 10 decimal MB, files close to that target will be rejected.

**Why it happens:**
"MB" is ambiguous in consumer software; Discord's documentation does not specify which unit is used at the API level. Most consumer software displays binary sizes using "MB" labels, suggesting the actual threshold is 10,485,760 bytes.

**How to avoid:**
Target 9.8 MiB (10,276,044 bytes, i.e., `9.8 * 1024 * 1024`) as the ceiling. This is the safer assumption because: (a) most upload systems use binary internally, and (b) 9.8 MiB leaves ~200KB headroom below 10 MiB while still being generous. Do not change the target to decimal MB without empirical verification. Test file uploads near the target size to confirm rejection behavior. The existing 9.8MB design note should be clarified to specify which MB convention is used.

**Warning signs:**
- Files right around 10MB are sometimes accepted and sometimes rejected by Discord
- The "MB" vs. "MiB" distinction is not captured in any constant or comment in the codebase

**Phase to address:**
Design and constants definition phase — specify the exact byte target as a named constant with a comment explaining the unit choice.

---

### Pitfall 10: High-Resolution Square or Static-Image Videos Cause Encoder Bitrate Overshoot

**What goes wrong:**
FFmpeg with x264 is known to significantly overshoot the target bitrate for videos that are high-resolution, square aspect ratio, and contain minimal motion (e.g., YouTube music videos with static album art). In such cases the encoder overshoots the bitrate "by a huge margin," producing files well above the target size. This is a documented FFmpeg/x264 behavior.

**Why it happens:**
At very high resolutions with low motion, the encoder's two-pass rate control model is misled by the first-pass analysis. The I-frames for a high-resolution static frame are very large, and rate control may not adequately constrain individual frame sizes.

**How to avoid:**
Implement an automatic resolution downscaling step based on the computed video bitrate. A common heuristic: if the computed bitrate is under 1 Mbps, scale down to 480p; under 500 kbps, scale to 360p. The `scale` filter should be applied before the bitrate target is set. The `-down` workaround from similar tools (scale to a fixed width like 512 pixels for problematic content) provides a model for this. After encoding, always verify the output file size and re-encode at lower resolution if it exceeds the target.

**Warning signs:**
- Input is square or nearly square (1:1 aspect ratio)
- Input has very few scene changes (static content, slideshows)
- First pass completes but output from second pass significantly exceeds target

**Phase to address:**
Core encoding logic phase — implement adaptive resolution scaling alongside bitrate targeting.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcode audio bitrate at 128kbps | Simple code | Wastes audio budget on long videos; overshoot for long content | Never — use a sensible default of 64–96kbps with a flag to override |
| Use shell string instead of argv array for subprocess | Slightly simpler code | Breaks on any path with spaces; platform-specific quoting bugs | Never |
| Skip post-encode size verification | Faster implementation | Silent failures — tool claims success on files Discord will reject | Never |
| Use decimal MB everywhere | Intuitive | May produce files rejected by Discord's binary MiB threshold | Never — pick one unit and document it |
| Omit `-passlogfile` option | Less code | Log file pollution; concurrent execution produces corrupt encodes | Never |
| Skip short/long video duration checks | Simpler code | Tool produces clearly broken output for edge case durations | Acceptable in prototype, must be fixed before release |
| Delete temp files only on success | Easier code | Log files accumulate across failed runs; fills disk | Never |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| FFmpeg subprocess | Concatenating path into shell string: `exec('ffmpeg -i ' + path)` | Use array argv spawn: `spawn('ffmpeg', ['-i', path, ...])` |
| FFmpeg subprocess | Not handling ENOENT separately from encode errors | Catch ENOENT specifically, emit "FFmpeg not found" error with install instructions |
| ffprobe duration | Reading only `stream.duration`, ignoring container `format.duration` | Read both; use `format.duration` as primary, fall back to stream duration |
| passlogfile | Letting it default to CWD | Always set `-passlogfile` to `<tmpdir>/<uuid>-ffmpeg2pass` |
| Temp file cleanup | Only cleaning up on success | Clean up in a `finally` block unconditionally |
| Windows PATH | Assuming PATH set in system env is visible to subprocess | On Windows, PATH updates from installers require a new shell; check `where ffmpeg` in the spawned environment |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Encoding in-process memory | N/A — FFmpeg is always an external subprocess | Enforce subprocess model; never attempt in-process video processing | Immediate if attempted |
| No progress reporting | Users see no output for minutes and kill the process, leaving temp files and partial output | Pipe FFmpeg's stderr and parse progress lines (`frame=`, `time=`, `speed=`) | First time a user encodes anything over 30 seconds |
| Synchronous subprocess blocking event loop (Node.js) | CLI freezes; no Ctrl+C handling | Use async subprocess with proper signal forwarding | Any video over a few seconds |
| Re-encoding if output already exists and is correct size | Unnecessary re-encoding on reruns | Check if output exists and is the right size before encoding | Low impact but wasteful |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Passing unsanitized user-provided paths to a shell string | Path traversal / command injection via filenames like `; rm -rf ~` | Always use argv array form; never construct shell commands from user input |
| Writing passlog file to the input file's directory | May fail silently on read-only media; writes to unexpected locations | Always use OS temp directory for passlog files |
| No validation that input file exists before invoking FFmpeg | FFmpeg error message leaks internal path details | Explicitly check file existence before subprocess invocation |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent progress (no output during encode) | Users believe the tool has crashed; kill it prematurely | Parse FFmpeg's stderr `time=` output and print progress percentage |
| Cryptic FFmpeg error messages passed through raw | User sees incomprehensible codec error strings | Wrap common error patterns with plain-language explanations |
| No warning before extremely lossy encode (long video) | User waits 10 minutes for an unwatchable file | Compute expected quality before encoding; warn if bitrate < 50kbps |
| Overwriting input file if output path not specified | Data loss — user's original video is gone | Default output to `<input_name>_compressed.mp4` in the same directory; never write to input path |
| No final file size reported | User must manually check if the file will upload | Always print: "Output: <path> (<size in MB>) — ready to upload to Discord" |
| Exit 0 even when output is oversized | User uploads and gets rejected by Discord | Exit non-zero and print an explicit error if output exceeds 9.8MB (or configured target) |

## "Looks Done But Isn't" Checklist

- [ ] **Bitrate formula:** Verify the calculation subtracts audio budget AND applies a container overhead deduction — check that the constant used is documented with units
- [ ] **File size verification:** Confirm the code reads the actual output file size after encode and fails loudly if it exceeds the target, rather than trusting the bitrate calculation was perfect
- [ ] **Temp file cleanup:** Confirm passlog files are deleted in a `finally` block — test by killing the process mid-encode and checking the temp directory
- [ ] **FFmpeg not found:** Test on a machine without FFmpeg in PATH — confirm the error message is human-readable with install instructions
- [ ] **Windows paths with spaces:** Test with an input path that contains spaces — confirm subprocess invocation uses argv array form
- [ ] **Short video handling:** Test with a 1-second and a 3-second video — confirm output is within the size target or a clear warning is issued
- [ ] **Long video warning:** Test with a video over 20 minutes — confirm the user is warned about extreme quality loss before encoding begins
- [ ] **Concurrent invocations:** Run two encodes simultaneously — confirm their passlog files do not collide
- [ ] **Read-only input directory:** Test with a video in a directory where the tool cannot write — confirm it does not try to write passlog there

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Output overshoots target (size validation catches it) | LOW | Automatically re-encode with 5–10% lower effective target; log the adjustment |
| Output overshoots and size validation was not implemented | MEDIUM | Add post-encode verification; re-encode with lower target |
| Passlog file collision (concurrent runs) | LOW | Implement UUID-prefixed passlog paths; clean temp directory |
| FFmpeg not found in production | LOW | Add pre-flight FFmpeg probe with install instructions |
| Windows path space breakage | LOW | Switch subprocess calls to argv array form throughout |
| Duration probe inaccuracy | MEDIUM | Add validation: probe duration, encode, then compare output duration to probed duration; adjust if > 1% off |
| Very long video quality unacceptable | LOW | Add pre-encode bitrate floor check; warn user before committing encode time |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Container overhead not accounted for | Core encoding logic (bitrate formula) | Output file size within 1% of target across 10 test videos of varying durations |
| Audio bitrate not subtracted | Core encoding logic (bitrate formula) | Formula review + unit test of calculation |
| Duration probe inaccuracy | Input analysis | Test with VFR, screen recording, and corrupted-header inputs |
| Passlog file management | Core encoding logic | Concurrent encode test; kill-mid-encode test; read-only dir test |
| Windows path spaces | CLI subprocess invocation | Test on Windows with spaces in input path, output path, and tool install path |
| FFmpeg not found | CLI pre-flight checks | Test on machine without FFmpeg; verify error message and exit code |
| Very short video edge case | Core encoding logic | Test suite includes 1s, 3s, 5s, 10s clips |
| Very long video edge case | Input validation / pre-encode warning | Test with 30min, 2hr videos; verify warning fires and encode proceeds or aborts |
| Discord MB vs MiB ambiguity | Constants definition | Document the target byte value as a named constant with explicit MiB notation |
| Square/static image overshoot | Core encoding logic (resolution scaling) | Test with YouTube music video-style content; verify output size |

## Sources

- [Two-Pass Encoding with FFmpeg — Martin Riedl](https://www.martin-riedl.de/2022/01/09/two-pass-encoding-with-ffmpeg/) — passlogfile usage, null output in pass 1
- [Understanding Rate Control Modes — slhck.info](https://slhck.info/video/2017/03/01/rate-control.html) — VBV, bitrate accuracy, overshoot causes
- [Three Things to Know About 2-Pass x265 Encoding — Streaming Learning Center](https://streaminglearningcenter.com/encoding/three-things-to-know-about-2-pass-x265-encoding.html) — pass parameter misuse for x265
- [Quantifying Packaging Overhead — Mux](https://www.mux.com/blog/quantifying-packaging-overhead-2) — container overhead at low bitrates (>10% under 1Mbps)
- [FFmpeg multipass fails due to passlog location — staxrip/staxrip issue #388](https://github.com/staxrip/staxrip/issues/388) — write permission issue for passlog
- [10mb.video (Go reference implementation)](https://github.com/ugjka/10mb.video) — documented x264 overshoot with hi-res square static content; `-down 512` workaround
- [Discord lowers free upload limit to 10MB — Dexerto (September 2024)](https://www.dexerto.com/tech/discord-lowers-free-upload-limit-to-10mb-storage-management-is-expensive-2887809/) — confirmed 10MB free limit as of late 2024
- [FileNotFoundError with ffmpeg-python — GitHub issue #251](https://github.com/kkroening/ffmpeg-python/issues/251) — ENOENT/WinError 2 patterns
- [Cannot find ffmpeg — fluent-ffmpeg issue #748](https://github.com/fluent-ffmpeg/node-fluent-ffmpeg/issues/748) — Node.js PATH detection failures
- [VP9 undershooting target bitrate — WebM Project discussion](https://groups.google.com/a/webmproject.org/g/webm-discuss/c/1wShoyt56sQ/m/aijnWsitFR8J) — bitrate undershoot mechanics
- [Should use video stream duration instead of container duration — vcsi issue #62](https://github.com/amietn/vcsi/issues/62) — stream vs container duration discrepancy
- [ffprobe duration analysis — FFmpeg mailing list](https://ffmpeg-user.ffmpeg.narkive.com/MvJFwxc9/ffprobe-duration-analysis-and-analyzeduration-and-probesize) — probe accuracy limitations

---
*Pitfalls research for: FFmpeg two-pass video compression CLI (Discord 10MB target)*
*Researched: 2026-03-25*
