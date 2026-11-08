# Competitor evidence digest (web research, 2026-11-05; sources in brackets)

All figures are vendor-published or from secondary reviews; none were run on the tasks in this evaluation.

## OpenAI Codex app — computer use (macOS/Windows)
- Hybrid, accessibility-tree first; screenshots, coordinate clicks, AppleScript as fallback (MacStories review). Background operation on macOS with parallel virtual cursors (wiggle while thinking); Windows takes over the foreground.
- Per-app approvals (Always / Once / Deny), admin controls, hard-blocked terminal/security prompts; picture-in-picture live view; `@Computer` invocation.
- Accuracy (OS-level, not this task set): GPT-5.4 75.0% OSWorld-Verified (Mar 2026); GPT-5.5 78.7% OSWorld-Verified (Apr 2026, launch coverage).
- Weaknesses: reviewers call it "kind of slow"; two tasks on one app conflict; verbose AX tree.
[macstories.net/notes/openais-new-codex-app-has-the-best-computer-use-feature-ive-ever-tested; developers.openai.com/api/docs/guides/tools-computer-use; learn.chatgpt.com/use-cases/use-your-computer-with-codex]

## Anthropic Claude — computer use (API toolset + desktop app "Cowork")
- Screenshots + pixel coordinates; `zoom`; batched tool_use blocks per turn; image ≈1,000–1,800 tokens.
- Desktop app on macOS 15+: background windows by default, waits while the user types; per-app permission; trading apps blocked; "no sandbox between Claude and your apps".
- Accuracy: Sonnet 5.5 80.1% / Opus 5.5 81.8% on OSWorld 2.1 (partial credit); secondary reports ≈43.5% / 48.7% strict.
- Weaknesses: retries on complex multi-step tasks; may assume success without verifying.
[platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool; support.claude.com/en/articles/14128542; anthropic.com/news/claude-sonnet-5-5]

## Hermes Agent (Nous Research) — uses the same cua-driver
- Hybrid: `som` (numbered elements + screenshot) or `ax` (tree only); background input; screenshot pruning (~30k vs ~600k tokens for 20 actions, vendor estimate); approval gate per action kind; no batching; no published benchmarks.
[hermes-agent.nousresearch.com/docs/user-guide/features/computer-use]

## Cursor
- Cloud agents in isolated VMs with a desktop (verifying PRs); not the user's own desktop apps. No benchmarks/approvals documented. [cursor.com/blog/agent-computer-use]

## xAI Grok Bot
- Early beta (Aug 2026), each bot on its own cloud computer; no technical details or benchmarks published. Unrated.

## Manus "My Computer"
- Screenshot observe-decide-act loop on the user's machine; command-by-command approvals; reviewers report misclicks, latency, context loss on long tasks. No benchmarks.

## Independent evidence on approach
- Microsoft UFO2 (2025): hybrid UIA + vision beats either alone (o1: UIA 24.5%, vision 14.3%, hybrid 28.6% on OSWorld-W); multi-action steps cut steps ~51%.
- cua-driver authors: background AX click 1153 ms default → ~325 ms with a 200 ms window watch; batching via `run_steps` is "the default way to act".
