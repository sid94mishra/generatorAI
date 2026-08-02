# GeneratorAI — Access & Login Guide

**Audience:** Users of the desktop app, web UI and CLI
**Date:** 2026-08-02
**Related:** [SECURITY_AUTH_RELAY_IMPLEMENTATION.md](./SECURITY_AUTH_RELAY_IMPLEMENTATION.md) (the as-built technical reference)

This guide covers **how you get into the application** on each client, and
**what you will not be able to do** depending on the permissions your device was
granted.

---

## 1. The Mental Model (read this first)

**There is no username or password.** GeneratorAI authenticates *devices*, not
people.

Each client — a browser, the desktop app, a CLI installation — generates its
**own cryptographic key** that never leaves it. You authorise that key once by
pairing, and from then on every request is signed by it.

What that means in practice:

| | |
|---|---|
| No password to type | You pair once per device, then it just works |
| No password to steal | A stolen token is useless without the key |
| Every device is separate | Revoking your phone does not log out your laptop |
| Access is scoped | A device only gets the permissions you granted it |

**To pair a new device you need an already-connected device** to generate the
code. The chicken-and-egg problem is solved by *bootstrap* (scenario 2 below).

---

## 2. Scenario Matrix — Every Way In

| # | Situation | How you get in | Effort |
|---|---|---|---|
| 1 | **Desktop app**, first launch | Nothing — it pairs itself | Zero |
| 2 | **Very first run ever**, headless/web | Bootstrap code printed in the server log | Copy-paste |
| 3 | **New browser**, you have another device | Generate QR in Settings → Security, scan/paste | 30 sec |
| 4 | **New CLI**, you have another device | `device invite` → `device pair <code>` | 30 sec |
| 5 | **Local dev**, you want no auth at all | `GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK=1` | Env var |
| 6 | **Legacy setup** already using an API key | `GENERATORAI_API_KEY` still works (deprecated) | Nothing |
| 7 | **CI / automation** | `device invite --platform cli --json` | Scripted |
| 8 | **Off-network** (café, mobile data) | Pair with `--relay`, connects via relay | One-time |
| 9 | **Device lost/stolen** | Revoke from any trusted device | 1 click |

---

## 3. Client — Desktop App

### Starting it

```console
# From the repo
cd apps/desktop
pnpm start           # builds, then launches Electron (standalone: spawns its own server)

# Or against an already-running dev server
pnpm dev
```

### Logging in

**You don't.** Sequence on launch:

1. Electron unlocks a vault key via your OS keystore (Keychain / DPAPI / libsecret)
2. Starts the server with that key
3. Renderer asks the shell for a pairing code over a loopback-only channel
   guarded by a per-launch token
4. Generates a **non-extractable** key in IndexedDB and enrols itself

> **You see:** the Dashboard. No QR, no password, about two seconds.

**Why this is safe:** the app that *started* the server does not need to prove
anything to it. The handshake token is regenerated every launch and is never
written to disk.

### What the desktop can do

**Everything.** It receives `ALL_SCOPES` — terminal, browser control, device
management, harness switching.

### If it *does* show a pairing screen

That means the shell could not reach its own server. Check the log for
`Embedded server failed to start`.

---

## 4. Client — Web UI

### Starting it

```console
pnpm start:web        # server (:3100) + web dev server (:5173)
```

Then open `http://localhost:5173`.

### Login path A — Server allows unauthenticated loopback (dev only)

```console
$env:GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK="1"
pnpm start:web
```

Straight to the Dashboard. The Security panel will show a **critical warning**:

> ⚠ Authentication is disabled. Every request has full authority.

This is **refused at startup** if you bind off-loopback or set
`NODE_ENV=production` — the server will not listen.

### Login path B — First ever run (bootstrap)

The server prints:

```
[Auth] This server has no paired device yet. Pair one within 15 minutes:
  generatorai://pair?code=eyJ2IjoxLCJlbmRwb2ludCI6...
  (also written to <dataDir>/bootstrap-pairing.json, readable only by this user)
```

Paste that into the pairing screen. It grants **full scopes** — this device is
the machine owner. The file is deleted the moment you pair.

> Skipped automatically when the desktop shell is running, or when
> `GENERATORAI_API_KEY` is set.

### Login path C — Normal pairing (you have another device)

**On the connected device:** Settings → **Security & Devices** → pick a preset
→ **Generate pairing code**

**On the new browser:**

```
┌─────────────────────────────────────────────────┐
│  🛡  Pair this device                            │
│     Open Settings → Security on a device that   │
│     is already connected and generate a code.   │
│                                                 │
│  Pairing code or link                           │
│  ┌───────────────────────────────────────────┐  │
│  │ generatorai://pair?code=…                 │  │
│  └───────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

Paste it, and it expands into an **informed-consent panel**:

```
You are about to connect to:
  Server         UI-5CG4400GH2
  Endpoint       http://192.168.1.40:3100
  Host identity  nshHUplY…HbLiwzw    ← compare this

This device will be granted:
  read:chats  write:chats  exec:agent  stream:events …

