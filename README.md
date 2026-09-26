# ffmpeg10mb

Compress any video to under 10 MB for Discord uploads.

Takes any video input and outputs an MP4 guaranteed under 9.8 MiB — small enough for Discord free users to send directly.

## Download (Windows)

Grab **`Felparizador.exe`** from the [latest release](https://github.com/caiocost/ffmpeg10mb/releases/latest) and double-click it — no install, no Node, no ffmpeg needed (ffmpeg and ffprobe ship inside). It's a portable build, so it takes a few seconds to unpack on each launch.

## What it does

- Accepts any video format ffmpeg can read (MP4, MOV, MKV, AVI, WebM, etc.)
- Outputs an H.264/AAC MP4 under 9.8 MiB (Discord's free-tier upload limit)
- Uses two-pass H.264 encoding for videos >= 30 seconds (accurate bitrate targeting)
- Uses single-pass CRF encoding with a maxrate cap for clips under 30 seconds (faster)
- Automatically calculates the optimal video bitrate from duration and audio settings
- Bundles ffmpeg via `ffmpeg-static` and ffprobe via `ffprobe-static` — no system ffmpeg install required

## Prerequisites

- Node.js >= 22
- npm (ffmpeg-static provides the binary automatically on `npm install`)

## Installation

```sh
git clone https://github.com/your-username/ffmpeg10mb.git
cd ffmpeg10mb
npm install
```

## CLI Usage

The CLI is available via `npm run cli`. Pass `--` before any flags so npm does not consume them.

```sh
# Basic usage — output goes to <input_stem>_discord.mp4
npm run cli -- video.mp4

# Specify output path
npm run cli -- -o out.mp4 video.mp4

# Strip audio
npm run cli -- --no-audio video.mp4

# Custom size ceiling (e.g. 8 MiB — useful for older Discord limits or other platforms)
npm run cli -- --target 8 video.mp4

# Convert only — no size limit, quality-driven CRF (output can be any size)
npm run cli -- --no-ceiling recording.webm

# Convert only at higher quality (lower CRF = better quality, larger file)
npm run cli -- --no-ceiling --crf 18 recording.webm

# Dry run — probe the file and print the projected bitrates without encoding
npm run cli -- --dry-run video.mp4

# Show all available options
npm run cli -- --help
```

### All flags

| Flag | Short | Default | Description |
|---|---|---|---|
| `--help` | `-h` | — | Show usage and exit |
| `--output <path>` | `-o` | `<stem>_discord.mp4` | Output file path |
| `--no-audio` | — | false | Strip audio from output |
| `--target <MiB>` | — | `9.8` | Size ceiling in binary MiB |
| `--no-ceiling` | — | false | Convert only: quality-driven CRF, no size limit and no post-encode size check |
| `--crf <n>` | — | `23` | Quality for `--no-ceiling`, 0–51 (lower = better quality, larger file) |
| `--audio-bitrate <k>` | — | `96` | AAC bitrate in kbps when source has audio |
| `--dry-run` | — | false | Show probe + projected bitrates; skip encode |

## Electron GUI (Felparizador)

A drag-and-drop desktop interface is included.

```sh
npm run gui
```

This builds the TypeScript source first (`tsc`), then launches Electron. Drop videos anywhere on the window to queue them, then hit **Felparizar fila**.

The options panel mirrors the CLI flags:

- **Caber no limite / Só converter** — size-targeted encode, or convert only (`--no-ceiling`) with a CRF slider
- **Limite alvo** — ceiling in MiB, with presets for Discord (10), Nitro Basic (50) and Nitro (500)
- **Tirar o áudio** and the audio bitrate
- **Pasta de saída** — defaults to each input's own folder

While encoding, the preview area turns into a loading screen with per-file progress and tips.

### Building the Windows executable

```sh
npm run dist:win
```

Produces `release/Felparizador.exe` (portable, single file) and `release/win-unpacked/Felparizador.exe` (starts instantly, but needs the whole folder). ffmpeg and ffprobe are unpacked next to `app.asar` so they can be spawned.

## Programmatic API

Install as a local dependency or import directly from source using `tsx`.

```ts
import { probeVideo, encodeVideo, verifyOutput, calculateVideoBitrate } from "ffmpeg10mb";
```

### Key exports

| Export | Description |
|---|---|
| `probeVideo(inputPath)` | Runs ffprobe; returns duration, resolution, audio presence, file size |
| `encodeVideo(input, output, options)` | Encodes the video; resolves when done |
| `verifyOutput(outputPath, options)` | Confirms output is under the ceiling; throws `OutputOversizeError` if not |
| `calculateVideoBitrate(targetBytes, durationSeconds, audioBitrateKbps)` | Returns the integer video kbps needed to hit a target size |

### EncodeOptions

```ts
interface EncodeOptions {
  ffmpegPath?: string;           // override bundled ffmpeg
  signal?: AbortSignal;          // cancel the encode
  audioBitrateKbps?: number;     // default: 96
  targetEffectiveBytes?: number; // override default 9.6 MiB effective target
  forceNoAudio?: boolean;        // strip audio even if source has it
  noCeiling?: boolean;           // convert only: CRF quality, no size target, always single-pass
  crf?: number;                  // quality when noCeiling is set (default: 23)
  quiet?: boolean;               // suppress terminal spinner (Electron / programmatic use)
  onProgress?: (evt: EncodeProgressEvent) => void; // progress callback
}
```

### Example

```ts
import { probeVideo, encodeVideo, verifyOutput } from "ffmpeg10mb";

const probe = await probeVideo("input.mov");
console.log(`Duration: ${probe.durationSeconds.toFixed(1)}s`);

await encodeVideo("input.mov", "output.mp4", { quiet: true });

const { sizeBytes } = await verifyOutput("output.mp4");
console.log(`Output: ${(sizeBytes / 1_048_576).toFixed(2)} MiB`);
```

## Running tests

```sh
npm test
```

Uses the built-in `node:test` runner — no external test framework required.

## How it works

1. **Probe** — ffprobe reads the input to extract duration, resolution, and whether audio is present.
   Duration is resolved in order: container header → video stream → packet timestamps. The last
   fallback covers WebM/Matroska recorded by browser `MediaRecorder`, which leaves the Segment
   duration unset; only timestamps are read, so it stays fast on large files.
2. **Bitrate calculation** — computes the maximum video bitrate that fits within the target:
   `videoBitrateKbps = floor((targetBytes * 8 - audioBits) / duration / 1000)`
   Encoding always passes `-fps_mode passthrough`. Browser-recorded WebM declares no framerate
   (ffprobe reports `r_frame_rate=1000/1`), and without it ffmpeg duplicates frames toward that
   nominal rate — encodes run ~11x slower, two-pass aborts with "2nd pass has more frames than
   1st pass", and the output overshoots the size ceiling.
3. **Encode** — two strategies depending on duration:
   - **Two-pass H.264** (>= 30s): pass 1 analyzes motion complexity; pass 2 encodes with accurate bitrate targeting.
   - **Single-pass CRF** (< 30s): uses CRF quality mode with a maxrate cap derived from the target size. Faster and accurate enough for short clips.
   - **`--no-ceiling`**: always single-pass CRF with no bitrate cap — there is no size target for two-pass to converge on. Output size is whatever the content needs.
4. **Verify** — checks the output file size against the 9.8 MiB ceiling. Exits non-zero if the output is over the limit. Skipped under `--no-ceiling`.

### Size targets

| Constant | Value | Purpose |
|---|---|---|
| Effective target | 9.6 MiB | What the bitrate formula aims for |
| Ceiling | 9.8 MiB | Hard limit; tool fails if output exceeds this |

The 0.2 MiB gap provides headroom for MP4 container overhead (moov atom, mdat headers). Two-pass encoding can overshoot the target by up to ~200 KB on low-bitrate encodes.
