// Pure parts of the mobile VRT (08 §4.6, M10-03): the story index, the capture variants, the paths and links, the
// device check and the result summary. `scripts/mobile/vrt.mjs` does the device I/O. Node tests: vrt-plan.test.mjs.
import path from 'node:path';

/** Default capture variants per story (08 §4.6): theme-mode-textSize. */
export const DEFAULT_VARIANTS = Object.freeze([
  'instrument-light-default',
  'instrument-dark-default',
  'instrument-dark-ax',
  'solarized-light-default',
  'solarized-light-ax',
]);
/** `vrt.accents: true` adds these in Instrument dark (ink is the default accent). */
export const EXTRA_ACCENTS = Object.freeze(['blue', 'violet', 'rose', 'teal', 'green', 'orange']);
/** Text sizes by variant suffix: the OS category agent-device sets (iOS content size; Android font_scale). */
export const TEXT_SIZES = Object.freeze({ default: 'large', ax: 'accessibility-extra-extra-extra-large' });
/** The odiff settings of 08 §4.6. */
export const DIFF_OPTIONS = Object.freeze({ threshold: 0.05, antialiasing: true });

/**
 * A literal Babel AST node (object, array, string, number, boolean, null) as a value; anything computed is
 * `undefined`, so a story's `parameters.vrt` must be written as a literal to be honoured.
 */
export function literal(node) {
  if (!node) return undefined;
  switch (node.type) {
    case 'StringLiteral': case 'NumericLiteral': case 'BooleanLiteral': return node.value;
    case 'NullLiteral': return null;
    case 'TemplateLiteral': return node.expressions.length ? undefined : node.quasis.map((q) => q.value.cooked).join('');
    case 'ArrayExpression': return node.elements.map(literal);
    case 'TSAsExpression': case 'TSSatisfiesExpression': return literal(node.expression);
    case 'ObjectExpression': {
      const out = {};
      for (const prop of node.properties) {
        if (prop.type !== 'ObjectProperty' || prop.computed) return undefined;
        const key = prop.key.type === 'Identifier' ? prop.key.name : prop.key.value;
        out[key] = literal(prop.value);
      }
      return out;
    }
    default: return undefined;
  }
}

/** `parameters.vrt` of the story, else of the meta; `{}` when neither sets it. */
export function vrtParams(metaParameters, storyParameters) {
  const story = literal(storyParameters)?.vrt;
  const meta = literal(metaParameters)?.vrt;
  return { ...(meta ?? {}), ...(story ?? {}) };
}

/** The variants one story is captured in (`vrt.variants` replaces the default list; `vrt.accents` adds six). */
export function variantsFor(vrt = {}) {
  if (vrt.skip) return [];
  const base = Array.isArray(vrt.variants) && vrt.variants.length ? vrt.variants : DEFAULT_VARIANTS;
  const accents = vrt.accents ? EXTRA_ACCENTS.map((accent) => `instrument-dark-default-${accent}`) : [];
  return [...new Set([...base, ...accents])];
}

/** `instrument-dark-ax[-<accent>]` → its parts. */
export function parseVariant(variant) {
  const match = /^([a-z0-9]+(?:-[a-z0-9]+)*?)-(light|dark)-(default|ax)(?:-([a-z]+))?$/.exec(variant);
  if (!match) throw new Error(`Bad VRT variant '${variant}' (theme-mode-textSize[-accent])`);
  return { theme: match[1], mode: match[2], textSize: match[3], accent: match[4] ?? 'ink' };
}

/** The Storybook dev route that renders one story in one variant (`.rnstorybook/Screen.tsx`). */
export function captureUrl(storyId, variant) {
  const { theme, mode, accent } = parseVariant(variant);
  const query = new URLSearchParams({ story: storyId, theme, mode, accent });
  return `generatorai:///storybook?${query}`;
}

/** Committed baseline: `apps/mobile/vrt/baselines/<platform>/<device>/<storyId>--<variant>.png`. */
export function baselineFile(root, platform, device, storyId, variant) {
  return path.join(root, 'apps/mobile/vrt/baselines', platform, device, `${storyId}--${variant}.png`);
}

/** The plan: every (story, variant), grouped by text size so the device setting changes once per group. */
export function capturePlan(stories, { grep, variants } = {}) {
  const pattern = grep ? new RegExp(grep) : null;
  const only = variants?.length ? new Set(variants) : null;
  const items = [];
  for (const story of stories) {
    if (pattern && !pattern.test(story.id)) continue;
    for (const variant of variantsFor(story.vrt)) {
      if (only && !only.has(variant)) continue;
      items.push({ storyId: story.id, variant, textSize: parseVariant(variant).textSize });
    }
  }
  return Object.entries(Object.groupBy(items, (item) => item.textSize)).flatMap(([, group]) => group);
}

/**
 * Whether a baseline folder was recorded on this device. Baselines are per device type and OS image; comparing across
 * them only measures the simulator, so the script refuses and prints the re-baseline command instead.
 */
export function deviceMismatch(meta, current) {
  if (!meta) return null;
  for (const key of ['deviceType', 'runtime', 'image']) {
    if (meta[key] !== undefined && meta[key] !== current[key]) return `${key}: baseline ${meta[key]}, device ${current[key] ?? 'unknown'}`;
  }
  return null;
}

/** One line per result and the exit code: new baselines and diffs fail unless `--update`. */
export function summarize(results, { update = false } = {}) {
  const counts = { match: 0, diff: 0, missing: 0, layout: 0, failed: 0, updated: 0 };
  for (const result of results) counts[result.status] = (counts[result.status] ?? 0) + 1;
  const failing = update ? counts.failed : counts.diff + counts.missing + counts.layout + counts.failed;
  return { counts, exitCode: failing ? 1 : 0 };
}

/**
 * Story ids and their VRT parameters from story sources, with Storybook's own CSF parser (`loadCsf` from
 * `storybook/internal/csf-tools`, injected) so the ids match what the on-device Storybook selects.
 */
export function indexStories(sources, loadCsf) {
  const stories = [];
  for (const { file, code } of sources) {
    const csf = loadCsf(code, { fileName: file, makeTitle: (title) => title }).parse();
    const metaParameters = csf._metaAnnotations?.parameters;
    for (const story of csf.stories) {
      const exportName = Object.keys(csf._stories).find((name) => csf._stories[name].id === story.id) ?? story.name;
      const vrt = vrtParams(metaParameters, csf._storyAnnotations?.[exportName]?.parameters);
      stories.push({ id: story.id, title: csf.meta.title, name: story.name, file, vrt });
    }
  }
  return stories.sort((a, b) => a.id.localeCompare(b.id));
}
