# Remote access over HTTPS

A browser only creates the key a device needs for pairing on a **secure page**: `https://`, or `localhost` on the same machine. `http://192.168.1.20:3100` from another laptop or phone is neither, so pairing a second device needs HTTPS. GeneratorAI provides it in three ways.

| Setup | Use it when | Warning on the other device |
| --- | --- | --- |
| Built-in HTTPS (Network exposure) | Devices on the same Wi-Fi or LAN | Once per device, unless you install the CA |
| Your own certificate | You already have one devices trust: `tailscale cert`, mkcert, a company CA | None |
| A proxy in front (Tailscale Serve, Caddy, nginx) | Access from outside the LAN, or a proxy already terminates TLS | None with a publicly trusted certificate |

## Built-in HTTPS

Turn on **Settings › Security & devices › Network exposure › LAN**. The desktop app restarts its server. From then on:

- The server listens on all interfaces. Its port answers **HTTPS** for other devices and keeps plain HTTP for this computer, so the desktop window and the local CLI are unchanged.
- On first use the server creates a **local certificate authority (CA)** for this installation. That CA issues a certificate for this computer's LAN addresses, `<hostname>.local`, `localhost`, and `127.0.0.1`. The private keys are stored in the encrypted vault, not as files.
- When the computer joins another network, the server issues a new certificate for the new addresses. It also renews the certificate 30 days before it expires. The CA does not change, so a CA you installed keeps working.
- Browsers on other devices are sent to `https://`. A plain-HTTP page request is redirected. A plain-HTTP browser API call is refused with `HTTPS_REQUIRED`.

The CA can only vouch for private addresses, `.local` names and `localhost` (X.509 name constraints). Installing it on a device does not let it vouch for any public website.

### Pair a laptop or phone browser

1. On the computer running GeneratorAI, open **Settings › Security & devices**. Under **Network exposure**, check the `https://` address and the **HTTPS certificate** fingerprint.
2. Under **Pair a new device**, choose **Web browser** and **Generate pairing code**.
3. On the other device, open the `https://…` address shown in step 1 of the pairing panel.
4. The browser warns that the connection is not private, because no public authority signed the certificate. Open the certificate details:
   - **Chrome or Edge:** click **Not secure**, then **Certificate details**.
   - **Safari:** click **Show Details**, then **view the certificate**.
   - **Firefox:** click **Advanced**, then **View Certificate**.

   Check that the **SHA-256 fingerprint** begins with the bytes shown on the computer, for example `3F A9 1C 07 88 2B D4 E1`. If it does not match, stop: something between the two devices is impersonating the computer.
5. Accept the warning, then type the 12-character code. Check the server name and permissions, and click **Connect**.

### Remove the warning on a device you own

Click **Download certificate authority** under the certificate details, or open `https://<address>/api/auth/tls/ca.crt` on the device. Then trust the certificate:

- **macOS:** open it in Keychain Access and set **Trust › When using this certificate** to **Always Trust**.
- **iOS / iPadOS:** install the profile, then turn it on in **Settings › General › About › Certificate Trust Settings**.
- **Android:** **Settings › Security › Encryption & credentials › Install a certificate › CA certificate**.
- **Windows:** open it and choose **Install Certificate › Local Machine › Trusted Root Certification Authorities**.
- **Linux (Chrome):** **Settings › Privacy and security › Security › Manage certificates › Authorities › Import**.

### The mobile app

The GeneratorAI mobile app uses HTTPS on the LAN too, with nothing to install. The pairing QR carries the fingerprint of this computer's local CA (and of a standby CA for a future rotation). The app trusts exactly that CA for the server's LAN addresses and nothing else, for every request, live stream and WebSocket. It never sends plain HTTP to another device, and the server refuses plain HTTP from other devices.

- If you type the code instead of scanning the QR, the app reads the certificate the server presents and shows its fingerprint. Check that it matches the fingerprint in **Settings › Security & devices** on this computer before you tap **Pair**.
- If the app says **This server's identity changed — pair again**, the server presented a certificate from a different CA. That is expected after you reinstall GeneratorAI or switch to your own certificate. Otherwise, something on the network may be impersonating your server.
- A phone paired before this change shows **Pair again for an encrypted connection**. Pair it again with a new code.
- A command-line or MCP client on another computer also needs HTTPS: use **Connect with Tailscale**, or point Node at the CA with `NODE_EXTRA_CA_CERTS=<path to ca.crt>`.

## Use your own certificate

**Settings › Security & devices › HTTPS certificate › Use your own certificate…** accepts a PEM certificate and its private key. You can paste them or load the files. The certificate file can contain a chain in any order.

