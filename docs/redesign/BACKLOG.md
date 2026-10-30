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
