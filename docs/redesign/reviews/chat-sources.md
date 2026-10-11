# Chat sources: composer row, Edit sources, native folder picker (owner report, 2026-10-10)

Decisions: D-135 (how a mount reads), D-136 (native picker + fallback, Edit sources form), D-137 (a live
conversation follows Edit sources). Screenshots: `docs/redesign/shots/chat-sources/` (gitignored).

## 1. Root cause of the "main" chip and the app-data path

- A chat created with **no sources** still needs a cwd, so `MountService.plan` (packages/core) creates a
  `generated` mount: alias `GENERATED_MOUNT_ALIAS = 'main'`, path `<workspace>/source/main` under the managed
  workspaces directory (in the installed app: `~/Library/Application Support/@generatorai/desktop/data/workspaces/executions/<chatId>/source/main`).
- `prepareMount` then runs `git init -q -b main` there (`GitClient.initIfNeeded`) so checkpoints and Changes work.
- The composer chip showed `primary.alias` ("main") plus `git.branch` once a re-prepare recorded it ("main main"),
  and the popover printed `mount.path`, the managed folder. The chat header's branch chip and the Files dock's
  Sources list had the same problem; worktree mounts printed their managed checkout path too.
- So both: the alias is the managed mount's default name, and the branch is the `git init -b main` branch.

The server is unchanged (the managed folder must stay a git repo). Every surface now reads mounts through
client-core `describeMount` (D-135).

## 2. What each scenario shows, before → after