Name this device: [ Chrome on Windows ]

              [ → Connect ]

A pairing code is single-use and expires in 10 minutes.
Your device generates its own key, which never leaves this browser.
```

**Compare the host identity fingerprint** to the one shown on the generating
device. That is your defence against someone impersonating the server on your
LAN.

### Deep links

`?pair=<code>` in the URL auto-fills the field, then **strips itself from the
address bar** so the code never lands in browser history or sync.

### Choosing a preset

| Preset | What it grants | Use for |
|---|---|---|
| **Recommended for platform** | Server picks least-privilege for the device type | Default choice |
| **Read only** | View projects, chats, workflows, diffs. Run nothing. | A dashboard on a TV, a reviewer |
| **Mobile companion** | Read + chat + approve + review | Phone, tablet |
| **Full workstation** | Everything except admin — including terminal and browser | Your own laptop |

---

## 5. Client — CLI

### Installing / running

```console
# From the repo (dev)
pnpm start:cli -- device status

# Or after building
generatorai device status
```

### Global connection flags

| Flag | Purpose | Default |
|---|---|---|
| `--server <url>` | Which server to talk to | `http://localhost:3100` |
| `--local` | Run in-process, **no server at all** | off |
| `--api-key <key>` | Legacy shared key | — |
| `--config-profile <name>` | Named profile (separate identity) | — |
| `--json` | Machine-readable output | off |
| `--verbose` | Verbose output | off |
| `--no-color` | Disable colour | off |

### Logging in

**Step 1 — get a code** (on a device that is already connected):

```console
$ generatorai device invite --name "CI runner" --platform cli

  Pairing code

generatorai://pair?code=eyJ2IjoxLCJlbmRwb2ludCI6…

  scopes   read:chats, write:chats, exec:agent, exec:terminal, …
  expires  in 10 minutes (single use)

  Anyone who sees this code can pair a device with those scopes.
  Do not paste it into a chat or a shared terminal.
```

**Step 2 — pair:**

```console
$ generatorai device pair "generatorai://pair?code=…"

  Pairing with
    server    UI-5CG4400GH2
    endpoint  http://127.0.0.1:3100
    identity  nshHUplY_yXccZ6Tj0XOjAOec3LHm25kqf7VHbLiwzw
    scopes    read:chats, write:chats, exec:agent, exec:terminal

  ✓ Paired as "CI runner"
    device b6f68e2d-28f8-4962-b684-4c3cafd6a02c
```

**Step 3 — verify:**

```console
$ generatorai device status

  CLI credential
  ────────────────────────────────────────────────
  Server:        http://127.0.0.1:3100
  Status:        authenticated
  Device:        b6f68e2d-28f8-4962-b684-4c3cafd6a02c
  Scopes:        read:chats, write:chats, exec:agent, …
  Secret store:  encrypted-file/local-file-key

  ⚠ Key-encryption key is stored in a mode-0600 file. Any process running
    as this OS user can read it. Set GENERATORAI_SECRET_KEY, or run inside
    the desktop shell, to use an OS-protected key.
```

That warning is deliberate — the CLI reports the truth about its own weakness
rather than implying it is safer than it is. To resolve it, set
`GENERATORAI_SECRET_KEY` to a 32-byte base64 value.

### All device commands

| Command | Does |
|---|---|
| `device pair <code> [--name]` | Pair this CLI |
| `device status` | Show credential + where secrets live |
| `device forget` | Delete local credential (does **not** revoke server-side) |
| `device list [--all]` | List every paired device |
| `device revoke <deviceId>` | Kill a device immediately |
| `device invite [--name --platform --scopes --relay]` | Mint a pairing code |
| `device audit [--limit 50]` | Recent security events |

### CI / automation pattern

```console
$ CODE=$(generatorai device invite --platform cli --json | jq -r .pairingUrl)
$ generatorai device pair "$CODE"
```

Use `GENERATORAI_CONFIG_DIR=/tmp/ci-identity` to keep the CI identity isolated
from your own.

### Offline mode

```console
$ generatorai --local chat list
```

Runs the engine in-process. **No server, no pairing, no network.** Useful for
scripting against a local database.

---

## 6. What You Will NOT Be Able To See

Scopes are not cosmetic — the server enforces them, so a missing scope means the
API returns **403** and that part of the UI genuinely does not work.

### Feature → required scope

| Feature | Needs | Blocked message |
|---|---|---|
| View chats | `read:chats` | — |
| **Send a prompt** | `write:chats` | 403 INSUFFICIENT_SCOPE |
| **Voice input (STT)** | `write:chats` | Voice input is not permitted for this device |
| View workflows | `read:workflows` | — |
| **Create/edit workflow** | `write:workflows` | 403 |
| **Run a workflow** | `write:workflows` + `exec:agent` | 403 |
| **Approve a stage** | `exec:agent` | 403 |
| View projects | `read:projects` | — |
| **Create project** | `write:projects` | 403 |
| **Terminal panel** | `exec:terminal` ⚠ | This device is not allowed to open terminals |
| **Browser panel** | `exec:browser` ⚠ | Falls back to degraded polling, then fails |
| **Switch AI provider** | `admin:harnesses` ⚠ | 403 |
| **Install extensions** | `admin:settings` ⚠ | 403 |
| **Security & Devices panel** | `admin:devices` ⚠ | This device does not have permission to manage security settings |
| **Relay settings** | `admin:relay` ⚠ | 403 |

