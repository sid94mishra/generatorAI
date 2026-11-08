# B-6 computer-use evaluation: parked harness and evidence

This folder holds the harness and judge reports behind backlog item B-6 (`docs/redesign/BACKLOG.md`), copied unchanged
on 2026-11-08 from the session scratchpad, which macOS purges. It is a record of how the scores were measured, not
maintained code: the scripts are macOS-only, written for one machine, and still carry that session's absolute paths.

## Contents

| Path | What it is |
|---|---|
| `harness/scenarios.json` | The task prompts: S1–S10 (original), H1–H4 (first held-out set), G1–G6 and G3b (fresh held-out set) |
| `harness/batch.sh` | Runs a list of tasks: closes the test apps, resets each task's output files, runs it, verifies it |
| `harness/cu-run.mjs` | One task, driven like a user over CDP port 9555: a new chat, the prompt typed in, consent cards answered, metrics read from the app's DB |
| `harness/cu_verify.py` | On-disk checks per task (PASS/FAIL lines and a SCORE) |
| `harness/usage.py` | Token use of a chat from the provider transcript (Claude or Codex) |
| `harness/judge_compile.py` | Builds `runs.json` and `traces.json`, the evidence handed to the judge |
| `harness/perm.mjs` | Reads the app's macOS permission status over CDP |
| `harness/bridge/*.mts` | Run the real `CuaDriverBridge` (`saveAs`, `invokeMenu`, `newDocument`, cursor hide/show) against the live driver with `tsx` |
| `harness/driver/*.mjs` | Direct cua-driver probes: a scripted session (`sess.mjs`), session list, cursor state, cursor-motion trajectory (B-5) |
| `fixtures/` | Input files the tasks copy into the output folder |
| `judge-brief.md` | The brief given to the independent Opus judge |
| `reports/REPORT-*.md` | The four judge reports: 5.0, 5.5, 6.0, 5.7 |
| `reports/builds.md` | The build and the changes behind each round; give it to the judge |
| `reports/results.csv` | Every run from R6a to R17a: seconds, calls, context tokens, checks passed, failed checks |
| `reports/competitors.md`, `reports/generic-audit.txt` | Published competitor claims; app and task names found in the feature code |

Left out on purpose:
- the raw per-run traces and replies (`results/`, `runs.json`, `traces.json`). Some runs listed the owner's home folders,
  and those listings appear in the traces;
- screenshots.

## Before resuming

1. Port the harness to Node `.mjs` under `agent-tests/computer-use-eval/` (repo rule: scripts are Node using `path` and
   `os.tmpdir()`, not bash or Python). Take the output folder, DB path and driver socket from the environment, not from
   absolute paths.
2. Reset properly before every run (B-6 issue 10):
   - quit the test apps;
   - remove each app's restored and autosaved test documents;
   - reset app modes such as Calculator's;
   - close the windows earlier runs left open.
3. Write a new held-out set of 10 or more tasks before tuning anything. It needs at least 3 third-party apps and the hard
   control classes: canvas text, an export window separate from the document, and word-processor tables. Treat S/H/G as
   contaminated.
4. Add Windows and Linux runners (UI Automation / AT-SPI apps) and one run with a non-English UI, as B-6's definition of
   done requires.

## Running a round (as it was done)

1. Install a release build (clean release, package, re-sign, open with `--remote-debugging-port=9555`).
2. Run `batch.sh R18a sonnet claude-agent S1 … G6`, one task after another, with no other use of the machine.
3. Run `python3 -I judge_compile.py R18a R19a`. Then give an Opus judge `judge-brief.md` with the evidence folder: the
   reports, `builds.md`, `scenarios.json`, `cu_verify.py`, `runs.json`, `traces.json`, the skill, `generic-audit.txt` and
   `competitors.md`.
4. Score two runs per task on the same build, and keep earlier rounds for the trend only.