| Scenario | Before | After |
|---|---|---|
| No sources | chip `main`; popover "main · Generated · /…/workspaces/executions/<id>/source/main" | chip **Empty workspace** (fg-2, no branch); popover card "Empty workspace — No sources: the agent works in an empty folder this chat owns…"; no path; header shows no branch |
| Local git repo, in place | chip `work main`; path of the repo | same, path shortened from the left (`…/T/generatorai-dummy-repo-…/work`), copy keeps the full path |
| Plain folder, in place | chip `<name>`; badge "In place" | chip `<name>`, no branch; card shows the user's folder |
| Git repo, worktree | chip `work generatorai/<slug>`; path = managed worktree under app data | chip `work generatorai/<slug>` (what the agent works on); card "Worktree · branch · **from** <user's repo>" — the managed checkout path is not shown |
| Project codebase worktree | managed path | branch, no path (the origin may be the app's clone of a remote) |
| Several mounts | `work main +1` | unchanged, `+N` in fg-3 |

Chrome (board ComposerStates): both row chips are now P-09 `Chip` (24h, `line` border, transparent, `text-small` 500
`fg-2`, label `fg`, branch mono `fg-3`) instead of ghost Buttons with an overridden border. Popover: header title 600,
mount count mono, mount cards with a `line` border (the old `line-soft` was invisible on `overlay`), kit `Badge size="sm"`
for the mode, branch in `fg-2`. "Edit sources…" now closes the popover (it used to stay on top of the dialog).

## 3. Edit sources and the SourcePicker

- Edit sources: ModalForm sections **Where** (full SourcePicker) and **Source control** (label + hint + switch rows,
  `line` rules), labels above controls, one left edge (D-133 structure). Save reads "Save" when the list is empty.
- Full SourcePicker = the compact layout's single bordered list: each source row is icon · renamable name ·
  Working directory / Make working directory · plain folder / uncommitted · reorder / remove, then the user's folder
  (+ current branch) with copy, then Mode and Branch. Unticked project codebases stay "Not included" rows; "Add local
  folder" is the list footer. A plain folder no longer offers branch controls (the server refused them).

## 4. Native folder picker and fallback (D-136)

- `useFolderPicker` (blocks/directory-browser) → `lib/desktop.ts desktopFolders` → preload `selectDirectory(opts)` →
  main `desktop:selectDirectory` → `dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'], defaultPath? })`.
- Local-only: the channel is not in `ipc-scope.ts`'s remote allowlist, so a remote server's page is refused by the IPC
  guard; `getAppInfo()` gained `localServer` so the SPA knows up front and opens the fallback instead.
- Fallback (plain browser; desktop app on a remote server): the server-side DirectoryBrowser, opened at the server
  user's home with shortcuts (Home, Desktop, Documents, Downloads, Projects… that exist; drives). Click a folder to open
  it, "Use" on a row to pick it without opening, "Use this folder" for the one on screen, or paste a path.
- Removed: the unused `__generatoraiNativePickers` / `window.showDirectoryPicker` shim (it returned a name only in a
  plain Chromium tab) and the dead `IPlatformClient.selectDirectory`.

## 5. D-137 — found during testing

After Edit sources on a live chat, the next turn still wrote into the old folder: every provider's
`resumeConversation` skipped a live conversation. Fixed for Claude (rebind when roots change), Codex (adopt roots, send
`cwd` each turn) and Faux. **Open:** Copilot (one CLI client per cwd; needs a live sign-in to verify a rebuild) and the
experimental OpenCode/ACP still keep the old cwd until the conversation is rebuilt (server restart / eviction).

## 6. Test evidence

Isolated sandbox: `GENERATORAI_TEST_FAUX_SCRIPT=<scratch>/faux-cs.json node scripts/redesign/sandbox.mjs --port=3297 --web-port=5297`
(startup log: dbPath under `os.tmpdir()/generatorai-sandbox-*`). Repos: `node scripts/redesign/make-dummy-repo.mjs`
(git) and an `os.tmpdir()` folder (plain). The Faux script writes `cs-probe.txt` relative to the conversation's
`workingDirectory`; each check read the file's location and content plus `GET /api/workspaces/:id`.

| Scenario (driven in the browser via the UI, playwright-cli) | Agent's cwd / probe | Shots |
|---|---|---|
| New chat, no sources | `…/executions/<id>/source/main` ✔ | after-no-sources-*, after-empty-after-turn |
| New chat + git repo in place (fallback browser: paste path) | the repo ✔ | after-fallback-browser-*, after-git-inplace-* |
| New chat + plain folder | the folder ✔ | after-newchat-plain, after-plain-* |
| New chat + git repo as worktree | `…/source/work` on `generatorai/cs-worktree`; user's checkout untouched ✔ | after-newchat-worktree, after-worktree-* |
| Live chat: empty → add folder + repo, repo made working dir → remove repo → remove all | turn 1 managed, 2 repo, 3 plain folder, 4 managed ✔ (after D-137; before it, turn 2 still wrote to `source/main`) | live-1…4-*, live-edit-dialog-* |
| Light theme | — | light-*-popover |

Desktop (dev build, `pnpm --filter @generatorai/desktop build:bundle`; isolated `--user-data-dir`; `dialog.showOpenDialog`
stubbed in the main process):
- `node agent-tests/desktop-folder-picker-smoke.mjs --repo=<dummy>/work --shots=docs/redesign/shots/chat-sources` —
  9/9: `localServer` true; cancel adds nothing; Add local folder calls the OS dialog with `openDirectory` and no in-app
  modal; the chat's working directory is the picked folder; chip shows the folder with no branch; Edit sources adds the
  repo natively and mounts it (desktop-native-*).
- `node agent-tests/desktop-remote-ipc-smoke.mjs` — 16/16, now including `selectDirectory` refused for a remote page and
  `localServer: false`.

Checks: web typecheck, lint, check:design, build; desktop typecheck, lint, vitest (486); providers vitest (788, new
Claude/Codex rebind tests); client-core vitest (844, new `describeMount` / `pathTail`); web unit tests related to the
touched files (715) and ComposerParts / Chip stories (new `SourcesEmptyWorkspace`); e2e `composer`, `chats`, `projects`,
`changes-dock` against the sandbox (18 passed).

## 7. Left for the owner

- Click the **real** native folder dialog in the installed app (automation can only stub it), on macOS and, when
  available, Windows/Linux (D-136 is Electron's cross-platform dialog; `createDirectory` is macOS-only).
- Copilot / OpenCode / ACP after Edit sources (D-137 open item).
- The desktop app connected to a remote server, end to end in the real SPA (the smoke uses a stand-in page; a sandbox
  shown as "remote" stops at pairing).

## Real-user pass on the installed app (2026-10-11)
Installed `/Applications/GeneratorAI.app`, isolated profile (`--user-data-dir`), folders picked in the real macOS dialog
(⇧⌘G via System Events), real Claude turns. 41/43 checks passed first run; both failures were real and are fixed
(D-139), re-test 5/5.
- Plain folder in place (New chat → Add local folder): chip/popover/mount correct, agent wrote into the folder.
- Local git repo: in place on its branch; worktree on `generatorai/<slug>` with the user checkout untouched; dirty repo badge.
- Edit sources on a live chat: Empty workspace → folder → agent follows in the same conversation → remove → Empty workspace.
- Projects: `octocat/Hello-World` cloned, auto-included (D-108), agent read README from its worktree; local git (Browse →
  OS dialog) + local folder project, neither auto-included, both mounted when ticked.
- Fixed: plain folder showed "1 file changed · Undo all" before any turn (Undo would have deleted user files); a re-added
  `main` could never checkpoint again; the popover did not name the project.
- Open: removing the Empty workspace (adding a folder via Edit sources) deletes what the agent built there, silently;
  Changes footer shows "detached HEAD · Nothing to commit" for an empty workspace with new files; Copilot rebinding (D-137).
