---
name: test-generation
description: Write or extend automated tests for existing code — unit, integration or end-to-end — with the project's own framework and helpers. Use when coverage is missing, a bug needs a failing test first, or a change needs verification.
---

# Test generation

1. **Use what the project uses.** Find the test runner, config, helpers and an existing test next to the code; mirror its structure, naming and fixtures. Do not add a new framework.
2. **Test behaviour, not implementation.** One behaviour per test, named for the expected outcome ("returns 404 for another team's task"). Arrange, act, assert.
3. **Cover what breaks.** The happy path, each validation and permission failure, empty and boundary inputs, and the regression you were asked about. A test must fail if the code under test were wrong — check that by reasoning or by breaking it once.
4. **Deterministic.** No real network, clock or random values without control: use the project's fakes, fixed timestamps and in-memory stores. Clean up what a test creates.
5. **Run them.** Run the new tests alone, then the suite they belong to; report the command and the pass/fail counts.
