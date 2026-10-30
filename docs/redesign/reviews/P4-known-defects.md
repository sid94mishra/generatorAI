# Known chat-workspace defects pinned by P4-01 (fix in P4)

Recorded as `it.fails` in `apps/web/src/__tests__/characterization/` on `desktop_redesign @ 7b4d04e`. Fixing one flips its test on purpose — convert it to a normal `it` in the same commit.

| # | Defect | Where (legacy file) | Fix in |
|---|---|---|---|
| 1 | Enter during IME composition sends | `ChatInput.tsx:1299-1311` | **Fixed in P4-02** (`useComposerKeymap`) |
| 2 | Bare "scratch that" dropped with a streaming STT engine | `ChatInput.tsx:985-993, 1046-1072` | **Fixed in P4-02** (`useDictation`) |
| 3 | …and inserted as text with a non-streaming engine | `ChatInput.tsx:1149-1153` | **Fixed in P4-02** (`useDictation`) |
| 4 | Inspect picks never attach: panel reads `payload.data`, stream delivers `{kind,payload}` | `BrowserPanel.tsx:472-487` | **Fixed P4-03** (`blocks/browser/browserEvents.ts` reads `payload`, then `data`) |
| 5 | `HTTP://x` → `https://HTTP://x` (case-sensitive scheme check) | `BrowserPanel.tsx:652` | **Fixed P4-03** (`normaliseBrowserUrl`, one case-insensitive check) |
| 6 | Restricted-mode URL pill shows internal `#gai-` URL | `BrowserPanel.tsx:1605` | **Fixed P4-03** (`displayBrowserUrl`) |
| 7 | Keep/Undo may target the wrong file: mount alias stripped from an already repo-relative path | `ChangesSurface.tsx:869, 898, 915` | **Fixed in P4-04** (`blocks/changes/useFileActions.ts`, `useKeptFiles.ts`: the summary path is sent as-is; `toRestorePath` deleted) |
| 8 | Mount-group click can lose its scroll | `ChangesSurface.tsx:1533-1534` | **Fixed in P4-04** (`blocks/changes/useChangesNavigation.ts`: a scroll request always commits a render) |
| 9 | Focusing a comment on a kept file does not open the Kept group | `ChangesSurface.tsx:706-717` | **Fixed in P4-04** (jump-to-thread, `focusFile` and tree clicks share `reveal`) |

Discrepancies between `09` §5 and the code (tests pin the code, `// DISCREPANCY`): dictation click-pause, restricted-mode Share toggle, NativeBrowserView first-tick `setActiveTab`, browser auto-start race at mount (`BrowserPanel.tsx:588-600`), auto-open visibility rule on mount vs SSE (`ChatPage.tsx:757` vs `781`), widget re-render refocus (`ChatPage.tsx:847`), Compare-against cap over the whole list (`ChangesSurface.tsx:393`), "Generating response..." ellipsis. Decide each in the P4 view PRs.

Resolved in P4-04: **new review threads used the first mount's base/head** (`ChangesSurface.tsx:623-624`) — confirmed a defect against the server: a checkpoint id belongs to one mount and `ChangeSummaryService.resolveRevision` resolves an id from another mount as that mount's baseline, so `readPatchSince` re-anchored threads on every mount but the first against the session start. Threads now take their own mount's `repos[].base/head` ids (`blocks/changes/useReviewOverlay.ts`); the pinned test was changed on purpose to assert the mount's own ids.
