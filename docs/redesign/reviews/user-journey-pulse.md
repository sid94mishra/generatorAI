# User journey: building "Pulse" with GeneratorAI (2026-10-11)

The owner asked for a real-user run: build a production-grade project end to end using only GeneratorAI —
projects, specialist agents, orchestrator mode with Claude + Codex, chats, workflows, automations, source
control (commit → PR → merge) and GitHub issues — against the sample repo
`github.com/sid94mishra/WORKFLOW_TEST` (base `develop`), logging every product issue met on the way, fixing
it, and carrying on.

**Pulse** — self-hosted uptime monitoring and public status pages. pnpm monorepo: Fastify 5 API + SQLite
(`apps/api`), React 19 + Vite dashboard and status page (`apps/web`), zod schemas (`packages/shared`), check
engine (`packages/checker`); Vitest + Playwright; GitHub Actions CI. Iterations land as PRs to `develop`.

## Setup done as a user
- Project **Pulse** with codebase `pulse` (git remote, `develop`) — cloned, Ready.
- Agents (project scope): Pulse Architect (Claude Opus), Pulse Backend Engineer (Codex GPT-5.6-Terra),
  Pulse Frontend Engineer (Claude Sonnet), Pulse QA Engineer (Codex GPT-5.6-Luna), Pulse Reviewer (Claude
  Opus), Pulse Tech Lead (orchestrator, Claude Opus, team = the five).
- GitHub account connected in Settings → Source control (fine-grained token, this repo only).

