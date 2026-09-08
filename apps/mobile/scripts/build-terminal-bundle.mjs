#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Vendors xterm.js into the terminal WebView document.
//
// The WebView that renders the terminal has NO network access and NO file
// access (`allowFileAccess` off, `originWhitelist` = about:blank). The only
// way to get an emulator into it is to inline the script into the HTML
// string React Native hands to `source.html`. This script reads the UMD
// builds of `@xterm/xterm` and the fit / search / web-links addons from
// node_modules and writes them out as string constants.
//
// Why generated, not `require('@xterm/xterm/lib/xterm.js?raw')`:
//   Metro has no raw-text import, and pulling the package in as a module
//   would make Hermes *evaluate* xterm on the phone, where it has no DOM to
//   run against. As a string it is inert until the WebView parses it.
//
// The output is a few hundred KB. It is imported only by
// `src/terminal/terminalHtml.ts`, which `TerminalView` loads with a dynamic
// `import()` — so the string is not touched at app start, only when a
// terminal is opened.
//
// Usage:  pnpm terminal:bundle      (from apps/mobile)
// ────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const outFile = path.join(appRoot, 'src', 'terminal', 'xtermBundle.generated.ts');

// Resolve from the app's own package.json so pnpm's strict node_modules
// layout finds the devDependencies declared THERE, not some hoisted copy.
const require = createRequire(path.join(appRoot, 'package.json'));

/** @param {string} pkg */
function packageDir(pkg) {
  return path.dirname(require.resolve(`${pkg}/package.json`));
}

/** @param {string} pkg */
function version(pkg) {
  return /** @type {{ version: string }} */ (
    JSON.parse(fs.readFileSync(path.join(packageDir(pkg), 'package.json'), 'utf8'))
  ).version;
}

/** @param {string} pkg @param {string} rel */
function readAsset(pkg, rel) {
  const file = path.join(packageDir(pkg), rel);
  return fs.readFileSync(file, 'utf8');
}

/**
 * Turn source text into a JS string literal that is safe to inline inside a
 * `<script>` or `<style>` element.
 *
 * `JSON.stringify` handles quotes, backslashes and control characters. What
 * it does NOT handle is the HTML parser: it tokenises `</script` before the
 * JS engine ever sees the string, so that sequence has to be broken even
 * inside a string literal. `<\/script` is the same characters to JS.
 */
function toLiteral(text) {
  return JSON.stringify(
    text
      // A source-map pointer to a file that will never exist inside the WebView.
      .replace(/\n\/\/# sourceMappingURL=.*$/m, '')
      .replace(/\n\/\*# sourceMappingURL=.*?\*\/\s*$/m, ''),
  )
    .replace(/<\/(script|style)/gi, '<\\/$1')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

const assets = [
  { name: 'XTERM_JS', pkg: '@xterm/xterm', file: 'lib/xterm.js' },
  { name: 'XTERM_CSS', pkg: '@xterm/xterm', file: 'css/xterm.css' },
  { name: 'XTERM_ADDON_FIT_JS', pkg: '@xterm/addon-fit', file: 'lib/addon-fit.js' },
  { name: 'XTERM_ADDON_SEARCH_JS', pkg: '@xterm/addon-search', file: 'lib/addon-search.js' },
  { name: 'XTERM_ADDON_WEB_LINKS_JS', pkg: '@xterm/addon-web-links', file: 'lib/addon-web-links.js' },
];

const versions = {
  '@xterm/xterm': version('@xterm/xterm'),
  '@xterm/addon-fit': version('@xterm/addon-fit'),
  '@xterm/addon-search': version('@xterm/addon-search'),
  '@xterm/addon-web-links': version('@xterm/addon-web-links'),
};

let out = `// GENERATED — run \`pnpm terminal:bundle\`. Do not edit by hand.
//
// Vendored xterm.js for the terminal WebView (see scripts/build-terminal-bundle.mjs).
${Object.entries(versions)
  .map(([pkg, v]) => `//   ${pkg}@${v}`)
  .join('\n')}
//
// Loaded ONLY via \`terminalHtml.ts\`, which \`TerminalView\` imports lazily —
// this string must never be reachable from the app's startup path.

export const XTERM_VERSIONS = ${JSON.stringify(versions, null, 2)} as const;

`;

let totalBytes = 0;
for (const asset of assets) {
  const text = readAsset(asset.pkg, asset.file);
  totalBytes += Buffer.byteLength(text, 'utf8');
  out += `/** ${asset.pkg}/${asset.file} */\nexport const ${asset.name}: string = ${toLiteral(text)};\n\n`;
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, out);

const written = fs.statSync(outFile).size;
console.log(
  `wrote ${path.relative(appRoot, outFile)} — ${(written / 1024).toFixed(0)} KB ` +
    `(${(totalBytes / 1024).toFixed(0)} KB of source across ${assets.length} assets)`,
);
