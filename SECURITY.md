# Security Policy

## Project status

GeneratorAI is **alpha** software (`0.0.1-alpha`). It is under active,
breaking development and has not been audited. Do not run it on sensitive
data or expose it to an untrusted network.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability):
open the repository's **Security** tab and choose **Report a vulnerability**.
That form is the only reporting channel; it creates a draft advisory visible
to maintainers alone, and the conversation stays there until a fix ships.

Please include: affected version or commit, reproduction steps, impact, and
any proof-of-concept. We aim to acknowledge within 72 hours and to keep you
updated until the issue is resolved. Credit is given unless you prefer
otherwise.

## Supported versions

Only the latest release on each channel receives fixes. During alpha there
are no backports.

| Channel | Supported |
| ------- | --------- |
| `alpha` (latest) | ✅ |
| Anything older | ❌ |

## Security model

Understanding the intended boundaries makes reports far more actionable.

**The app is loopback-first.** The server binds `127.0.0.1` by default.
Binding a routable interface requires explicitly setting
`GENERATORAI_BIND_HOST`, and doing so forces authentication on.

**Authentication.** Devices pair once, then hold a rotating opaque resume
credential (stored only as a SHA-256 hash). Requests carry short-lived
DPoP-bound access tokens (RFC 9449). Scopes are enforced on REST, SSE and
WebSocket transports.

- Access tokens: 10 minutes
- Session / resume credential: 48 hours by default, sliding — configurable
  via `GENERATORAI_SESSION_TTL_HOURS`
- Pairing grants: 10 minutes, single use

**Host pinning.** Clients pin the server's X25519 identity at pairing time and
refuse to transmit credentials if it changes, which surfaces
machine-in-the-middle attempts.

**Secrets at rest** live in an AES-256-GCM vault. The key-encryption key is
protected by the OS keystore where available (macOS Keychain, Windows DPAPI,
libsecret), or supplied by the operator via `GENERATORAI_SECRET_KEY` /
`GENERATORAI_SECRET_PASSPHRASE`.

### Known accepted risks in alpha

These are understood and deliberate — reports about them are still welcome,
but they are not surprises:

- **Agents execute code.** Running an agent means running arbitrary commands
  on your machine. Sandboxing exists but is opt-in and incomplete.
- **`GENERATORAI_ALLOW_UNAUTHENTICATED_LOOPBACK`** disables authentication.
  It is a development-only escape hatch and refuses to apply outside a
  non-production loopback listener.
- **Unsigned builds.** Alpha binaries may be unsigned, so the OS cannot
  verify their origin. Verify the published checksums.

## Out of scope

- Vulnerabilities requiring an already-compromised local machine or OS account
- Missing hardening headers on the loopback listener with no demonstrated impact
- Automated scanner output with no working proof-of-concept
- Denial of service against your own local instance
