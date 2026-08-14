// ────────────────────────────────────────────────────────────────
// computerUseBlocklist — data for the apps the agent may never drive.
//
// Matching logic lives in `utils/computerUseBlocklist.ts`, mirroring the
// existing `constants` / `utils/hostMatcher.ts` split. This file is data only.
//
// The lists are enforced inside APP RESOLUTION, not at the tool boundary, so
// no addressing path (name, bundle id, pid, window id) can reach a blocked
// app. This is the single most important safety control in the feature and
// deliberately errs toward over-blocking.
//
// Categories, each blocked for a different reason:
//
//   credentials  — a11y trees expose vault and 2FA contents as plain text.
//   terminals    — driving a shell would route around `shell_exec` gating.
//   selfControl  — the agent could approve its own consent dialogs.
//   osSecurity   — OS auth/permission prompts must stay human-only.
//   remoteAccess — a remote session is someone else's machine entirely.
//
// KNOWN LIMIT: the terminal category is best-effort. Any app that embeds a
// terminal (VS Code, Cursor, JetBrains, Task Manager's "Run new task") offers
// the same shell access under a different name. `shell_exec` gating must NOT
// be assumed intact while computer use is enabled — the blocklist raises the
// cost of that path, it does not close it.
//
// Frozen at module load: an in-process extension or `function` hook could
// otherwise empty these arrays and disarm the control.
// ────────────────────────────────────────────────────────────────

/** Our own identity — see `apps/desktop/scripts/lib/build-config.mjs`. */
export const SELF_BUNDLE_IDS: readonly string[] = Object.freeze([
  'ai.generatorai.desktop',
]);

export const SELF_NAME_FRAGMENTS: readonly string[] = Object.freeze([
  'generatorai',
  'generator ai',
]);

export const SELF_EXECUTABLES: readonly string[] = Object.freeze([
  'generatorai',
]);

/**
 * macOS bundle identifiers plus Windows AUMIDs for packaged apps. Unspoofable
 * by a renamed binary, so this is the strongest matcher available.
 */
export const BLOCKED_BUNDLE_IDS: readonly string[] = Object.freeze([
  ...SELF_BUNDLE_IDS,
  // ── credentials ──
  'com.1password.1password',
  'com.1password.1password7',
  'com.1password.safari',
  'com.agilebits.onepassword',
  'com.agilebits.onepassword7',
  'com.bitwarden.desktop',
  'com.dashlane.dashlanephonefinal',
  'com.lastpass.lastpass',
  'com.lastpass.lastpassmacdesktop',
  'com.nordsec.nordpass',
  'me.proton.pass.electron',
  'me.proton.pass.catalyst',
  'com.callpod.keeperdesktop',
  'com.siber.roboform',
  'in.sinew.enpass-desktop',
  'com.keepassium.keepassium',
  'org.keepassxc.keepassxc',
  'com.apple.keychainaccess',
  'com.apple.passwords',
  // ── 2FA / authenticators ──
  'com.authy.authy-mac',
  'com.duosecurity.duomobile',
  'com.okta.verify',
  'com.yubico.authenticator',
  // ── crypto wallets ──
  'com.ledger.live',
  'com.exodus.exodusmovement',
  'com.trezor.suite',
  // ── terminals ──
  'com.apple.terminal',
  'com.googlecode.iterm2',
  'com.mitchellh.ghostty',
  'co.zeit.hyper',
  'net.kovidgoyal.kitty',
  'com.github.wez.wezterm',
  'io.alacritty',
  'dev.warp.warp-stable',
  'com.tabby.app',
  'com.termius.mac',
  // ── remote access ──
  'com.apple.screensharing',
  'com.teamviewer.teamviewer',
  'com.philandro.anydesk',
  'com.realvnc.vncviewer',
  // ── vpn ──
  'com.paloaltonetworks.globalprotect',
  'com.cisco.anyconnect.gui',
  'com.wireguard.macos',
  'io.tailscale.ipn.macos',
  // ── disk encryption ──
  'org.idrix.veracrypt',
  // ── os security ──
  'com.apple.systempreferences',
  'com.apple.systemsettings',
  'com.apple.securityagent',
  'com.apple.systemuiserver',
]);

