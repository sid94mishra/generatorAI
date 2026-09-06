#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Accessible-name audit for form controls and buttons.
//
// Walks every non-test .tsx under apps/web/src with the TypeScript parser
// and reports interactive elements that have NO discoverable accessible
// name — the thing a screen reader announces. This is a static
// approximation of axe-core's `button-name` / `label` rules:
//
//   named   aria-label / aria-labelledby / title / placeholder,
//           visible text content (JSX text, `{expr}` that is not just an
//           icon), an `sr-only` span, a wrapping <label>, or a
//           <label htmlFor> elsewhere in the same file pointing at its id.
//   unnamed everything else — typically an icon-only <button> or an
//           <input> with no label.
//
// A `{...spread}` on the element is treated as "unknown" and skipped, since
// the name may arrive through props.
//
// Usage:
//   node scripts/check-a11y-names.mjs            # human report
//   node scripts/check-a11y-names.mjs --json     # machine-readable list
//   node scripts/check-a11y-names.mjs --max N    # exit 1 if unnamed > N
// ────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import ts from 'typescript';

const srcDir = resolve(process.cwd(), 'src');
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const maxIdx = argv.indexOf('--max');
const max = maxIdx >= 0 ? Number(argv[maxIdx + 1]) : null;

const EXEMPT = [/\.test\.(ts|tsx)$/, /__tests__/, /[\\/]components[\\/]ui[\\/]primitives[\\/]/];

const BUTTON_LIKE = new Set(['button', 'Button']);
const FIELD_LIKE = new Set([
  'input',
  'Input',
  'textarea',
  'Textarea',
  'select',
  'Select',
  'SearchInput',
  'SearchableSelect',
]);

function collect(dir) {
  let out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === 'node_modules') continue;
      out = out.concat(collect(full));
    } else if (/\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function attrName(attr) {
  if (!ts.isJsxAttribute(attr)) return null;
  return ts.isIdentifier(attr.name) ? attr.name.text : attr.name.getText();
}

function attrLiteral(attr) {
  if (!attr.initializer) return null;
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
  if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
    const e = attr.initializer.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  }
  return null;
}

