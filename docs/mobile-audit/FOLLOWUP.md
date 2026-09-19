# Native follow-up audit — 19 September 2026

This extends AUDIT.md using the installed Android release in an Android API-35 emulator (initially visible, then headless with native screenshots after host memory pressure), paired to the isolated port-3111 environment. No source commits or staging. The first audit's platform limitations still apply.

## Findings and changes

- **Short-detent sheet viewport:** reproduced in the review sheet. The card translated downward but its body retained the tallest detent's layout height, leaving the batch footer below the window. Shared sheet padding now excludes that offscreen region, keeping nested scrolling and footers within the visible viewport. Regression cases cover three detents with and without the keyboard and upward overscroll.
- **Overlapping toolbar targets:** compact icon controls used 32-point layout boxes plus expanded hit regions; neighbouring buttons could overlap. They now reserve full platform-minimum layout targets with a smaller visual surface inside. Interactive chips and their remove controls also reserve actual target space.
- **Review editing and preview:** the edit field now has an accessible name. Saving dismisses its keyboard. Preview creation reveals the preview by scrolling the review list, rather than leaving feedback below the current viewport.
- **Native crash:** returning from a submitted review to Chat produced SIGSEGV in the RN renderer's view-tree lookup path. The crash trace is saved at `/tmp/gai-mobile-audit/followup-native-crash.txt`. RN 0.86.2 already includes a root-retention fix behind `fixFindShadowNodeByTagRaceCondition`, disabled by default. An Expo Android config plugin enables that single fix after native loading and before any ReactHost/runtime, delegating every other flag to the configured release-level provider. It is a mitigation for the matching upstream race, not proof that every renderer crash is resolved. Its internal feature-flag API must be reviewed on RN/Expo upgrades; it is not enabled on untested iOS.

