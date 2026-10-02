// ────────────────────────────────────────────────────────────────
// Babel plugin: per-icon imports for lucide-react-native 1.x (mobile 02 §5.2).
//
// `import { ShieldCheck } from 'lucide-react-native'` resolves the package's
// barrel, and Metro (no tree shaking) would then bundle all ~1,800 icons for
// the few dozen the legacy screens draw. Each named import is rewritten to
// the icon's own module through the supported subpath:
//
//   import { ShieldCheck as S } from 'lucide-react-native'
//   → import S from 'lucide-react-native/icons/shield-check'
//
// The name → file map is read from the installed barrel
// (`dist/esm/lucide-react-native.mjs`), so 1.x aliases (`Loader2` →
// `loader-circle`, `*Icon`, `Lucide*`) resolve exactly as the barrel would
// and the map cannot drift from the installed version. An unknown name is a
// BUILD ERROR naming the icon — never a silent fallback to the barrel
// (scripts/check-bundle.mjs asserts the barrel is absent from the export).
// Type-only specifiers (`LucideIcon`, `LucideProps`) are dropped: Babel
// erases every type reference anyway, so they never needed the barrel.
//
// Deleted in M10 when no legacy file imports from 'lucide-react-native'
// (the kit's Icon imports `lucide-react-native/icons/*` directly).
// ────────────────────────────────────────────────────────────────

const fs = require('node:fs');
const path = require('node:path');

const PACKAGE = 'lucide-react-native';
const TYPE_ONLY = new Set(['LucideIcon', 'LucideProps', 'IconNode']);

/** @type {Map<string, string> | null} export name → icon file basename */
let nameMap = null;

function loadNameMap() {
  if (nameMap) return nameMap;
  // 1.x `exports` hides package.json; the CommonJS main is dist/cjs/lucide-react-native.js.
  const pkgDir = path.resolve(path.dirname(require.resolve(PACKAGE, { paths: [__dirname] })), '../..');
  const barrel = fs.readFileSync(path.join(pkgDir, 'dist/esm/lucide-react-native.mjs'), 'utf8');
  const map = new Map();
  // export { default as A, default as AIcon, default as LucideA } from './icons/a.mjs';
  const re = /export\s*\{([^}]*)\}\s*from\s*'\.\/icons\/([a-z0-9-]+)\.mjs'/g;
  let m;
  while ((m = re.exec(barrel))) {
    for (const part of m[1].split(',')) {
      const name = part.replace(/^\s*default\s+as\s+/, '').trim();
      if (name) map.set(name, m[2]);
    }
  }
  if (map.size === 0) throw new Error(`[lucide-icons] could not read the ${PACKAGE} barrel at ${pkgDir}`);
  nameMap = map;
  return map;
}

module.exports = function lucideIconsPlugin({ types: t }) {
  return {
    name: 'lucide-per-icon-imports',
    visitor: {
      ImportDeclaration(nodePath, state) {
        const node = nodePath.node;
        if (node.source.value !== PACKAGE || node.importKind === 'type') return;
        const map = loadNameMap();
        const replacements = [];
        for (const spec of node.specifiers) {
          if (!t.isImportSpecifier(spec)) {
            throw nodePath.buildCodeFrameError(`[lucide-icons] only named imports from '${PACKAGE}' are supported`);
          }
          const imported = t.isIdentifier(spec.imported) ? spec.imported.name : spec.imported.value;
          if (spec.importKind === 'type' || TYPE_ONLY.has(imported)) continue;
          const file = map.get(imported);
          if (!file) {
            throw nodePath.buildCodeFrameError(
              `[lucide-icons] '${imported}' is not an icon in ${PACKAGE} (${state.filename ?? 'unknown file'})`,
            );
          }
          replacements.push(
            t.importDeclaration(
              [t.importDefaultSpecifier(t.identifier(spec.local.name))],
              t.stringLiteral(`${PACKAGE}/icons/${file}`),
            ),
          );
        }
        if (replacements.length > 0) nodePath.replaceWithMultiple(replacements);
        else nodePath.remove();
      },
    },
  };
};