/** Does this expression plausibly produce text (vs. only an icon)? */
function expressionHasText(expr) {
  if (!expr) return false;
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr) || ts.isTemplateExpression(expr)) {
    return expr.getText().replace(/[`'"]/g, '').trim().length > 0;
  }
  if (ts.isParenthesizedExpression(expr)) return expressionHasText(expr.expression);
  if (ts.isConditionalExpression(expr)) {
    return expressionHasText(expr.whenTrue) || expressionHasText(expr.whenFalse);
  }
  if (ts.isBinaryExpression(expr)) {
    return expressionHasText(expr.left) || expressionHasText(expr.right);
  }
  if (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr) || ts.isJsxFragment(expr)) {
    return jsxHasText(expr);
  }
  // `{label}`, `{item.name}`, `{format(x)}`, `{children}` — assume text.
  if (ts.isIdentifier(expr) || ts.isPropertyAccessExpression(expr) || ts.isCallExpression(expr) || ts.isElementAccessExpression(expr)) {
    return true;
  }
  if (ts.isNumericLiteral(expr)) return true;
  return false;
}

function isIconLike(el) {
  const tag = ts.isJsxSelfClosingElement(el) ? el.tagName : el.openingElement.tagName;
  const name = tag.getText();
  return name === 'svg' || /^[A-Z]/.test(name);
}

function hasAria(attrs, names) {
  for (const a of attrs.properties) {
    const n = attrName(a);
    if (n && names.includes(n)) return true;
  }
  return false;
}

function jsxHasText(node) {
  if (ts.isJsxText(node)) return node.text.trim().length > 0;
  if (ts.isJsxExpression(node)) return expressionHasText(node.expression);
  if (ts.isJsxSelfClosingElement(node)) {
    if (hasAria(node.attributes, ['aria-label', 'aria-hidden'])) {
      return hasAria(node.attributes, ['aria-label']);
    }
    return !isIconLike(node) && false;
  }
  if (ts.isJsxElement(node)) {
    const attrs = node.openingElement.attributes;
    if (hasAria(attrs, ['aria-label'])) return true;
    if (hasAria(attrs, ['aria-hidden'])) return false;
    return node.children.some(jsxHasText);
  }
  if (ts.isJsxFragment(node)) return node.children.some(jsxHasText);
  return false;
}

function hasLabelAncestor(node) {
  let p = node.parent;
  while (p) {
    if (ts.isJsxElement(p) && p.openingElement.tagName.getText() === 'label') return true;
    if (ts.isFunctionLike(p)) return false;
    p = p.parent;
  }
  return false;
}

function analyzeFile(file) {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const htmlForIds = new Set();
  const results = [];

  // First pass — collect htmlFor targets.
  const collectFor = (n) => {
    if (ts.isJsxAttribute(n) && attrName(n) === 'htmlFor') {
      const lit = attrLiteral(n);
      if (lit) htmlForIds.add(lit);
      else if (n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression) {
        htmlForIds.add(`{${n.initializer.expression.getText()}}`);
      }
    }
    ts.forEachChild(n, collectFor);
  };
  collectFor(sf);

  const visit = (n) => {
    let opening = null;
    let element = null;
    if (ts.isJsxSelfClosingElement(n)) {
      opening = n;
      element = n;
    } else if (ts.isJsxElement(n)) {
      opening = n.openingElement;
      element = n;
    }
    if (opening) {
      const tag = opening.tagName.getText();
      const isButton = BUTTON_LIKE.has(tag);
      const isField = FIELD_LIKE.has(tag);
      if (isButton || isField) {
        const attrs = opening.attributes;
        const spread = attrs.properties.some((a) => ts.isJsxSpreadAttribute(a));
        let named = spread || hasAria(attrs, ['aria-label', 'aria-labelledby', 'title']);
        let weak = false;
        let hidden = false;
        if (!named) {
          for (const a of attrs.properties) {
            const name = attrName(a);
            if (!name) continue;
            if (name === 'type' && attrLiteral(a) === 'hidden') hidden = true;
            if (name === 'className' && /\bhidden\b/.test(attrLiteral(a) ?? '')) hidden = true;
            if (isField && name === 'placeholder') {
              named = true;
              weak = true;
            }
            if (isField && name === 'id') {
              const lit = attrLiteral(a);
              if (lit && htmlForIds.has(lit)) named = true;
              if (!lit && a.initializer && ts.isJsxExpression(a.initializer) && a.initializer.expression) {
                if (htmlForIds.has(`{${a.initializer.expression.getText()}}`)) named = true;
              }
            }
          }
        }
        if (!named && isField && hasLabelAncestor(n)) named = true;
        if (!named && isButton && ts.isJsxElement(n) && n.children.some(jsxHasText)) named = true;
        if (!named && !hidden) {
          const { line } = sf.getLineAndCharacterOfPosition(opening.getStart());
          results.push({ tag, line: line + 1, kind: isButton ? 'button' : 'field' });
        } else if (named && weak) {
          const { line } = sf.getLineAndCharacterOfPosition(opening.getStart());
          results.push({ tag, line: line + 1, kind: 'field', weak: true });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return results;
}

const files = collect(srcDir).filter((f) => !EXEMPT.some((re) => re.test(f)));
const report = [];
let unnamed = 0;
let weak = 0;
let total = 0;

for (const file of files) {
  const rel = relative(process.cwd(), file).replace(/\\/g, '/');
  const rows = analyzeFile(file);
  for (const r of rows) {
    if (r.weak) weak += 1;
    else unnamed += 1;
    report.push({ file: rel, ...r });
  }
}

// Total interactive elements, for the ratio.
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  total += (text.match(/<(?:button|Button|input|Input|textarea|Textarea|select|Select|SearchInput|SearchableSelect)[\s>/]/g) ?? []).length;
}

if (asJson) {
  console.log(JSON.stringify({ total, unnamed, weak, items: report }, null, 2));
} else {
  const byFile = new Map();
  for (const r of report) {
    if (r.weak) continue;
    byFile.set(r.file, (byFile.get(r.file) ?? 0) + 1);
  }
  console.log(`[check-a11y-names] ${unnamed} unnamed of ${total} interactive elements (${weak} placeholder-only fields)`);
  for (const [f, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${f}`);
  }
  for (const r of report) {
    if (r.weak) continue;
    console.log(`${r.file}:${r.line}  <${r.tag}> (${r.kind})`);
  }
}

if (max !== null && unnamed > max) {
  console.error(`\n[check-a11y-names] ${unnamed} unnamed controls exceeds the allowed ${max}.`);
  process.exit(1);
}