## Issues found (product)
| # | Where | What a user sees | Severity | Status |
|---|---|---|---|---|
| U-1 | Project header | The project's internal app-data path (`…/Application Support/@generatorai/desktop/data/artifacts/projects/<id>`) is printed under the title | low | fixed — path stays in Settings (with Copy) and the ⋯ menu |
| U-2 | Agent editor → Runtime | With Provider = Codex, the Model picker opens on Claude Code's models; the user has to switch provider again inside the picker | medium | fixed — `ModelPicker.preferredProvider`; changing Provider clears a model of another provider |
| U-3 | New chat → Agent | A project's own agents (Pulse Tech Lead) are not in the Agent list until a Project is picked — and Project sits below Agent, so search finds nothing | medium | fixed — project agents are listed before a project is chosen; picking one selects its project (dialog and full page) |
| U-4 | Changes → Branch vs develop (61 files) | The header shows "61 changes" but the file list area stays blank for several seconds on first open (the diff highlighter worker starting) — no loading indicator | low | open |
| U-5 | Changes → commit bar | After the agent committed everything (clean tree, 8 commits ahead), the bar still offers a commit message box and "Commit & push" | medium | fixed — a clean tree shows no message box; the action reads Push / Open pull request |
| U-6 | Changes → Commit & push (project codebase) | Fails at **Sync with base**: `merge: origin/develop - not something we can merge` (and the error prints the internal workspace path). Nothing is pushed | **high — blocks every PR** | fixed — sync fetches `+refs/heads/<base>:refs/remotes/origin/<base>` explicitly |
| U-7 | Project codebase → Fetch / new chats | A remote codebase is a bare clone with no fetch refspec: **Fetch** updates nothing and every new chat branches from the base as it was at clone time — after a PR merges, the next iteration would start from stale `develop` | **high** | fixed — bare clones get `+refs/heads/*:refs/remotes/origin/*` (and Fetch repairs older ones); new worktrees cut from a freshly fetched `origin/<base>` |
| U-8 | Project → Pull requests / Issues | GeneratorAI can open a PR but **cannot merge** one, has **no GitHub issues** (no list/create, no tab) and agents have no issue tools — so "raise an issue → a workflow fixes it" is impossible in-app | **high — missing capability** | fixed — D-146: Merge card (merge/squash/rebase), Issues tab + issue page + Fix in chat, `github_*` agent tools (writes ask; merge always asks a person) |
| U-9 | Changes → Open pull request | A token without the right permission fails with GitHub's raw JSON (`GitHub createPullRequest failed (403): {"message":"Resource not accessible by personal access token",…}`) instead of naming the missing permission | medium | open |
| U-10 | Generated PR description | The generated PR body says "Test plan — Not verified … does not indicate whether they were run" although the chat had just reported 101 passing tests; PR generation ignores the chat's own results | medium | open |
| U-11 | Chat → "create a workflow" | A plain chat has **no workflow tools** (the per-chat "Workflows" toggle was never registered) and nothing says how to get them; the agent could only describe the workflow | **high** | fixed — built-in **Workflow Author** agent (workflows + authoring on) and a **Describe it** start on New workflow that opens a chat with it; also works by granting an agent the Workflows/Workflow authoring capabilities |
| U-12 | Workflow builder | A 14-stage agent-drafted workflow opens at 20% zoom — unreadable until the user zooms | low | fixed — automatic fits floor at a readable 60% anchored to the first stage; Fit view still shows all |
| U-13 | Workflow builder banner | "Drafted by **Orchestrator** in a chat" — shows the role, not the agent ("Pulse Tech Lead") | low | fixed — names the chat's agent |
| U-14 | PR page → Merge | The side rail's cards shrink to the viewport and clip: the Merge button (and Review in chat) can't be reached on a PR with a long description | **high** | fixed — DetailPage rail cards keep their height; the page scrolls |
| U-15 | Workflow → Run dialog | Each stage has an unlabelled switch that is **off** for every stage — it means "Skip", so off = runs; reads as "all stages disabled" | medium | fixed — the switch is "Run <stage>" (on = runs), hint says "turn a stage off to skip it" |
| U-16 | Workflow run / chat in "Accept edits, ask for the rest" | Every shell command parks a gate with only Deny / Allow once; a 14-stage run asks dozens of times for `pnpm lint`, `pnpm -r test`, `ls`, `cat` — the only escape is Full access | **high** | fixed — D-147: "Allow `pnpm lint` for this run / chat" remembers scoped rules (risky and never-listed commands still ask); "N rules · Clear" in the run header and the composer's Approvals menu |
| U-17 | Workflow check stages | `pnpm install` as a check exits 1 every round — `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`: checks run without a TTY and without `CI` | **high** — the QA loop could never go green | fixed — check stages default `CI=true` (the check's env wins) |
| U-18 | Workflow run → stage rows | A check that exited 1 shows **"Succeeded"** (green) — the user can't see why the loop's `green` rule is false | **high** | fixed — "Check failed · exit 1" / "Check timed out" in the failed tone |
| U-19 | Workflow run → approval card | "Approving … opens a PR with **this description**" — but the card doesn't show it (collapsed under Structured output), and the gate carried only the first 4 000 characters | medium | fixed — the card shows the output (JSON contract text fields as Markdown) in a scroll box; the gate carries up to 64 000 characters |
| U-20 | Workflow post-processing | PR #10 opened with an **empty body** and the commit message lost its `Spec:` path: `{{stages.<key>.output.<field>}}` renders empty in commit/PR templates although the validator accepts it | **high** | fixed — post-processing renders with the run-end `stages` scope (top level + expansions) |
| U-21 | Workflow run → stage transcript | A JSON-contract stage's final answer shows as raw JSON with literal `\n` | low | open (the review card now renders it; the transcript bubble still raw) |
| U-22 | Workflow run page | A run that opened a PR doesn't link it anywhere | medium | fixed — "Pull request #N opened · title · head → base  [View pull request]" banner (in-app PR page) |
| U-23 | Workflow post-processing | Nothing after `create_pr` can see the PR it opened — an Issue Fixer cannot comment the PR link on the issue (the Workflow Author found this gap) | low — GitHub cross-references a PR whose body says "Fixes #N" | open |
| U-24 | Claude stages / chats in "Accept edits" | Read-only GeneratorAI tools (`github_get_issue`, `list_workflows`, `describe_workflow` …) still ask — they declare `skipPermission`, but only the Copilot provider honoured it; Claude mapped every host tool to `other` | medium | fixed — the Claude provider allows `skipPermission` tools without the domain gate |

## Journey log
- **Iteration 1 (orchestrator chat, ~30 min):** Pulse Tech Lead planned and delegated — Architect (spec + ADR), Backend (Codex Terra: shared/checker/api), Frontend (Sonnet: web), QA (Codex Luna: clean-checkout run), Reviewer (Opus: 15 fixes). 61 files, 8 commits, **101 tests pass**, lint/format/build green. Pushed and **PR #9** opened from the Changes tab (after U-6 fix + token permissions); CI ran on GitHub Actions.
- **Workflow authoring:** a plain chat could not author (U-11); granted the Tech Lead *Workflows* + *Workflow authoring* in the agent editor and it drafted **Pulse Feature Pipeline** (spec → backend ∥ frontend → QA loop with pnpm check stages → review → verify → approval → commit/push/PR), validated with 0 issues, dry-run plan clean; reviewed in the builder (risk chips: writes files, commits, pushes, opens a PR, runs repo code) and **published v1**.
- **Merged PR #9 in GeneratorAI** (after U-14) — GitHub confirms merge commit `2681463`. Builder now opens the pipeline at 60% (U-12) and credits "Pulse Tech Lead" (U-13).
- **Iteration 2** started from the Run dialog: "Check scheduler and SSRF-safe checker" on `pulse @ develop`, new worktree; plan preview showed the approval at `prepare_pr` and commit/push/PR to develop. Spec stage parked on the first read-only shell command (U-16); acting as the user, approving commands from a reviewed safe list, stopping on anything else.
- **Iteration 2 result:** spec 10m, backend ∥ frontend 14m, QA loop 3 rounds (accepted by the user after U-17), review 3m with 6 fixes, verify lint/test/build green, approval → commit `19866dad`, push, **PR #10** (55 files, +3190/−145). GitHub Actions CI on #10: success. Approver (acting user) allowed every shell command from a reviewed safe list; stopped for a heredoc file write and a python file edit (both reviewed, allowed).
- **Merged PR #10** from GeneratorAI (merge `084d46a`). Posted the approved description on #10 through a Tech Lead chat with the new `github_comment_issue` tool (U-20 had left the body empty).
- **Issue #11** (SSRF NAT64/6to4 bypass, labels bug+security) filed from the new Issues tab. **"Describe it"** on New workflow → Workflow Author chat → **Pulse Issue Fixer** draft (triage → fix/check loop ×3 → review + approval → commit/push/PR "Fixes #N"), validated, plan clean.
- **Rebuilt + installed** with U-15…U-22 and U-16 (D-147). In the installed app: the permission card offers "Allow github_get_issue for this run" (stored as a run rule); `pnpm install` check now passes (U-17); PR body filled (U-20); run page banner "Pull request #12 opened" (U-22); approval card shows the output (U-19 — mixed JSON contracts now render field by field).
- **Issue #11 → Pulse Issue Fixer run:** triage (Architect) → fix loop (Codex; round 1 tests failed and were fed back, round 2 green) → review (approve, no concerns) → approved by the user → commit "fix: SSRF … (#11)", push, **PR #12** with "Fixes #11".
- **Automation "Pulse Nightly Health"** (Describe it → Workflow Author → published) created in the Automations wizard: schedule `0 2 * * *`, Accept edits ("nobody watches an automation run"), `pulse @ develop`; Run now → execution #1 running.