/**
 * Substrings matched case-insensitively against the app name, the app id, the
 * executable basename AND every window title. Window titles matter because a
 * password manager's browser-extension popup or an unlock sheet can surface
 * under a host process whose own name is innocuous.
 */
export const BLOCKED_NAME_FRAGMENTS: readonly string[] = Object.freeze([
  ...SELF_NAME_FRAGMENTS,
  // ── credentials ──
  '1password',
  'bitwarden',
  'dashlane',
  'lastpass',
  'nordpass',
  'proton pass',
  'keepass',
  'keeper password',
  'roboform',
  'enpass',
  'keychain access',
  'seahorse',
  'gnome-keyring',
  'credential manager',
  'password vault',
  'password manager',
  // ── 2FA / authenticators ──
  'authy',
  'authenticator',
  'okta verify',
  'duo mobile',
  // ── crypto wallets ──
  'ledger live',
  'trezor',
  'exodus wallet',
  'metamask',
  // ── terminals ──
  'terminal',
  'iterm',
  'ghostty',
  'powershell',
  'command prompt',
  'conhost',
  'alacritty',
  'wezterm',
  'konsole',
  'xterm',
  'urxvt',
  'tilix',
  'terminator',
  'mintty',
  'putty',
  'termius',
  'mobaxterm',
  'tabby',
  // ── remote access ──
  'remote desktop',
  'screen sharing',
  'windows 365',
  'azure virtual desktop',
  'teamviewer',
  'anydesk',
  'vnc viewer',
  'realvnc',
  // ── vpn ──
  'globalprotect',
  'anyconnect',
  'wireguard',
  'tailscale',
  // ── disk encryption ──
  'veracrypt',
  'bitlocker',
  'filevault',
  // ── os security ──
  'user account control',
  'system settings',
  'system preferences',
  'privacy & security',
  'windows security',
  'secure desktop',
  'authentication required',
  'administrator: ',
  'polkit',
  'sudo password',
  'registry editor',
  'task manager',
]);

/**
 * Short, generic fragments that would produce absurd false positives as
 * substrings — 'warp' matches "Warp Drive.psd", 'kitty' matches "kitty.jpg".
 * These are matched on word boundaries instead.
 */
export const BLOCKED_WORD_FRAGMENTS: readonly string[] = Object.freeze([
  'warp',
  'kitty',
  'hyper',
  'wsl',
  'sudo',
  'runas',
]);

/**
 * Executable basenames. A trailing `.exe` is stripped from both sides before
 * comparison, so `pwsh` and `pwsh.exe` are one entry and POSIX binaries with
 * no extension still match.
 */
export const BLOCKED_EXECUTABLES: readonly string[] = Object.freeze([
  ...SELF_EXECUTABLES,
  // ── credentials ──
  '1password',
  'bitwarden',
  'dashlane',
  'lastpass',
  'nordpass',
  'keepass',
  'keepass2',
  'keepassxc',
  'keeper',
  'proton pass',
  // ── terminals / shells ──
  'cmd',
  'powershell',
  'powershell_ise',
  'pwsh',
  'windowsterminal',
  'wt',
  'conhost',
  'wsl',
  'bash',
  'sh',
  'zsh',
  'fish',
  'mintty',
  'putty',
  'cscript',
  'wscript',
  'gnome-terminal',
  'xfce4-terminal',
  'konsole',
  'xterm',
  'alacritty',
  'wezterm',
  'kitty',
  'ghostty',
  'iterm2',
  'hyper',
  'warp',
  // ── os security ──
  'consent',
  'lsass',
  'credentialuibroker',
  'logonui',
  'runas',
  'regedit',
  'taskmgr',
  'mmc',
  'manage-bde',
  // ── remote access ──
  'mstsc',
  // Windows 365 / AVD client. Reports itself only as `msrdc.exe` with no
  // bundle id, so the name fragments never see it — found in a live app list.
  'msrdc',
  'msrdcw',
  'teamviewer',
  'anydesk',
  'vncviewer',
]);
