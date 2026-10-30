// ────────────────────────────────────────────────────────────────
// Plays tailscaled for the "Connect with Tailscale" tests (D-123, D-124).
//
// `tailscale serve --https=443 http://127.0.0.1:<port>` terminates TLS for
// `<machine>.<tailnet>.ts.net` and reverse-proxies to the target. This does
// the same, with the headers the real one sets (tailscale ipn/ipnlocal
// serve.go: `r.Out.Host = r.In.Host`, `X-Forwarded-Host` = Host,
// `X-Forwarded-Proto: https`, `X-Forwarded-For` = the tailnet peer, the
// `Tailscale-User-*` identity headers; client-sent copies removed), streams
// SSE unbuffered and passes WebSocket upgrades through.
//
// The certificate comes from a throwaway test CA made here (no name
// constraints, so it can name a public `*.ts.net` host). Browsers trust it
// only through `--ignore-certificate-errors-spki-list` for this leaf — never
// the system store. The target is read from the fake CLI's state file on
// every request, exactly as tailscaled reads its serve config.
// ────────────────────────────────────────────────────────────────

import { createHash, X509Certificate, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const requireFromServer = createRequire(path.join(REPO_ROOT, 'apps', 'server', 'package.json'));

/** Fake tailnet address of "the other device" (tailscale sets the real peer's 100.x). */
export const TAILNET_PEER = '100.64.0.2';

const STRIPPED = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'tailscale-user-login', 'tailscale-user-name', 'tailscale-user-profile-pic', 'tailscale-headers-info'];

/** A test CA and a leaf for `dnsName`, as PEM, plus the leaf's SPKI hash for Chromium. */
export async function makeTestCertificates(dnsName) {
  requireFromServer('reflect-metadata');
  const x509 = requireFromServer('@peculiar/x509');
  x509.cryptoProvider.set(webcrypto);
  const alg = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' };
  const now = new Date(Date.now() - 60_000);
  const later = new Date(Date.now() + 7 * 24 * 3600_000);
  const caKeys = await webcrypto.subtle.generateKey(alg, true, ['sign', 'verify']);
  const ca = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=GeneratorAI fake Tailscale test CA',
    notBefore: now,
    notAfter: later,
    keys: caKeys,
    signingAlgorithm: alg,
    extensions: [new x509.BasicConstraintsExtension(true, 0, true), new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign, true)],
  });
  const leafKeys = await webcrypto.subtle.generateKey(alg, true, ['sign', 'verify']);
  const leaf = await x509.X509CertificateGenerator.create({
    serialNumber: '02',
    subject: `CN=${dnsName}`,
    issuer: ca.subject,
    notBefore: now,
    notAfter: later,
    signingKey: caKeys.privateKey,
    publicKey: leafKeys.publicKey,
    signingAlgorithm: alg,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth], false),
      new x509.SubjectAlternativeNameExtension([{ type: 'dns', value: dnsName }], false),
    ],
  });
  const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', leafKeys.privateKey)).toString('base64');
  const keyPem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  const certPem = leaf.toString('pem');
  const caPem = ca.toString('pem');
  const spki = new X509Certificate(certPem).publicKey.export({ type: 'spki', format: 'der' });
  return { caPem, certPem, keyPem, spkiSha256Base64: createHash('sha256').update(spki).digest('base64') };
}

function readTarget(stateFile) {
  try {
    return JSON.parse(readFileSync(stateFile, 'utf8')).serveTarget ?? null;
  } catch {
    return null;
  }
}

function forwardHeaders(headers, host) {
  const out = { ...headers };
  for (const name of STRIPPED) delete out[name];
  out.host = host;
  out['x-forwarded-host'] = host;
  out['x-forwarded-proto'] = 'https';
  out['x-forwarded-for'] = TAILNET_PEER;
  // Identity headers tailscale adds for tailnet users. GeneratorAI must ignore them.
  out['tailscale-user-login'] = 'owner@example.com';
  out['tailscale-user-name'] = 'Owner';
  out['tailscale-headers-info'] = 'https://tailscale.com/s/serve-headers';
  return out;
}

/**
 * Starts the proxy on 127.0.0.1:<port> (0 = any). Returns `{ port, close }`.
 * `log` (optional) receives one line per proxied request.
 */
export async function startFakeServe({ stateFile, certPem, keyPem, port = 0, log = () => {} }) {
  const server = https.createServer({ cert: certPem, key: keyPem }, (req, res) => {
    const target = readTarget(stateFile);
    if (!target) {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('tailscale serve: no handler');
      return;
    }
    const url = new URL(target);
    const upstream = http.request(
      { host: url.hostname, port: url.port, method: req.method, path: req.url, headers: forwardHeaders(req.headers, req.headers.host ?? '') },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        // No buffering: SSE must arrive as it is written.
        res.flushHeaders?.();
        up.pipe(res);
      },
    );
    upstream.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(`tailscale serve: ${err.message}`);
    });
    req.pipe(upstream);
    log(`${req.method} ${req.url}`);
  });
  server.on('upgrade', (req, socket, head) => {
    const target = readTarget(stateFile);
    if (!target) return socket.destroy();
    const url = new URL(target);
    const upstream = net.connect(Number(url.port), url.hostname, () => {
      const headers = forwardHeaders(req.headers, req.headers.host ?? '');
      const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(headers).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`) : [`${k}: ${v}`]))];
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    log(`UPGRADE ${req.url}`);
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
