---
name: documentation
description: Write or update project documentation — READMEs, API references, setup guides, architecture notes and changelogs — accurate to the code as it is. Use for documentation work, not for code changes.
---

# Documentation

1. **Read the code first.** Every command, route, option and default you document must exist as written: check package scripts, route definitions, config schemas and env handling. Do not document plans as facts.
2. **Reader first.** Start with what the reader is trying to do (run it, call it, change it). Put setup and the shortest working example before reference material.
3. **Reference that can be checked.** For an API: method, path, request fields with types and limits, response shape, error codes, one example per route. For config: name, default, effect.
4. **Fit the existing docs.** Keep the project's headings, tone and file layout; update the table of contents and links you touch; do not duplicate what another page already says — link to it.
5. **Verify.** Run the commands you documented (or say which you could not run) and fix anything that drifted.
