#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// A fake `tailscale` CLI for the "Connect with Tailscale" tests (D-123).
//
// Implements exactly what GeneratorAI calls, with the real CLI's output
// shapes (ipnstate.Status, ipn.ServeConfig, the enable-HTTPS message):
//   tailscale status --json
//   tailscale serve status --json
//   tailscale serve --bg --https=443 http://127.0.0.1:<port>
//   tailscale serve --https=443 off
// State lives in the JSON file named by FAKE_TAILSCALE_STATE:
//   { backend: 'Running' | 'NeedsLogin' | 'Stopped' | 'down',
//     dnsName, https: boolean, waitForEnable: boolean,
//     serveTarget: string | null, calls: string[][] }
// `serve-proxy.mjs` plays tailscaled: it reads `serveTarget` and proxies
// https://<dnsName> to it. Anything else exits 1 like an unknown command.
//
// Never process.exit() right after writing: stdout to a pipe is asynchronous
// and the text (the enable link) would be lost; the exit code is set and Node
// exits once the write has flushed.
// ────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync } from 'node:fs';

const file = process.env.FAKE_TAILSCALE_STATE;
if (!file) {
  process.stderr.write('FAKE_TAILSCALE_STATE is not set\n');
  process.exitCode = 2;
} else {
  run(file);
}

function run(stateFile) {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  const args = process.argv.slice(2);
  state.calls = [...(state.calls ?? []), args];
  const save = () => writeFileSync(stateFile, JSON.stringify(state, null, 2));
  save();
  const dns = state.dnsName;
  const suffix = dns.split('.').slice(1).join('.');
  const out = (text) => process.stdout.write(text);
  const fail = (text) => {
    process.stderr.write(text);
    process.exitCode = 1;
  };

  if (state.backend === 'down') {
    fail("failed to connect to local tailscaled; it doesn't appear to be running (sudo systemctl start tailscaled ?)\n");
    return;
  }

  const command = args.join(' ');
  if (command === 'status --json') {
    const running = state.backend === 'Running';
    out(
      JSON.stringify(
        {
          Version: '1.88.3-fake',
          BackendState: state.backend,
          AuthURL: state.backend === 'NeedsLogin' ? 'https://login.tailscale.com/a/fake123' : '',
          Self: running ? { DNSName: `${dns}.`, HostName: dns.split('.')[0], TailscaleIPs: ['100.64.0.1'], CapMap: state.https ? { https: null } : {} } : { DNSName: '' },
          CertDomains: state.https ? [dns] : null,
          MagicDNSSuffix: suffix,
          CurrentTailnet: { Name: 'owner@example.com', MagicDNSSuffix: suffix, MagicDNSEnabled: true },
        },
        null,
        2,
      ),
    );
    return;
  }

  if (command === 'serve status --json') {
    out(
      state.serveTarget
        ? JSON.stringify({ TCP: { 443: { HTTPS: true } }, Web: { [`${dns}:443`]: { Handlers: { '/': { Proxy: state.serveTarget } } } } }, null, 2)
        : '{}\n',
    );
    return;
  }

  if (args.length === 4 && args[0] === 'serve' && args[1] === '--bg' && args[2] === '--https=443' && /^http:\/\/127\.0\.0\.1:\d+$/.test(args[3])) {
    if (state.backend !== 'Running') {
      fail('Logged out.\n');
      return;
    }
    if (!state.https) {
      out('\nServe is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=nFAKE123\n\n');
      // The real CLI either exits or waits for the owner to enable it.
      if (state.waitForEnable) setInterval(() => {}, 1_000);
      return;
    }
    state.serveTarget = args[3];
    save();
    out(`Available within your tailnet:\n\nhttps://${dns}/\n|-- proxy ${args[3]}\n\nServe started and running in the background.\nTo disable the proxy, run: tailscale serve --https=443 off\n`);
    return;
  }

  if (command === 'serve --https=443 off') {
    state.serveTarget = null;
    save();
    return;
  }

  fail(`fake tailscale: unsupported command: ${command}\n`);
}
