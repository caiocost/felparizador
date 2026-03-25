# Phase 3: Core Encoding — Research

## Two-pass libx264

- Pass 1: `-pass 1 -passlogfile <prefix> -an -f null <null device>`
- Pass 2: `-pass 2 -passlogfile <same prefix>` + AAC or `-an`, output MP4 with `-movflags +faststart`
- Windows null sink: `NUL`; Unix: `/dev/null`

## execa

- v9 uses `cancelSignal` (not `signal`) for AbortController integration

## Progress

- FFmpeg writes `time=HH:MM:SS.xx` to stderr during encode; parse for pass 2 percentage vs probe duration
