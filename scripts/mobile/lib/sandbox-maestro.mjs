import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT } from './sandbox-session.mjs';
import { assertDummyRepo } from './sandbox-data.mjs';
import { CHAT_NAMES, seedSandbox } from './sandbox-seed.mjs';
import { APP_ID, ADB, run, targetId, targetHost, mintPair, installedBuild, pairTarget, recordPairing, releaseAgent } from './sandbox-devices.mjs';

// The workspace already pins this parser; do not implement a second YAML parser.
const { parseAllDocuments, stringify } = createRequire(path.join(ROOT, 'packages/core/package.json'))('yaml');

async function flowFiles(input) {
  const stat = await fs.stat(input);
  if (!stat.isDirectory()) return /\.ya?ml$/.test(input) ? [input] : [];
  const children = await fs.readdir(input, { withFileTypes: true });
  return (await Promise.all(children.filter(entry => !entry.name.startsWith('.') && entry.name !== '_subflows' && entry.name !== 'config.yaml')
    .map(entry => flowFiles(path.join(input, entry.name))))).flat().sort();
}

/** Scopes a flow may add for its run (DEVICE_SCOPES), beyond the pairing's defaults; restored afterwards. */
const FLOW_SCOPES = ['write:files', 'write:workspaces', 'exec:terminal', 'exec:browser', 'write:projects', 'write:workflows', 'admin:settings'];

export async function flowMetadata(file) {
  const docs = parseAllDocuments(await fs.readFile(file, 'utf8'));
  if (docs.some(doc => doc.errors.length)) throw new Error(`Invalid Maestro YAML: ${file}`);
  const config = docs[0]?.toJSON();
  if (!config?.appId) return null; // runFlow fragments are not top-level flows.
  const fresh = config.env?.FRESH_CHAT == null ? [] : String(config.env.FRESH_CHAT).split(',').map(key => key.trim());
  for (const key of fresh) if (!(key in CHAT_NAMES)) throw new Error(`Unknown FRESH_CHAT '${key}' in ${file}`);
  const scopes = config.env?.DEVICE_SCOPES == null ? [] : String(config.env.DEVICE_SCOPES).split(',').map(scope => scope.trim());
  for (const scope of scopes) if (!FLOW_SCOPES.includes(scope)) {
    throw new Error(`Unsupported characterization scope '${scope}' in ${file}`);
  }
  return { fresh, scopes, pending: config.env?.PENDING_GATE === true || config.env?.PENDING_GATE === 'true', tags: config.tags ?? [], name: config.name ?? path.basename(file).replace(/\.ya?ml$/, ''),
    ...(config.env?.EXPECT_COMMIT ? { expectedCommit: String(config.env.EXPECT_COMMIT) } : {}) };
}

/** Grant only the scenario's capabilities to the verified sandbox device. */
export async function withFlowScopes(session, target, scopes, runFlow) {
  if (!scopes.length) return runFlow();
  const paired = session.state.paired?.find(device => targetId(device) === targetId(target));
  if (!paired) throw new Error('Scoped flow requires a verified sandbox pairing');
  const device = (await session.api('/auth/devices')).devices.find(device => device.deviceId === paired.deviceId && !device.revokedAt);
  if (!device) throw new Error('The paired sandbox device is missing or revoked');
  const route = `/auth/devices/${encodeURIComponent(device.deviceId)}/scopes`;
  await session.api(route, { scopes: [...new Set([...device.scopes, ...scopes])] }, 'PUT');
  try { return await runFlow(); }
  finally { await session.api(route, { scopes: device.scopes }, 'PUT'); }
}