The race diagnosis is an inference from the recursive native stack, shadow-tree registry frame and the installed matching RN source. The upstream implementation documents retaining the root for the traversal: [RN 0.86.2 UIManager](https://github.com/react/react-native/blob/v0.86.2/packages/react-native/ReactCommon/react/renderer/uimanager/UIManager.cpp). The app does not switch its entire runtime to canary or experimental settings.

## Native evidence

| Flow | Result |
|---|---|
| Diff → long-press line → comment | Added a note on incident.mjs line 1; server persisted anchor, intent and text. |
| Review reply → resolve → reopen | Reply persisted; resolved state and Reopen action appeared; reopening restored pending actions. |
| Edit review comment | Edited text persisted. |
| Preview → batch send → agent | Preview contained the selected comments. Batch was submitted; Codex acknowledged both notes and made no unnecessary code edits. |
| Return to chat after batch send | Original build crashed. The mitigation build confirmed the flag at startup and subsequent review/chat/menu navigation and cold launches produced no new native crash entries. This is bounded verification, not a universal crash guarantee. |

Only selected screenshots will be copied into the evidence directory. Raw test profiles, pairing credentials and databases remain outside the repository.


## Additional findings from longer native sessions

- **Terminal close reliability:** close previously removed the tab before the host confirmed termination and swallowed errors. It now awaits success, retains the session on failure and displays an error. Shells have numbered labels plus the folder basename, full-size close targets, and a strip that reveals newly created sessions.
- **Project keyboard layout:** adding a repository left only the top of Create project visible above the keyboard. The action now lives in the shared sheet footer, with a tall form detent and independently scrollable fields.
- **Chat recovery:** archive/unarchive and process restart retained the draft. Archived copy now points to the actual Move to active menu action. Reopening a long conversation incorrectly showed its first message; the transcript now uses LegendList's explicit initial-scroll-to-end option (alignment and maintaining the end do not set the initial position).
- **Stale permission card:** approving a command, leaving the chat and returning after completion could leave the old permission card blocking the composer. Successful permission/question responses now settle local stream state immediately. Completed/failed/idle streams do not advertise stale live gates; pending server interactions remain independently recoverable through the interactions query. Three regression cases cover terminal stream states.
- **Provider capability wording:** Codex returned the requested CSV plan in chat and made no edits, but its adapter declares `planMode: false` and maps plan mode to command approvals. It did not publish a dedicated plan-review document. Composer/new-chat/empty-plan copy no longer promises dedicated approval controls for every provider. Implementing a Codex plan gate is separate provider work, not a mobile UI test pass.
- **Attachment removal:** the screenshot capture exposed another 32-point remove control. Attachment chips now reserve platform-minimum control space; the parent does not group away the separate remove action.

| Further native flow | Observed result |
|---|---|
| Fork → rename | Created a distinct chat sharing the source workspace; renamed it to Native follow-up fork. |
| Archive → cold launch → Move to active | API and UI matched; the draft survived archive and restart. Waited for the unarchive response before counting success. |
| Two terminals | Created two real PTYs, switched sessions, entered commands; AUDIT_TWO appeared in the second shell. |
| New project | Created Mobile audit follow-up with its description; invalid repository text displayed validation and disabled creation. |
| Workflow run | Started with Cancellation audit input, paused, resumed, then confirmed cancellation. API states matched; Design completed and later stages were cancelled. |
| Codex Plan first / High | Native Allow resumed a real read-command approval; the final CSV plan appeared in chat, with no code edits and no dedicated plan record. |
| Browser start and preview | Entered the disposable dashboard URL and started the browser from the native UI; a live mobile-sized page appeared. |
| Browser screenshot → Send to chat → agent | A 70 KB PNG appeared in the composer, uploaded successfully, and Sol described the screenshot's four exact summary metrics. |

The shared control sizing follows [Android's minimum 48dp target guidance](https://developer.android.com/guide/topics/ui/accessibility/apps#touch-targets). Full layout targets avoid ambiguity between adjacent toolbar actions. The original Apple/Expo material research and page-by-page inventory remain in [AUDIT.md](AUDIT.md) and [INVENTORY.md](INVENTORY.md).

## Verification ledger

- Mobile suite: **94 files, 1,026 tests passed** after the follow-up changes.
- TypeScript: passed. ESLint: zero errors, two pre-existing warnings.
- Final Android release assembled successfully (1m 30s) and installed with data preserved. Final iOS JavaScript export passed; this does not validate an iOS native build. TypeScript and lint were rerun after the last permission-layout adjustment.
- Native iOS, physical-device capabilities, full screen-reader traversal, relay/network permutations and measured frame pacing remain unverified. The machine has no Xcode/simctl. No amount of Android screenshot or JavaScript testing substitutes for those checks.

A route launch is only entry into a screen. All mutations described as native above were made using the installed app's accessible controls or Android input; backend reads corroborated state. Fixture provisioning and injected failures are separately identified. An early attempt to fail terminal deletion by changing ADB reverse left a keep-alive connection open and the deletion succeeded; it is **not** counted as a failed-close recovery test.

Selected evidence (before/after labels are intentional):

- [Review footer at the short sheet detent](evidence/followup-fixed-review-short.png)
- [Project action clipped by keyboard before the fix](evidence/followup-project-repo.png)
- [Workflow cancelled after pause/resume](evidence/followup-run-cancelled.png)
- [Native browser preview](evidence/followup-browser-live.png)
- [Stale permission card before the fix](evidence/followup-plan-settled.png)


## Final native regression checks

- **Terminal host failure:** a temporary local proxy returned 503 only for terminal DELETE. The UI retained Shell 1 and the host retained the same live PTY. After disabling the fault, the same native close action removed the tab and host session. The proxy was stopped and direct ADB forwarding restored. This is controlled host-error recovery, not certification of LAN/relay transitions.
- **Project footer:** the rebuilt app showed the complete Create project button above the open keyboard with a repository row added. The older clipped-button image above is the baseline.
- **Permission denial:** a fresh Sol/high request to run node --version opened a native permission card. Deny with a reason settled the interaction, cleared the card and let the agent report the command was rejected. It did not execute the command. The denial entry initially exposed excessive command-detail height with the keyboard; that state now prioritises the reason and action controls, with Back restoring full details.
- **Initial transcript position:** the rebuilt chat opened on the latest CSV plan rather than the original greenfield prompt. After a new turn, the explicit new-message jump remained available while reading older content.
- **Light mode / larger text:** changed appearance through the native settings and set Android font scale to 1.3. Workflow title, stage outline and pinned Run action remained usable. Clearing the required feature input and submitting displayed the specific required-field error above the keyboard; no run started. Restored font scale to 1.0 afterwards. This is a focused layout check, not a complete accessibility matrix.

Evidence:

- [Terminal preserved after injected host failure](evidence/followup-terminal-close-failed.png)
- [Terminal close succeeds after recovery](evidence/followup-terminal-close-recovered.png)
- [Project action fully visible above keyboard](evidence/followup-final-project-footer.png)
- [Light theme, 130% text, workflow](evidence/followup-light-large-workflow-settled.png)
- [Required-input validation with keyboard](evidence/followup-required-input-error.png)
- [Permission card cleared after denial](evidence/followup-denied-result.png)

- **Project settings:** native Archive and Restore changed the project status correctly; increasing Maximum codebases from 10 to 11 and Save persisted `settings.maxCodebases: 11`.
- **Review retest:** the accessible editor could be focused and changed above the keyboard; Save dismissed the keyboard and persisted Audit complete. Resolve/reopen worked after waiting for the asynchronous response. Preview automatically revealed its content and Close preview, with the batch action bar visible. The audit note was resolved afterwards.
- [Accessible review editor above keyboard](evidence/followup-review-edit-final.png)
- [Preview automatically brought into view](evidence/followup-review-preview-fixed.png)

Current release gaps remain explicit: native iOS and physical hardware checks; complete TalkBack/VoiceOver traversal; rotation/foldable layouts; long-stream performance measurements; question and dedicated plan gates with a provider that supports them; stop/rewind and worker cancellation/error permutations; all browser navigation actions; terminal clipboard/selection/accessory-key combinations; relay/offline/revocation races; arbitrary workflow/automation authoring and scheduled/webhook fixtures. The audit substantially expands functional evidence, but is not a claim that every possible feature combination has passed.


The final visible-emulator launch also encountered Pixel Launcher and System UI ANR dialogs and a Bluetooth-process abort. Those are Android system processes, distinct from GeneratorAI's renderer crash found earlier. These host/emulator conditions prevent a credible smoothness or frame-pacing conclusion. Native accessibility captures are checked for the current app package and a fresh hierarchy; loading frames, failed captures and system dialogs are not counted as passes.


## Final status and limitations

The last denial-form layout adjustment is **build/type-check verified, but its final native keyboard retest is blocked**. The installed release started successfully and logged the renderer mitigation, but repeated Android System UI ANRs prevented reliable interaction, including after switching back to the headless emulator. The earlier functional Deny-with-reason test passed; that must not be conflated with verification of the final layout adjustment. No GeneratorAI crash was observed in these final attempts; Android's system-process failures are recorded separately.

No source changes were staged or committed. The final source tree passes `git diff --check`. Temporary failure injection is removed. No agent turns, active workflow runs or recurring audit schedules remain. The isolated emulator, port-3111 audit server and port-4179 generated dashboard were stopped to release memory; the user's other services were left alone. Disposable fixtures remain under `/tmp/gai-mobile-audit`, including private credentials/databases that must not be published. Rebuild/restart these fixtures to continue the marked release checks on a machine with adequate emulator resources, and use Xcode or an iOS device for native iOS validation.
