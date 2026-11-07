# Backlog

Items the owner has parked. Each one says why it waits and what unblocks it.

## B-1 Update notice for unsigned macOS builds (parked 2026-10-12)

**Situation.** macOS builds are ad-hoc signed: there is no Apple Developer account, and the owner won't buy one until demand
justifies the $99/yr. Consequences for a user:

| Moment | macOS (unsigned) | Windows (unsigned) | Linux |
|---|---|---|---|
| First install | Gatekeeper: "Apple could not verify…", so the user goes to System Settings → Privacy & Security → **Open Anyway** (admin password) | SmartScreen: **More info → Run anyway** | no warning |
| Keychain on first launch | none: the app creates "GeneratorAI Safe Storage" itself and owns it | none (DPAPI) | none if gnome-keyring/KWallet is unlocked; else the "GeneratorAI is locked" dialog (U-31) |
| Relaunch, same version | silent | silent | silent |
| New version | **no update is offered**: Squirrel.Mac rejects unsigned updates, so `scripts/lib/build-config.mjs` withholds the `*-mac.yml` manifest and the check fails quietly | auto-download, installs on restart (NSIS); portable `.exe` is manual | AppImage and deb self-update (deb asks for the admin password) |
| After updating | Gatekeeper **Open Anyway** again, then **one** keychain prompt: the new build has a new cdhash, and the keychain partitions items by cdhash for apps without a Team ID. **Always Allow** keeps it quiet until the next version; **Allow** asks on every launch; **Deny** shows the U-31 dialog | silent | silent |

Self-signing does not help: D-142 was tried and withdrawn, because without an Apple-issued Team ID the grant stays tied to
the cdhash.

**The gap.** Mac users are never told a new version exists.

**Proposal (free).** In an unsigned macOS build, skip electron-updater's Mac path and do the following:
- Poll the GitHub Releases feed the build already resolves (`resolveGitHubPublish`) for the channel's latest version, at
  startup and every few hours, plus Help → Check for Updates.
- When it is newer, show a one-line notice: "GeneratorAI X.Y.Z is available".
  - **Download** opens the release's DMG asset in the browser.
  - **What's new** opens the release notes.
- The notice also says: "Quit GeneratorAI, replace it in Applications, then choose **Open Anyway** and **Always Allow**
  once."
- Dismissing hides it until the next version.
- Data (chats, projects, settings, vault) lives in `~/Library/Application Support/@generatorai/desktop`, so replacing the
  app keeps it.

**Unblocks / supersedes.** A Developer ID certificate plus notarization makes this unnecessary. Squirrel.Mac then
auto-updates, the keychain grant follows the Team ID, and there are no prompts at all.

## B-2 Windows/Linux CI desktop smokes (parked 2026-10-03)
They only run in CI, which needs `desktop_redesign` pushed (owner approval).

## B-3 VRT screenshot baselines (parked 2026-10-03)
Web P1-R7 and mobile MV-26 / M10-03. This Mac has no Docker, and keeping VRT is undecided.

## B-4 Scripts, end to end (parked 2026-11-01)
The Scripts page was empty in the owner's app, so its menu entries are hidden: `MENU_DESTINATIONS` in
`packages/shared/src/ui-contract/commands.ts` leaves it out of the sidebar, rail, palette and Home shortcuts. The page
still answers at `/scripts`, and its shortcut (G S, ⇧⌘S, Ctrl+7) still works. To revisit: where scripts come from and why
none were listed, then creating, running and editing one in the app. Then bring the entry back by dropping the filter.

## B-5 Agent cursor on a second display (parked 2026-11-07)
**Situation.** cua-driver draws the computer-use agent cursor in a single overlay window that covers only the main display.
Measured on the owner's Mac: the main display is 1440×900 at (0,0), and a second 2560×1440 monitor sits at (−570,−1440). The
apps the agent drives open on the second monitor, and their cursor positions (y < 0) are never drawn. This holds on 0.38.0 and
on 0.41.2, and the release notes up to 0.41.x mention no multi-display overlay. Actions on the second monitor therefore
show no agent cursor at all.

Already fixed and not part of this item:
- stale cursors, now hidden at turn end (c2638d22);
- effect-heavy motion, now a gentle arc with Fitts timing (9d399491, d8e317a0).

**Options:**
1. A GeneratorAI-drawn overlay: one transparent, click-through, always-on-top window per display in the desktop app. It
   animates the agent cursor with the same motion model, driven by the action targets the bridge already knows, and the
   driver's own cursor is switched off. This needs to work on Windows and Linux too.
2. Report the bug upstream at trycua/cua and wait for a driver fix. That is outward-facing, so it needs the owner's OK.

**How to verify.** Sample the driver's (or the app's) overlay windows with `CGWindowListCopyWindowInfo` while the cursor
moves to a window on each display; this needs no screen-capture permission. Pass when an overlay covers every target
position, on both displays.
