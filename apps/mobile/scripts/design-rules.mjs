// Mobile design restrictions shared by ESLint and the shrink-only audit.
import { dirname, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

export const mobileDir = fileURLToPath(new URL('..', import.meta.url));
export const relativeMobile = (file) => relative(mobileDir, file).split(sep).join('/');
const vocabulary = JSON.parse(readFileSync(new URL('../../../packages/design-tokens/generated/vocabulary.json', import.meta.url), 'utf8'));
const legacy = [...vocabulary.legacyUtilityNames, 'control', 'control-strong', 'control-foreground'];
const utility = '(?:bg|text|border|ring|fill|stroke|outline|divide|from|via|to|shadow|accent|caret|decoration|placeholder)';
export const classRules = {
  hardcodedPaletteClass: new RegExp(`^${utility}-(?:red|rose|pink|fuchsia|purple|violet|indigo|blue|sky|cyan|teal|emerald|green|lime|yellow|amber|orange|stone|neutral|zinc|gray|slate)-\\d{2,3}`),
  whiteBlackClass: new RegExp(`^${utility}-(?:white|black)(?:/|$)`),
  defaultTextSize: /^text-(?:xs|sm|base|lg|xl|[2-9]xl)$/,
  defaultRadius: /^rounded(?:-[trblxyse]{1,2})?(?:-(?:xs|sm|md|lg|xl|[234]xl))?$/,
  defaultShadow: /^shadow(?:-(?:2xs|xs|sm|md|lg|xl|2xl|inner))?$/,
  arbitraryValue: /\[.+\]/,
  varInClassString: /var\(--|-\(--/,
  legacyTokenUtility: new RegExp(`^${utility}-(?:${legacy.join('|')})(?:/|$)`),
  mobileBannedShared: /^(?:(?:h|min-h|max-h)-strip|(?:w|min-w|max-w|z)-rail|(?:w|max-w)-(?:aside|side-rail|inspector)|h-th)$/,
  defaultBreakpoint: /(?:^|:)(?:sm|md|lg|xl|2xl):/,
  platformClassVariant: /(?:^|:)(?:ios|android|native|web|tv):/,
  darkVariant: /(?:^|:)(?:dark|light):/,
  fixedRowHeight: /^h-(?:row|row-2|item|nav|step|tile|th)$/,
  boldWeight: /^font-(?:bold|extrabold|black)$/,
};
const reportRule = {
  meta: { type: 'problem', schema: [], messages: Object.fromEntries([
    ...Object.keys(classRules), 'hexOrRgbInTs', 'literalInlineStyle', 'styleSheetColor', 'fontFamilyLiteral',
    'noFontScalingOff', 'rawTextImport', 'lucideDirectImport', 'symbolsImport', 'hapticsImport', 'glassImport',
    'uniwindImport', 'themeColorsInFeature', 'platformOs', 'unstyledVariant', 'routerPresentation', 'featureData', 'uiData', 'storiesPresent',
  ].map((id) => [id, `${id}: use the mobile kit and vocabulary (02 §9.8).`])) },
  create(context) {
    const path = relativeMobile(context.filename);
    const ui = path.startsWith('src/ui/');
    const nativeRouter = path.startsWith('src/ui/native/router/');
    const icon = path.startsWith('src/ui/primitives/Icon/');
    const native = path.startsWith('src/ui/native/');
    const story = path.endsWith('.stories.tsx');
    const platformAllowed = /^src\/ui\/platform\//.test(path) || (ui && /\.(ios|android)\.tsx$/.test(path)) || /^src\/services\/(notifications|native)\//.test(path);
    let hasJsx = false;
    const terminal = /^src\/(terminal|blocks\/TerminalView\/engine)\//.test(path);
    const report = (node, messageId) => context.report({ node, messageId });
    const checkClasses = (node, value) => {
      for (const word of value.split(/\s+/)) {
        const base = word.split(':').at(-1).replace(/^!/, '');
        for (const [id, pattern] of Object.entries(classRules)) {
          if (id === 'varInClassString' && path.startsWith('src/ui/lib/')) continue;
          // Gate A (MD-115): uniwind 1.12.1 fixes the ios:/android: leak, so the kit may use platform classes.
          if (id === 'platformClassVariant' && ui) continue;
          if (id === 'arbitraryValue' && path.startsWith('src/ui/lib/') && context.sourceCode.getAllComments().some((c) => /geometry|vocabulary|token/i.test(c.value))) continue;
          if (pattern.test(['defaultBreakpoint', 'platformClassVariant', 'darkVariant', 'arbitraryValue', 'varInClassString'].includes(id) ? word : base)) report(node, id);
        }
      }
    };
    function strings(node, visit) {
      if (!node) return;
      if (node.type === 'Literal' && typeof node.value === 'string') visit(node, node.value);
      if (node.type === 'TemplateLiteral') node.quasis.forEach((q) => visit(q, q.value.cooked ?? q.value.raw));
      for (const key of context.sourceCode.visitorKeys[node.type] ?? []) {
        const child = node[key];
        if (Array.isArray(child)) child.forEach((n) => n && strings(n, visit));
        else if (child && typeof child === 'object') strings(child, visit);
      }
    }
    const color = (node, value) => { if (!terminal && /(?:#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\()/i.test(value)) report(node, 'hexOrRgbInTs'); };
    function importCheck(node, source, specifiers = []) {
      const names = specifiers.map((s) => s.imported?.name ?? s.imported?.value ?? (s.type === 'ImportNamespaceSpecifier' ? '*' : 'default'));
      if (source === 'react-native') {
        if (names.includes('Platform') && !platformAllowed) report(node, 'platformOs');
        if (!ui && !story && names.some((n) => ['Text', 'TextInput', 'Pressable', 'TouchableOpacity', 'TouchableHighlight', '*'].includes(n))) report(node, 'rawTextImport');
      }
      if (/^lucide-react-native(?:\/|$)/.test(source) && !icon) report(node, 'lucideDirectImport');
      if (['expo-symbols', '@expo/material-symbols'].includes(source) && !icon && !native) report(node, 'symbolsImport');
      if (source === 'expo-haptics' && path !== 'src/ui/platform/haptics.ts') report(node, 'hapticsImport');
      if (source === 'expo-glass-effect' && !/^src\/ui\/native\/GlassSurface\//.test(path) && path !== 'src/ui/platform/glass.ts') report(node, 'glassImport');
      if (source === 'uniwind' && !ui && !path.startsWith('src/theme/')) report(node, 'uniwindImport');
      if (names.some((n) => ['useThemeColors', 'getThemeColors'].includes(n)) && !/^src\/(ui|services|theme)\//.test(path)) report(node, 'themeColorsInFeature');
      if (ui && /^expo-router(?:\/|$)/.test(source)) {
        if (!nativeRouter || source !== 'expo-router' || names.some((n) => !['Stack', 'Link'].includes(n))) report(node, 'routerPresentation');
      }
      if (ui && /^(?:@tanstack\/react-query|zustand|@generatorai\/client-(?:core|runtime|transport))(?:\/|$)/.test(source) && node.importKind !== 'type') report(node, 'uiData');
      if (/^src\/features\//.test(path) && !/\/queries\.tsx?$/.test(path) && /^(?:@tanstack\/react-query|@generatorai\/client-(?:runtime|transport))(?:\/|$)/.test(source) && node.importKind !== 'type') report(node, 'featureData');
    }
    return {
      JSXOpeningElement(node) {
        hasJsx = true;
        if (nativeRouter && node.name.type === 'JSXIdentifier' && ['Stack', 'Link'].includes(node.name.name)) report(node, 'routerPresentation');
      },
      'Program:exit'(node) {
        if (!ui || story || !hasJsx) return;
        // `<Name>Js.tsx` is the JS path of a native wrapper (03 §1.3 N); `<Name>.stories.tsx` covers it (MD-130).
        const name = basename(context.filename).replace(/(?:\.(ios|android))?\.tsx$/, '').replace(/(?<=[a-z])Js$/, '');
        if (!existsSync(`${dirname(context.filename)}/${name}.stories.tsx`)) report(node, 'storiesPresent');
      },
      ImportDeclaration(node) { importCheck(node, node.source.value, node.specifiers); },
      ExportNamedDeclaration(node) { if (node.source) importCheck(node, node.source.value, node.specifiers); },
      ExportAllDeclaration(node) { importCheck(node, node.source.value, [{ type: 'ImportNamespaceSpecifier' }]); },
      ImportExpression(node) { if (typeof node.source.value === 'string') importCheck(node, node.source.value, [{ type: 'ImportNamespaceSpecifier' }]); },
      Literal(node) { if (typeof node.value === 'string') color(node, node.value); },
      TemplateElement(node) { color(node, node.value.cooked ?? node.value.raw); },
      JSXAttribute(node) {
        const name = node.name.name;
        if (/className$/.test(name)) strings(node.value, checkClasses);
        if (name === 'variant' && node.value?.value === 'unstyled') report(node, 'unstyledVariant');
        if (name === 'allowFontScaling' && node.value?.expression?.value === false && !terminal) report(node, 'noFontScalingOff');
        if (name === 'style') {
          // Values computed from tokens/geometry are allowed; literal object properties are not.
          const walk = (n) => {
            if (!n) return;
            if (n.type === 'Property' && (n.value.type === 'Literal' || (n.value.type === 'UnaryExpression' && n.value.argument.type === 'Literal'))) report(n, 'literalInlineStyle');
            for (const k of context.sourceCode.visitorKeys[n.type] ?? []) {
              const child = n[k];
              if (Array.isArray(child)) child.forEach(walk); else if (child && typeof child === 'object') walk(child);
            }
          };
          walk(node.value);
        }
      },
      CallExpression(node) {
        if (['cn', 'cva', 'clsx', 'twMerge'].includes(node.callee.name)) node.arguments.forEach((arg) => strings(arg, checkClasses));
        if (node.callee.type === 'MemberExpression' && node.callee.object.name === 'StyleSheet' && node.callee.property.name === 'create' && /^(app\/|src\/(features|blocks)\/)/.test(path)) report(node, 'styleSheetColor');
      },
      Property(node) {
        const name = node.key.name ?? node.key.value;
        if (name === 'fontFamily' && path !== 'src/ui/primitives/Text.tsx' && !terminal) report(node, 'fontFamilyLiteral');
        if (name === 'fontWeight' && /^(700|800|900|bold)$/.test(String(node.value.value))) report(node, 'boldWeight');
      },
      MemberExpression(node) {
        if (node.object.name === 'Platform' && !platformAllowed) report(node, 'platformOs');
        if (node.object.name === 'ReactNative' && node.property.name === 'Platform' && !platformAllowed) report(node, 'platformOs');
      },
    };
  },
};
export default { rules: { design: reportRule } };
