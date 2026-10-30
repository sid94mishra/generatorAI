// The Faux script a sandbox server loads (GENERATORAI_TEST_FAUX_SCRIPT).
//
// The sandbox is where the full e2e suite runs (09 §6), and two of its specs
// (composer, changes-dock) drive conversations scripted in
// agent-tests/e2e/fixtures/faux-*.json. The server reads ONE script file, keyed
// by conversation name, so by default the sandbox merges its own fixture with
// every e2e fixture. Setting GENERATORAI_TEST_FAUX_SCRIPT on the test runner
// only told a spec not to skip — the sandbox then replaced the variable with
// its own fixture and the scripted turns never ran ("waiting for your answer"
// and the Changes dock's Keep/Undo failed on a sandbox at any commit).
//
//   GENERATORAI_SANDBOX_FAUX_SCRIPT  used as-is (the mobile sandbox's fixture).
//   GENERATORAI_TEST_FAUX_SCRIPT     merged in after the defaults.
import fs from 'node:fs';
import path from 'node:path';

/** The fixture files the sandbox's default Faux script is merged from, in order. */
export function sandboxFauxSources(root, env = process.env) {
  const e2eDir = path.join(root, 'agent-tests', 'e2e', 'fixtures');
  const e2e = fs.existsSync(e2eDir)
    ? fs.readdirSync(e2eDir).filter((f) => /^faux-.*\.json$/.test(f)).sort().map((f) => path.join(e2eDir, f))
    : [];
  const sources = [path.join(root, 'agent-tests', 'vrt', 'fixtures', 'sandbox.faux.json'), ...e2e];
  const extra = env.GENERATORAI_TEST_FAUX_SCRIPT ? path.resolve(env.GENERATORAI_TEST_FAUX_SCRIPT) : null;
  // The e2e fixture itself (the old spec instructions) is already included.
  return extra && !sources.includes(extra) ? [...sources, extra] : sources;
}

/**
 * One FauxScriptFile (conversation name → turns) from several. A name scripted
 * by two files is an error: which file wins would decide what a spec sees.
 */
export function mergeFauxScripts(files, read = (f) => fs.readFileSync(f, 'utf8')) {
  const merged = {};
  const from = {};
  for (const file of files) {
    const script = JSON.parse(read(file));
    if (typeof script !== 'object' || script === null || Array.isArray(script)) {
      throw new Error(`${file}: a Faux script is a JSON object keyed by conversation name`);
    }
    for (const [name, turns] of Object.entries(script)) {
      if (name in merged) throw new Error(`Faux conversation "${name}" is scripted by both ${from[name]} and ${file}`);
      merged[name] = turns;
      from[name] = file;
    }
  }
  return merged;
}

/**
 * The script path to hand the server: GENERATORAI_SANDBOX_FAUX_SCRIPT as-is,
 * else the merged defaults written to `<sandboxDir>/faux-script.json`.
 */
export function prepareSandboxFauxScript(root, sandboxDir, env = process.env) {
  if (env.GENERATORAI_SANDBOX_FAUX_SCRIPT) return { file: env.GENERATORAI_SANDBOX_FAUX_SCRIPT, sources: [] };
  const sources = sandboxFauxSources(root, env);
  const file = path.join(sandboxDir, 'faux-script.json');
  fs.writeFileSync(file, `${JSON.stringify(mergeFauxScripts(sources), null, 2)}\n`);
  return { file, sources };
}