export function combineJunitReports(reports) {
  const suites = reports.map(xml => {
    const body = xml.replace(/^\s*<\?xml[^>]*\?>\s*/, '').trim();
    const group = body.match(/^<testsuites\b[^>]*>([\s\S]*)<\/testsuites>$/);
    if (group) return group[1];
    if (/^<testsuites\b[^>]*\/>$/.test(body)) return '';
    if (/^<testsuite\b[^>]*\/>$/.test(body)) return body;
    if (/^<testsuite\b[^>]*>[\s\S]*<\/testsuite>$/.test(body)) return body;
    throw new Error('Unexpected Maestro JUnit report; individual reports are preserved');
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n${suites.join('\n')}\n</testsuites>\n`;
}

export async function discoverFlows(input, configPath) {
  const directory = (await fs.stat(input)).isDirectory();
  const base = directory ? input : path.dirname(input);
  let config = {};
  let selectedConfig = configPath;
  if (!selectedConfig) {
    let current = base;
    while (true) {
      const candidate = path.join(current, 'config.yaml');
      try { await fs.access(candidate); selectedConfig = candidate; break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (current === ROOT || path.dirname(current) === current) break;
      current = path.dirname(current);
    }
  }
  if (selectedConfig) {
    const document = parseAllDocuments(await fs.readFile(selectedConfig, 'utf8'))[0];
    if (document.errors.length) throw new Error(`Invalid Maestro config: ${selectedConfig}`);
    config = document.toJSON() ?? {};
  }
  const patterns = directory ? config.flows ?? ['**'] : ['**'];
  if (!Array.isArray(patterns) || patterns.some(pattern => typeof pattern !== 'string')) throw new Error('Maestro config flows must be an array of patterns');
  const positive = patterns.filter(pattern => !pattern.startsWith('!'));
  const negative = patterns.filter(pattern => pattern.startsWith('!')).map(pattern => pattern.slice(1));
  const files = (await flowFiles(input)).filter(file => {
    const relative = path.relative(selectedConfig ? path.dirname(selectedConfig) : base, file).split(path.sep).join('/');
    return positive.some(pattern => path.matchesGlob(relative, pattern)) && !negative.some(pattern => path.matchesGlob(relative, pattern));
  });
  const entries = [];
  for (const file of files) { const metadata = await flowMetadata(file); if (metadata) entries.push({ file, ...metadata }); }
  const order = config.executionOrder?.flowsOrder ?? [];
  const rank = entry => {
    const index = order.findIndex(name => name === entry.name || name === path.basename(entry.file).replace(/\.ya?ml$/, ''));
    return index < 0 ? Infinity : index;
  };
  // 08 §5.1 requires pairing last because it rotates the installed app's pairing.
  entries.sort((a, b) => Number(a.tags.includes('pairing')) - Number(b.tags.includes('pairing')) || rank(a) - rank(b) || a.file.localeCompare(b.file));
  return { entries, config };
}

async function pendingGate(session) {
  const chat = session.state.chats.gate;
  await session.api(`/chats/${chat}/prompt`, { prompt: 'Run the mobile approval fixture.' });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const feed = await session.api('/attention');
    const item = feed.needsYou.find(item => item.entity === 'chat' && item.entityId === chat && item.ask?.kind === 'tool_permission');
    if (item) return item.ask.id;
    await delay(300);
  }
  throw new Error('The fresh gate fixture did not produce an attention interaction');
}

async function verifyAllowedGate(session, chatId, interactionId) {
  const deadline = Date.now() + 15000;
  let afterSeq = 0;
  while (Date.now() < deadline) {
    const replay = await session.api(`/stream/replay?scope=chat&id=${encodeURIComponent(chatId)}&afterSeq=${afterSeq}&limit=500`);
    const resolution = replay.rows.find(row => row.kind === 'chat.permission.resolved' && row.payload?.interactionId === interactionId);
    if (resolution) {
      if (resolution.payload.behavior !== 'allow') throw new Error('Notification resolved the gate with a decision other than allow');
      console.log('Notification approval verified through sandbox stream replay');
      return;
    }
    afterSeq = replay.nextAfterSeq;
    await delay(300);
  }
  throw new Error('Sandbox API did not confirm the notification Allow action');
}

export async function runMaestro(session, target, args, { verify } = {}) {
  if (args[0] !== 'test') throw new Error('Maestro passthrough supports test only');
  if (verify && verify !== 'commit') throw new Error('--verify supports commit only');
  const inputs = [];
  const valueFlags = new Set(['--config', '--debug-output', '--format', '--output', '--test-output-dir',
    '--test-suite-name', '--include-tags', '--exclude-tags', '-e', '--env', '--screen-size']);
  for (let index = 1; index < args.length; index++) {
    if (valueFlags.has(args[index])) { index++; continue; }
    if (args[index].startsWith('-')) continue;
    const candidate = path.resolve(ROOT, args[index]);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory() || /\.ya?ml$/.test(candidate)) inputs.push({ index, path: candidate });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (inputs.length !== 1) throw new Error('Pass exactly one Maestro flow file or directory');
  const input = inputs[0];
  const option = name => {
    const inline = args.find(value => value.startsWith(`--${name}=`));
    const index = args.indexOf(`--${name}`);
    return inline?.slice(name.length + 3) ?? (index >= 0 ? args[index + 1] : undefined);
  };
  const suite = await discoverFlows(input.path, option('config') ? path.resolve(ROOT, option('config')) : undefined);
  const tags = (name) => {
    const inline = args.find(value => value.startsWith(`--${name}=`));
    const index = args.indexOf(`--${name}`);
    return (inline?.split('=')[1] ?? (index >= 0 ? args[index + 1] : '')).split(',').filter(Boolean);
  };
  const includes = option('include-tags') ? tags('include-tags') : suite.config.includeTags ?? [];
  const excludes = [...(suite.config.excludeTags ?? []), ...tags('exclude-tags')];
  const build = await installedBuild(target);
  await releaseAgent(target);
  const id = targetId(target), host = targetHost(target);
  if (target.physical && build === 'dev') await run(ADB, ['-s', id, 'reverse', 'tcp:8081', 'tcp:8081']);
  const maestro = process.env.MAESTRO_BIN ?? path.join(os.homedir(), '.maestro', 'bin', process.platform === 'win32' ? 'maestro.bat' : 'maestro');
  const runtimeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'generatorai-maestro-run-'));
  const runtimeConfig = path.join(runtimeDir, 'config.yaml');
  const runtimeSettings = { ...suite.config };
  delete runtimeSettings.executionOrder;
  delete runtimeSettings.flows;
  await fs.writeFile(runtimeConfig, stringify(runtimeSettings), { mode: 0o600 });
  const reports = [];
  const reportTarget = option('output');
  const junit = option('format')?.toUpperCase() === 'JUNIT';
  let count = 0;
  try {
    for (const metadata of suite.entries) {
      const { file } = metadata;
      if ((includes.length && !includes.some(tag => metadata.tags.includes(tag))) || excludes.some(tag => metadata.tags.includes(tag))) continue;
      const fresh = new Set(metadata.fresh);
      if (metadata.pending) fresh.add('gate');
      await seedSandbox(session, [...fresh]);
      const env = { APP_ID, PLATFORM: target.platform, BUILD: build, METRO_URL: encodeURIComponent(`http://${host}:8081`),
        SERVER_URL: `http://${host}:${session.port}`, DEVICE_NAME: target.name, DUMMY_REPO: assertDummyRepo(session.state.dummyRepo),
        PROJECT_ID: session.state.projectId, CODEBASE_ID: session.state.fixtures.edits.codebaseId,
        ...Object.fromEntries(Object.entries(session.state.chats).map(([key, id]) => [`CHAT_${key.toUpperCase()}_ID`, id])) };
      const pairing = metadata.tags.includes('pairing');
      const devicesBefore = pairing ? new Set((await session.api('/auth/devices')).devices.map(device => device.deviceId)) : null;
      if (pairing) env.PAIR_URL = await mintPair(session, target);
      if (metadata.pending) env.INTERACTION_ID = await pendingGate(session);
      const commandArgs = [];
      for (let index = 0; index < args.length; index++) {
        if (args[index] === '--config') { index++; continue; }
        if (args[index].startsWith('--config=')) continue;
        commandArgs.push(index === input.index ? file : args[index]);
      }
      commandArgs.push('--config', runtimeConfig);
      // Run separately so every turn-consuming flow receives a fresh conversation.
      // Unique reports avoid a directory suite overwriting its preceding result.
      let flowReport;
      if (reportTarget && suite.entries.length > 1) {
        const report = path.parse(reportTarget);
        flowReport = path.join(report.dir, `${report.name}-${count + 1}${report.ext}`);
        for (let index = 0; index < commandArgs.length; index++) {
          if (commandArgs[index] === '--output') commandArgs[index + 1] = flowReport;
          else if (commandArgs[index].startsWith('--output=')) commandArgs[index] = `--output=${flowReport}`;
        }
      }
      // Invoke the pinned distribution's Java entry directly on Windows. A .bat/cmd
      // wrapper would re-expand percent-encoded Metro URLs and parse grant arguments.
      const windows = process.platform === 'win32';
      const executable = windows ? (process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin/java.exe') : 'java.exe') : maestro;
      const started = Date.now();
      const invoke = (commands) => new Promise((resolve, reject) => {
        const argv = ['--device', id, ...commands, ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`])];
        const spawnArgs = windows ? ['--enable-native-access=ALL-UNNAMED', '-classpath',
          path.join(path.dirname(path.dirname(maestro)), 'lib', '*'), 'maestro.cli.AppKt', ...argv] : argv;
        const child = spawn(executable, spawnArgs, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_DRIVER_STARTUP_TIMEOUT: '420000' } });
        child.once('error', reject); child.once('exit', (code, signal) => resolve(signal ? 1 : code));
      });
      if (metadata.pending && target.platform === 'ios') {
        const setup = path.join(ROOT, 'apps/mobile/.maestro/_subflows/notification-setup.yaml');
        if (await invoke(['test', setup, '--config', runtimeConfig]) !== 0) throw new Error('Native notification consent setup failed');
        const template = await fs.readFile(path.join(ROOT, 'apps/mobile/e2e/push/approval.json'), 'utf8');
        // v2 fixture (apps/mobile/src/features/development/pushFixtures.ts): the gate chat and the sandbox's server id.
        const payload = template.replaceAll('${CHAT_ID}', env.CHAT_GATE_ID).replaceAll('${INTERACTION_ID}', env.INTERACTION_ID)
          .replaceAll('${SERVER_ID}', session.state.server.serverId);
        JSON.parse(payload);
        const payloadFile = path.join(runtimeDir, 'approval.json');
        await fs.writeFile(payloadFile, payload, { mode: 0o600 });
        await run('xcrun', ['simctl', 'push', id, APP_ID, payloadFile]);
      }
      const code = await withFlowScopes(session, target, metadata.scopes, () => invoke(commandArgs));
      if (junit && flowReport) {
        try { reports.push(await fs.readFile(path.resolve(ROOT, flowReport), 'utf8')); }
        catch (error) { if (code === 0 || error.code !== 'ENOENT') throw error; }
      }
      if (code !== 0) {
        // A pairing flow starts from cleared state: when it fails half way the app is left unpaired, and every
        // later flow would fail at launch. Restore the pairing before reporting the failure.
        if (pairing) await pairTarget(session, target, { repair: true }).catch((error) => console.error(`sandbox-pair: re-pair after the failed pairing flow: ${error.message}`));
        throw new Error(`Maestro failed for ${path.relative(ROOT, file)} (${code})`);
      }
      if (metadata.expectedCommit) {
        const subject = await run('git', ['-C', assertDummyRepo(session.state.dummyRepo), 'log', '-1', '--format=%s']);
        if (subject !== metadata.expectedCommit) throw new Error('Dummy repository did not receive the expected characterization commit');
        console.log('Characterization commit verified in the dummy repository');
      }
      if (metadata.pending && target.platform === 'android') await verifyAllowedGate(session, env.CHAT_GATE_ID, env.INTERACTION_ID);
      if (pairing) await recordPairing(session, target, devicesBefore, started);
      count++;
    }
  } finally {
    await fs.rm(runtimeDir, { recursive: true, force: true });
    if (reports.length) await fs.writeFile(path.resolve(ROOT, reportTarget), combineJunitReports(reports));
  }
  if (!count) throw new Error('No Maestro flows matched the supplied path and tags');
  if (verify === 'commit') {
    const subject = await run('git', ['-C', assertDummyRepo(session.state.dummyRepo), 'log', '-1', '--format=%s']);
    if (subject !== 'Mobile characterization commit') throw new Error('Dummy repository did not receive the expected characterization commit');
  }
  console.log(`Maestro: ${count} flow(s) passed on ${target.platform}`);
}
