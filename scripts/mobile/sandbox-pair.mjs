#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { SandboxSession } from './lib/sandbox-session.mjs';
import { seedSandbox } from './lib/sandbox-seed.mjs';
import { cancelDeviceCommands, findTargets, mintPair, pairTarget } from './lib/sandbox-devices.mjs';

/** The state without the LAN sandbox's admin key. */
function redacted(state) {
  return state.server?.apiKey ? { ...state, server: { ...state.server, apiKey: '<redacted>' } } : state;
}

async function main() {
  const separator = process.argv.indexOf('--');
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2, separator < 0 ? undefined : separator), allowPositionals: true,
    options: {
      platform: { type: 'string' }, udid: { type: 'string' }, serial: { type: 'string' },
      port: { type: 'string', default: '3197' }, fresh: { type: 'string' },
      repair: { type: 'boolean' }, 'no-seed': { type: 'boolean' }, 'no-confirm': { type: 'boolean' },
      'trust-running': { type: 'boolean' }, 'db-path': { type: 'string' }, help: { type: 'boolean' },
      verify: { type: 'string' },
    },
  });
  if (values.help) {
    console.log(`Usage: node scripts/mobile/sandbox-pair.mjs [pair|status|mint|seed|maestro|stop]
  --platform=ios|android --udid=<simulator> --serial=<android>
  --port=3197 --fresh=stream,gate,stop,edits,long --repair --no-seed --no-confirm
  --trust-running --db-path=<verified temporary sandbox.db>
  maestro --platform=<p> -- test <flow.yaml|directory> [Maestro options]
Starts an isolated sandbox when needed and stays attached until Ctrl-C.
status/stop never start a server. Grants are printed only by the explicit mint command.`);
    return;
  }
  const command = positionals[0] ?? 'pair';
  if (positionals.length > 1 || !['pair', 'status', 'mint', 'seed', 'maestro', 'stop'].includes(command)) throw new Error('Unknown command; use --help');
  if (values.platform && !['ios', 'android'].includes(values.platform)) throw new Error('--platform must be ios or android');
  if (command === 'maestro' && values['no-confirm']) throw new Error('Maestro requires completed pairing; omit --no-confirm');
  const session = new SandboxSession(Number(values.port));
  if (command === 'status') {
    await session.load();
    const info = await session.probe();
    console.log(JSON.stringify({ ...redacted(session.state), running: Boolean(info && info.serverId === session.state.server?.serverId) }, null, 2));
    return;
  }
  if (command === 'stop') { await session.requestStop(); console.log('sandbox-pair: stopped'); return; }
  let interrupted = false;
  const onSignal = () => {
    if (interrupted) return;
    interrupted = true;
    cancelDeviceCommands();
    void session.shutdown().then(() => process.exit(130), error => { console.error(error.message); process.exit(1); });
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  try {
    await session.ensure({ trustRunning: values['trust-running'], dbPath: values['db-path'] });
    if (!values['no-seed'] && command !== 'mint') await seedSandbox(session, values.fresh?.split(',').filter(Boolean) ?? []);
    if (command === 'mint') {
      if (!values.platform) throw new Error('mint requires --platform');
      const target = values.serial || values.udid ? (await findTargets(values))[0] : { platform: values.platform };
      console.log(await mintPair(session, target));
    } else if (command === 'pair' || command === 'maestro') {
      const targets = await findTargets(values);
      for (const target of targets) {
        await pairTarget(session, target, { repair: values.repair, noConfirm: values['no-confirm'] });
      }
      if (command === 'maestro') {
        if (targets.length !== 1) throw new Error('Maestro requires exactly one target; pass --udid or --serial');
        if (separator < 0) throw new Error('Pass Maestro arguments after --');
        const { runMaestro } = await import('./lib/sandbox-maestro.mjs');
        await runMaestro(session, targets[0], process.argv.slice(separator + 1), { verify: values.verify });
      }
    }
    if (command !== 'mint') {
      console.log('sandbox-pair: ready');
      console.log(JSON.stringify(redacted(session.state), null, 2));
    }
    if (session.child) {
      console.error('Sandbox remains attached; Ctrl-C or sandbox-pair stop shuts down only this sandbox.');
      if (session.child.exitCode === null && session.child.signalCode === null) {
        await new Promise(resolve => session.child.once('exit', resolve));
      }
      if (session.childFailure) throw session.childFailure;
    }
  } catch (error) {
    await session.shutdown();
    throw error;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }
}

main().catch(error => { console.error(`sandbox-pair: ${error.message}`); process.exitCode = 1; });
