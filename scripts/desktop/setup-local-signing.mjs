// ────────────────────────────────────────────────────────────────
// One-time setup of a local code-signing identity for macOS builds (D-142).
//
//   node scripts/desktop/setup-local-signing.mjs
//
// An unsigned (ad-hoc) build gets a new identity every time it is rebuilt, so
// the Keychain treats each one as a different app and asks again for the
// "GeneratorAI Safe Storage" key. Signing every local build with ONE stable,
// self-signed identity makes the grant stick: "Always Allow" once, and later
// builds open without asking.
//
// Creates a self-signed certificate "GeneratorAI Local Signing" (code signing
// only, 10 years) in the login keychain, allows codesign to use its key, and
// trusts it for code signing for this user — macOS asks for your password once
// for that. Idempotent. Not a release signature: such builds still count as
// unsigned for publishing and self-update. Windows / Linux: nothing to do.
// ────────────────────────────────────────────────────────────────

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';

const NAME = 'GeneratorAI Local Signing';

if (process.platform !== 'darwin') {
  console.log('Local signing is only needed on macOS; nothing to do.');
  process.exit(0);
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const valid = () => spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }).stdout.includes(`"${NAME}"`);

if (valid()) {
  console.log(`"${NAME}" is already set up — local builds are signed with it.`);
  process.exit(0);
}

const keychain = path.join(os.homedir(), 'Library', 'Keychains', 'login.keychain-db');
const dir = mkdtempSync(path.join(os.tmpdir(), 'generatorai-signing-'));
try {
  const exists = spawnSync('security', ['find-certificate', '-c', NAME, keychain], { encoding: 'utf8' }).status === 0;
  const certPem = path.join(dir, 'cert.pem');
  if (!exists) {
    const keyPem = path.join(dir, 'key.pem');
    const cfg = path.join(dir, 'openssl.cnf');
    writeFileSync(cfg, [
      '[req]', 'distinguished_name=dn', 'x509_extensions=ext', 'prompt=no',
      '[dn]', `CN=${NAME}`,
      '[ext]', 'basicConstraints=critical,CA:false', 'keyUsage=critical,digitalSignature', 'extendedKeyUsage=critical,codeSigning',
      'subjectKeyIdentifier=hash',
    ].join('\n'));
    run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650', '-keyout', keyPem, '-out', certPem, '-config', cfg]);
    const pass = randomBytes(12).toString('hex');
    const p12 = path.join(dir, 'identity.p12');
    // Legacy PBE: the Keychain cannot read OpenSSL 3's default PKCS#12 encryption.
    run('openssl', ['pkcs12', '-export', '-legacy', '-inkey', keyPem, '-in', certPem, '-name', NAME, '-out', p12, '-passout', `pass:${pass}`]);
    run('security', ['import', p12, '-k', keychain, '-P', pass, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security']);
    console.log(`Created "${NAME}" in your login keychain.`);
  } else {
    run('security', ['find-certificate', '-c', NAME, '-p', keychain], { stdio: ['ignore', 'pipe', 'pipe'] });
    writeFileSync(certPem, run('security', ['find-certificate', '-c', NAME, '-p', keychain]));
  }
  console.log('Trusting it for code signing — macOS will ask for your password once…');
  run('security', ['add-trusted-cert', '-r', 'trustRoot', '-p', 'codeSign', '-k', keychain, certPem], { stdio: 'inherit' });
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (!valid()) {
  console.error(`"${NAME}" was created but is not a valid code-signing identity yet. Re-run this script.`);
  process.exit(1);
}
console.log(`Done. The next \`pnpm package:desktop\` signs with "${NAME}"; allow the Keychain once and it will stop asking.`);