⚠ = high-risk; a denial is audited at `critical` severity.

### What each preset blocks

| | Read only | Mobile companion | Full workstation | Desktop / bootstrap |
|---|:---:|:---:|:---:|:---:|
| Browse chats, workflows, projects | ✅ | ✅ | ✅ | ✅ |
| Live event streaming | ✅ | ✅ | ✅ | ✅ |
| View diffs & reviews | ✅ | ✅ | ✅ | ✅ |
| Send prompts | ❌ | ✅ | ✅ | ✅ |
| Approve agent gates | ❌ | ✅ | ✅ | ✅ |
| Create/edit workflows | ❌ | ❌ | ✅ | ✅ |
| Create projects/workspaces | ❌ | ❌ | ✅ | ✅ |
| **Terminal** | ❌ | ❌ | ✅ | ✅ |
| **Browser control** | ❌ | ❌ | ✅ | ✅ |
| **Manage devices** | ❌ | ❌ | ❌ | ✅ |
| **Switch AI provider** | ❌ | ❌ | ❌ | ✅ |
| **Install extensions** | ❌ | ❌ | ❌ | ✅ |

> **Known rough edge:** the UI does not currently grey out blocked buttons — you
> will click and get an error. The Security panel is the exception; it explains
> the problem clearly.

### Platform defaults (when you pick "Recommended")

| Platform | Gets | Notably excludes |
|---|---|---|
| `web`, `desktop`, `other` | Read all, write chats/workflows/reviews, `exec:agent` | terminal, browser, admin |
| `mobile` | Same, **minus** `write:workflows` | terminal, browser, admin |
| `cli` | Device defaults **plus** write projects/workspaces/files, `exec:terminal` | browser, admin |

---

## 7. Error States

| What you see | Means | Fix |
|---|---|---|
| **"Pair this device"** | No credential yet | Get a pairing code |
| **"This device was revoked"** | Someone revoked you | Pair again |
| **"That pairing code is not valid"** | Malformed/truncated | Re-copy the whole code |
| **"Pairing code has already been used"** | Single-use, consumed | Generate a new one |
| **"Pairing code has expired"** | More than 10 min old | Generate a new one |
| **"Too many pairing attempts"** | Rate-limited | Wait a moment |
| **"Too many attempts for this pairing code"** | Brute-force guard tripped | Generate a new one |
| **"The server at this address is not the one this device paired with"** | ⚠ **Host identity changed** | Either the server was reinstalled, **or something is impersonating it.** Re-pair only if you expected this. |
| **Spinner that never resolves** | Server unreachable | Check the server is running |
| **403 INSUFFICIENT_SCOPE** | Missing permission | Re-pair with a wider preset |

---

## 8. Day-2 Operations

### Adding a second device
Settings → Security & Devices → preset → **Generate pairing code** → scan/paste.

### Seeing who has access
The Security panel lists every device with its platform, last-seen time, key
fingerprint, and colour-coded scopes (red = admin, amber = exec).

### Revoking
Click **Revoke**, or `generatorai device revoke <id>`. Effects:

- Local registry: **immediately**
- Live relay streams for that device: killed
- Relay offline: queued in a durable outbox, delivered on reconnect

Other devices are unaffected.

### Reviewing activity

```console
$ generatorai device audit --limit 20
```

Shows pairing, revocations, scope denials and credential rotations — with actor
and reason, and **no secret values**.

---

## 9. Quick Reference

```console
# Start everything (web)
pnpm start:web                                    # → http://localhost:5173

# Start desktop
cd apps/desktop && pnpm start

# Dev mode, no auth
$env:GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK="1"; pnpm start:web

# CLI: check, invite, pair
generatorai device status
generatorai device invite --name "Laptop" --platform web
generatorai device pair "generatorai://pair?code=…"

# CLI against a remote server
generatorai --server http://192.168.1.40:3100 device status

# CLI with no server at all
generatorai --local chat list
```

### Environment variables that affect access

| Variable | Effect |
|---|---|
| `GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK=1` | Dev-only; disables auth on loopback. Refused off-loopback or in production. |
| `GENERATORAI_API_KEY` | Legacy shared key. Still works, warns on use, skips bootstrap pairing. |
| `GENERATORAI_SECRET_KEY` | 32-byte base64 vault key. Removes the CLI's "mode-0600 file" warning. |
| `GENERATORAI_CONFIG_DIR` | Moves the CLI's config **and credential vault** — use for isolated CI identities. |
| `GENERATORAI_BIND_HOST` | Listener address. Anything non-loopback forces authentication on. |
| `GENERATORAI_ADVERTISED_URL` | The endpoint written into pairing offers. Set this when pairing across a LAN. |