The server stores them only if all of these are true:

- The private key belongs to the certificate, and it has no passphrase. The server restarts unattended, so nobody can type one.
- It is a server certificate, not a CA certificate, and it is valid now.
- It names this computer. It must cover a LAN address, `<hostname>.local`, `localhost`, a `GENERATORAI_ADVERTISED_URL` host, or a DNS name whose first label is this computer's hostname.

If it fails a check, the error message lists the names the certificate covers. The key is stored in the encrypted vault. **Use the generated certificate** switches back.

```bash
# Tailscale: a publicly trusted certificate for <machine>.<tailnet>.ts.net
tailscale cert sids-macbook.tail1234.ts.net

# mkcert: trusted on every device where you ran `mkcert -install`
mkcert sids-macbook.local 192.168.1.20 localhost
```

A `tailscale cert` name is advertised as an extra `https://` address in the pairing QR. Devices on the same tailnet can use it with no warning. Tailscale certificates last 90 days. Load the renewed certificate before the old one expires. When a custom certificate expires, the server shows the reason and serves its generated certificate instead.

## Behind a proxy

When a proxy terminates TLS, GeneratorAI receives plain HTTP from the proxy. The proxy's `X-Forwarded-Proto` and `X-Forwarded-Host` headers give the scheme and host the browser used. The server needs both to check each request's DPoP proof, which is bound to that URL. A forged header could change what a proof is checked against, so the server ignores these headers unless you name the proxy:

| `GENERATORAI_TRUST_PROXY` | Trusted |
| --- | --- |
| unset, `0` | Nobody (default) |
| `1`, `true`, `loopback` | A proxy on the same machine that forwards to `127.0.0.1` |
| `10.0.0.5,10.0.0.6` | Exactly these proxy addresses |

Also set `GENERATORAI_ADVERTISED_URL` to the public address. Pairing offers then include it, and the browser's `Origin` is allowed.

### Tailscale Serve

Keep GeneratorAI loopback-only (**Network exposure › Loopback only**) and let Tailscale publish it on your tailnet with a trusted certificate:

```bash
# On the GeneratorAI machine. The desktop app picks a free port unless `serverPort`
# is set in its settings.json; use that port here.
tailscale serve --bg --https=443 http://127.0.0.1:3100

# In the server's environment (apps/server/.env for a standalone server)
GENERATORAI_TRUST_PROXY=loopback
GENERATORAI_ADVERTISED_URL=https://sids-macbook.tail1234.ts.net
```

Open `https://sids-macbook.tail1234.ts.net` on any device on the tailnet and pair as usual.

### Caddy or nginx

```text
# Caddyfile
generatorai.example.com {
    reverse_proxy 127.0.0.1:3100
}
```

```nginx
location / {
    proxy_pass http://127.0.0.1:3100;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;      # terminal, browser and voice streams
    proxy_set_header Connection "upgrade";
    proxy_buffering off;                          # live event stream
}
```

Caddy sets the forwarded headers itself. Use `GENERATORAI_TRUST_PROXY=loopback` when the proxy runs on the same machine. When it runs on another machine, use its IP address. A request that arrives through a proxy never counts as local, even when the proxy forwards to loopback.

## Names the server answers to

To stop DNS rebinding, every request must address the server by a name it owns. A web page cannot otherwise reach a local server, but it can point its own DNS name at `127.0.0.1` and send same-origin requests. The server answers to:

- any IP address, `localhost` and `*.localhost`;
- the computer's hostname and `<hostname>.local`. With Network exposure on, it also answers to the hostname in any zone, such as `<hostname>.lan` or `<hostname>.<tailnet>.ts.net`;
- the hosts in `GENERATORAI_ADVERTISED_URL(S)` and the DNS names of the certificate it serves;
- requests from a proxy named in `GENERATORAI_TRUST_PROXY`.

Any other name gets `421 HOST_NOT_ALLOWED`. To add names, list them in `GENERATORAI_ALLOWED_HOSTS`, separated by commas. A leading dot allows every name under a domain, as in `.home.arpa`. `*` turns the check off.

## Reference

- `GENERATORAI_LAN_TLS=0`: an exposed server speaks plain HTTP only. Use it only when something else terminates TLS. Browsers on other devices cannot pair without HTTPS.
- `GET /api/auth/server-info` and `GET /api/security/network-access` return `tls`: the certificate fingerprint, the CA fingerprint, the covered names and the expiry date.
- Decisions: D-110 to D-114 and D-119 in the redesign decision log.
