---
phase: 2
slug: input-analysis
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) + node:assert/strict |
| **Config file** | none — runner invoked directly |
| **Quick run command** | `node --import tsx/esm --test tests/probe.test.ts` |
| **Full suite command** | `node --import tsx/esm --test "tests/bitrate.test.ts" "tests/probe.test.ts"` |
| **Estimated runtime** | ~3 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --import tsx/esm --test tests/probe.test.ts`
- **After every plan wave:** Run `node --import tsx/esm --test "tests/bitrate.test.ts" "tests/probe.test.ts"`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~3 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 02-01 | 0 | INPUT-01 | unit (mock) | `node --import tsx/esm --test tests/probe.test.ts` | ❌ Wave 0 | ⬜ pending |
| 2-01-02 | 02-01 | 0 | INPUT-02 | unit | `node --import tsx/esm --test tests/probe.test.ts` | ❌ Wave 0 | ⬜ pending |
| 2-01-03 | 02-01 | 1 | INPUT-03 | integration | `node --import tsx/esm --test tests/probe.test.ts` | ❌ Wave 0 | ⬜ pending |
| 2-01-04 | 02-01 | 1 | INPUT-04 | unit (math) | `node --import tsx/esm --test tests/probe.test.ts` | ❌ Wave 0 | ⬜ pending |
| 2-01-05 | 02-01 | 1 | INPUT-05 | unit (math) | `node --import tsx/esm --test tests/probe.test.ts` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/probe.test.ts` — covers INPUT-01 through INPUT-05
- [ ] `tests/fixtures/short.mp4` — 3s H.264+AAC fixture (INPUT-05, INPUT-03)
- [ ] `tests/fixtures/video-only.mp4` — 10s H.264, no audio (INPUT-03 hasAudio=false)
- [ ] `npm install execa` — production dependency (not yet installed)

**Fixture generation (run once, committed to repo):**
```bash
ffmpeg -f lavfi -i "testsrc=duration=3:size=320x240:rate=25" -f lavfi -i "sine=frequency=440:duration=3" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 96k -t 3 tests/fixtures/short.mp4
ffmpeg -f lavfi -i "testsrc=duration=10:size=320x240:rate=25" -c:v libx264 -pix_fmt yuv420p -an -t 10 tests/fixtures/video-only.mp4
```

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| FFmpeg not found message readability | INPUT-01 | Human judgment on message clarity | Temporarily rename ffprobe; run tool; verify message is friendly and includes install URL |
| Probe table display format | INPUT-03 | Visual formatting check | Run on a real video; verify table shows duration, resolution, size in human-readable format |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
