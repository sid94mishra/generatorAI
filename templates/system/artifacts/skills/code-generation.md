---
name: code-generation
description: Write or change production code in an existing codebase so it fits the project — its conventions, types, error handling and tests. Use when implementing a feature, endpoint, component or fix, not for docs-only or test-only work.
---

# Code generation

1. **Read before writing.** Open the files you will change and one or two neighbours; copy their naming, module layout, error style and import conventions. Follow the project's own guide (README, CONTRIBUTING, AGENTS.md, CLAUDE.md) when there is one.
2. **Smallest complete change.** Do what the task asks — no drive-by refactors, renames or new dependencies unless the task needs them. If a dependency is needed, use the project's package manager and say why.
3. **Types and errors.** Keep the project's type strictness; validate input at boundaries (requests, CLI args, files); handle the failure paths the caller can hit, with the project's error shape.
4. **Prove it.** Add or update the tests that would fail without your change, then run the narrowest test command for the code you touched, then the typecheck/lint the project uses. Report the commands and their last lines of output.
5. **Leave it clean.** No commented-out code, debug prints or TODOs you could have resolved; keep public APIs documented the way the project documents them.
