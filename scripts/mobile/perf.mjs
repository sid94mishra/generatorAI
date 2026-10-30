#!/usr/bin/env node
// Mobile performance budgets (08 §4.7, M10-03, MD-194). On one paired simulator / emulator with a RELEASE build:
// cold start, the 2,000-line streaming reply (frames + memory) and flings over that transcript (frames), each judged
// against apps/mobile/perf/budgets.json and the previous batch's numbers. Results merge into
// docs/redesign/mobile/reviews/<batch>/perf.json under the platform.
//
//   node scripts/mobile/perf.mjs --platform=ios|android [--udid=… | --serial=…] [--batch=F] [--previous=E]
//                                [--port=3197] [--only=cold-start,streaming,transcript-scroll]
//
// Uses the running sandbox when there is one (else starts it for the run and stops it after), pairs the target if
// needed (sandbox-pair rules), and runs the perf Maestro flows through the same runner as `sandbox-pair maestro`.
// Simulator numbers are relative; absolute budgets are checked on real phones (08 §4.7).
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, SandboxSession } from './lib/sandbox-session.mjs';
import { seedSandbox } from './lib/sandbox-seed.mjs';
import { ADB, APP_ID, agent, findTargets, installedBuild, pairTarget, releaseAgent, run } from './lib/sandbox-devices.mjs';
import { runMaestro } from './lib/sandbox-maestro.mjs';
import { frameMetrics, judge, memoryMetrics, verdict } from './lib/perf-budgets.mjs';

const budgetsFile = path.join(ROOT, 'apps/mobile/perf/budgets.json');

async function resetFrames(target) {
  // Android counts frames since the last reset; iOS samples a window at read time.
  if (target.platform === 'android') await run(ADB, ['-s', target.serial, 'shell', 'dumpsys', 'gfxinfo', APP_ID, 'reset']);
}

async function sample(target, kinds) {
  await agent(target, ['open', APP_ID, '--foreground']);
  const out = {};
  if (kinds.includes('frames')) Object.assign(out, frameMetrics(JSON.parse(await agent(target, ['perf', 'frames', '--json']))));
  if (kinds.includes('memory')) Object.assign(out, memoryMetrics(JSON.parse(await agent(target, ['perf', 'memory', 'sample', '--json']))));
  await releaseAgent(target);
  return out;
}

async function coldStart(target) {
  if (target.platform === 'android') {
    await run(ADB, ['-s', target.serial, 'shell', 'am', 'force-stop', APP_ID]);
    await delay(1000);
    const out = await run(ADB, ['-s', target.serial, 'shell', 'am', 'start', '-W', '-n', `${APP_ID}/.MainActivity`]);
    const total = /TotalTime:\s*(\d+)/.exec(out);
    return total ? { coldStartMs: Number(total[1]) } : {};
  }
  // iOS: launch to the first Home frame, through the driver (includes its polling — relative numbers only).
  // Leave Home last: a cold start within 30 min restores the last route (lastRouteRules), and Home is what we time.
  await agent(target, ['open', 'generatorai:///']).catch(() => undefined);
  await delay(2000);
  await run('xcrun', ['simctl', 'terminate', target.udid, APP_ID]).catch(() => undefined);
  await delay(1000);
  const started = Date.now();
  await agent(target, ['open', APP_ID, '--relaunch']);
  // A dev build downloads its bundle on a cold start (well over 30 s on a loaded host).
  await agent(target, ['wait', 'id="home-new-chat"', '120000']);
  const coldStartMs = Date.now() - started;
  await releaseAgent(target);
  return { coldStartMs };
}

async function main() {
  const { values } = parseArgs({ options: {
    platform: { type: 'string' }, udid: { type: 'string' }, serial: { type: 'string' }, port: { type: 'string', default: '3197' },
    batch: { type: 'string', default: 'F' }, previous: { type: 'string' }, only: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help || !values.platform) {
    console.log('Usage: node scripts/mobile/perf.mjs --platform=ios|android [--udid=…|--serial=…] [--batch=F] [--previous=E] [--only=cold-start,streaming,transcript-scroll]');
    return;
  }
  const config = JSON.parse(await fs.readFile(budgetsFile, 'utf8'));
  const only = values.only?.split(',').filter(Boolean);
  // The scroll scenario flings the reply the streaming scenario produces: run streaming first on a fresh sandbox.
  const ORDER = ['cold-start', 'streaming', 'transcript-scroll'];
  const rank = (name) => (ORDER.includes(name) ? ORDER.indexOf(name) : ORDER.length);
  const scenarios = Object.keys(config.scenarios).filter((name) => !only || only.includes(name)).sort((a, b) => rank(a) - rank(b));
  const [target] = await findTargets({ platform: values.platform, udid: values.udid, serial: values.serial });
  const build = await installedBuild(target);
  if (build !== 'release') console.warn(`perf: ${target.name} runs a ${build} build — numbers are not comparable with the budgets (08 §4.7 wants release)`);

  const session = new SandboxSession(Number(values.port));
  const results = {};
  try {
    await session.ensure({});
    await seedSandbox(session, []);
    await pairTarget(session, target, {});
    let previous = {};
    if (values.previous) {
      const file = path.join(ROOT, 'docs/redesign/mobile/reviews', values.previous, 'perf.json');
      if (existsSync(file)) previous = JSON.parse(await fs.readFile(file, 'utf8'))[target.platform]?.scenarios ?? {};
    }
    for (const name of scenarios) {
      const scenario = config.scenarios[name];
      let measured;
      if (name === 'cold-start') measured = await coldStart(target);
      else {
        await resetFrames(target);
        await runMaestro(session, target, ['test', scenario.flow]);
        measured = await sample(target, name === 'streaming' ? ['frames', 'memory'] : ['frames']);
      }
      const rows = judge(scenario.budgets, measured, previous[name]?.measured, config.regressionPercent);
      results[name] = { measured, rows };
      for (const row of rows) console.log(`perf: ${name} ${row.metric} ${row.value ?? '—'} (budget ${row.budget}${row.previous !== undefined ? `, previous ${row.previous}` : ''}) ${row.status}`);
    }
  } finally {
    await session.shutdown();
  }
  const file = path.join(ROOT, 'docs/redesign/mobile/reviews', values.batch, 'perf.json');
  const existing = existsSync(file) ? JSON.parse(await fs.readFile(file, 'utf8')) : {};
  const commit = (await run('git', ['rev-parse', '--short', 'HEAD'])).trim();
  existing[target.platform] = { device: target.name, build, recordedAt: new Date().toISOString(), commit, scenarios: results };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(existing, null, 2)}\n`);
  console.log(`perf: written ${path.relative(ROOT, file)}`);
  process.exitCode = verdict(Object.values(results).flatMap((result) => result.rows));
}

main().catch((error) => { console.error(`perf: ${error.message}`); process.exitCode = 1; });
