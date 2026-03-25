---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-25
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) + node:assert/strict |
| **Config file** | none — flags passed directly to `node` |
| **Quick run command** | `node --import tsx/esm --test tests/bitrate.test.ts` |
| **Full suite command** | `node --import tsx/esm --test "tests/**/*.test.ts"` |
| **Estimated runtime** | ~1 second |

---

## Sampling Rate

- **After every task commit:** Run `node --import tsx/esm --test tests/bitrate.test.ts`
- **After every plan wave:** Run `node --import tsx/esm --test "tests/**/*.test.ts"`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~1 second

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 0 | FOUND-01 | smoke | `node -e "import('./src/bitrate.js').then(() => console.log('ESM OK'))"` | ❌ Wave 0 | ⬜ pending |
| 1-01-02 | 01 | 0 | FOUND-02 | smoke | `node -e "import('ffmpeg-static').then(m => { if (!m.default) throw new Error('null'); console.log(m.default); })"` | ❌ Wave 0 | ⬜ pending |
| 1-01-03 | 01 | 1 | FOUND-03 | unit | `node --import tsx/esm --test tests/bitrate.test.ts` | ❌ Wave 0 | ⬜ pending |
| 1-01-04 | 01 | 1 | FOUND-04 | unit | `node --import tsx/esm --test tests/bitrate.test.ts` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json` — must exist with `"type": "module"`, correct scripts, and all dependencies listed
- [ ] `tsconfig.json` — must exist with `"module": "NodeNext"` and `"target": "ES2022"`
- [ ] `src/bitrate.ts` — the module under test (stub or full implementation)
- [ ] `src/errors.ts` — error hierarchy stub (no tests in Phase 1)
- [ ] `tests/bitrate.test.ts` — covers FOUND-03 and FOUND-04
- [ ] `npm install --save-dev typescript tsx @types/node` — no test framework install needed (node:test is built-in)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Constants have binary MiB comments | FOUND-04 | Comment presence not grep-verifiable as "correct explanation" | Read `src/bitrate.ts` constants block; verify each constant has a comment explaining binary MiB (not decimal MB) and why there are two values |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 2s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
