// ────────────────────────────────────────────────────────────────
// Babel plugin: per-icon imports for lucide-react-native.
//
// `import { ShieldCheck } from 'lucide-react-native'` resolves the package's
// barrel, and Metro (no tree shaking by default) then bundles every one of
// the ~1,500 icons: 1.29 MB of source, 11 % of the Android bundle in the
// Sept 2026 audit, for the ~60 icons the app draws. Hermes still has to
// parse and hold all of it.
//
// This rewrites each named import to the icon's own module
// (`lucide-react-native/dist/esm/icons/shield-check.js`). Aliases (`Edit` →
// `pen-square`, `*Icon`, `Lucide*`) are resolved from the barrel file itself,
// read once per process, so the mapping can never drift from the installed
// version. A name the barrel does not map (or a type-only import) is left on
// the barrel untouched, which keeps the transform correctness-preserving.
// ────────────────────────────────────────────────────────────────

const fs = require('node:fs');
const path = require('node:path');

const PACKAGE = 'lucide-react-native';

/** @type {Map<string, string> | null} export name → icon module basename */
let aliasMap = null;

function loadAliasMap() {
  if (aliasMap) return aliasMap;
  aliasMap = new Map();
  let barrel;
  try {
    const pkgDir = path.dirname(require.resolve(`${PACKAGE}/package.json`, { paths: [__dirname] }));
    barrel = fs.readFileSync(path.join(pkgDir, 'dist/esm/lucide-react-native.js'), 'utf8');
  } catch {
    return aliasMap;
  }
  // export { default as A, default as B } from './icons/a.js';
  const re = /export\s*\{([^}]*)\}\s*from\s*'\.\/icons\/([a-z0-9-]+)\.js'/g;
  let m;
  while ((m = re.exec(barrel))) {
    const file = m[2];
    for (const part of m[1].split(',')) {
      const name = part.replace(/^\s*default\s+as\s+/, '').trim();
      if (name) aliasMap.set(name, file);
    }
  }
  return aliasMap;
}

module.exports = function lucideIconsPlugin({ types: t }) {
  return {
    name: 'lucide-per-icon-imports',
    visitor: {
      ImportDeclaration(nodePath) {
        const node = nodePath.node;
        if (node.source.value !== PACKAGE) return;
        if (node.importKind === 'type') return;
        const map = loadAliasMap();
        if (map.size === 0) return;

        const keep = [];
        const replacements = [];
        for (const spec of node.specifiers) {
          if (
            t.isImportSpecifier(spec) &&
            spec.importKind !== 'type' &&
            t.isIdentifier(spec.imported) &&
            map.has(spec.imported.name)
          ) {
            const file = map.get(spec.imported.name);
            replacements.push(
              t.importDeclaration(
                [t.importDefaultSpecifier(t.identifier(spec.local.name))],
                t.stringLiteral(`${PACKAGE}/dist/esm/icons/${file}.js`),
              ),
            );
          } else {
            keep.push(spec);
          }
        }
        if (replacements.length === 0) return;
        if (keep.length > 0) {
          replacements.push(t.importDeclaration(keep, t.stringLiteral(PACKAGE)));
        }
        nodePath.replaceWithMultiple(replacements);
      },
    },
  };
};
