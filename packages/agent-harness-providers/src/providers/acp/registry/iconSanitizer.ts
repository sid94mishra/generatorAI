// ────────────────────────────────────────────────────────────────
// Registry icon → sanitised `ProviderMark` (docs/acp ACP-5).
//
// Registry icons are third-party SVG. They are parsed (strict XML, saxes)
// against an allow-list and re-emitted as data `{viewBox, nodes:[{tag, attrs}]}`
// that a client draws as plain SVG elements — so no third-party markup or URL
// ever reaches the web: no scripts, no `<use href>`, no `<style>`, no `<text>`
// (fonts), no foreign objects, no event attributes, no external references.
//
//   Elements:   svg (root) · g · path · circle · ellipse · rect · line · polyline · polygon
//               (title/desc are dropped; any other element is dropped WITH its subtree)
//   Attributes: geometry per element, fill/stroke ∈ {currentColor, none, inherit} (any other paint is
//               dropped, so the mark stays monochrome and takes the text colour), stroke-*, fill-rule,
//               clip-rule, opacity, fill-opacity, stroke-opacity, transform (matrix/translate/scale/rotate/
//               skewX/skewY with numbers only). Every value is checked against a strict pattern.
//   Root:       viewBox (else `0 0 width height`, else `0 0 16 16`); the root's own paint attributes are
//               kept on a wrapping `g` so children inherit them as in the source.
// ────────────────────────────────────────────────────────────────

import { SaxesParser } from 'saxes';
import type { ProviderMark, ProviderMarkNode, ProviderMarkTag } from '@generatorai/shared';

/** Icons above this are refused (the registry's largest today is 13.6 KB). */
export const MAX_ICON_BYTES = 64 * 1024;
/** Element budget, so a pathological icon cannot become a huge payload. */
const MAX_NODES = 2_000;

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?(px)?$/;
const NUMBER_LIST = /^[\d\s,.eE+-]*$/;
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz\d\s,.eE+-]*$/;
const TRANSFORM = /^(\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(\s*[\d\s,.eE+-]*\)\s*,?)*\s*$/;
const PAINT = /^(currentColor|none|inherit)$/;
const OPACITY = /^(0|1|0?\.\d+|1\.0+|\d{1,3}%)$/;

type Check = (v: string) => boolean;
const num: Check = (v) => NUMBER.test(v.trim());
const re = (r: RegExp): Check => (v) => r.test(v.trim());
const oneOf = (...values: string[]): Check => (v) => values.includes(v.trim());

/** Attributes any drawable element (and `g`) may carry. */
const PRESENTATION: Record<string, Check> = {
  fill: re(PAINT),
  stroke: re(PAINT),
  'stroke-width': num,
  'stroke-linecap': oneOf('butt', 'round', 'square', 'inherit'),
  'stroke-linejoin': oneOf('miter', 'round', 'bevel', 'arcs', 'miter-clip', 'inherit'),
  'stroke-miterlimit': num,
  'stroke-dasharray': (v) => v.trim() === 'none' || NUMBER_LIST.test(v),
  'stroke-dashoffset': num,
  'stroke-opacity': re(OPACITY),
  'fill-opacity': re(OPACITY),
  'fill-rule': oneOf('nonzero', 'evenodd', 'inherit'),
  'clip-rule': oneOf('nonzero', 'evenodd', 'inherit'),
  opacity: re(OPACITY),
  transform: re(TRANSFORM),
};

const GEOMETRY: Record<ProviderMarkTag, Record<string, Check>> = {
  g: {},
  path: { d: re(PATH_DATA) },
  circle: { cx: num, cy: num, r: num },
  ellipse: { cx: num, cy: num, rx: num, ry: num },
  rect: { x: num, y: num, width: num, height: num, rx: num, ry: num },
  line: { x1: num, y1: num, x2: num, y2: num },
  polyline: { points: re(NUMBER_LIST) },
  polygon: { points: re(NUMBER_LIST) },
};

function isMarkTag(name: string): name is ProviderMarkTag {
  return Object.prototype.hasOwnProperty.call(GEOMETRY, name);
}

function cleanAttrs(tag: ProviderMarkTag | 'svg', raw: Record<string, string>): Record<string, string> {
  const allowed = tag === 'svg' ? PRESENTATION : { ...PRESENTATION, ...GEOMETRY[tag] };
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    const check = Object.prototype.hasOwnProperty.call(allowed, name) ? allowed[name] : undefined;
    if (check && value.length <= 20_000 && check(value)) out[name] = value.trim();
  }
  if (tag === 'svg') delete out['transform'];
  return out;
}

function viewBoxOf(attrs: Record<string, string>): string {
  const vb = attrs['viewBox']?.trim();
  if (vb && /^[+-]?[\d.]+([\s,]+[+-]?[\d.]+){3}$/.test(vb)) return vb.split(/[\s,]+/).join(' ');
  const w = attrs['width']?.replace(/px$/, '');
  const h = attrs['height']?.replace(/px$/, '');
  if (w && h && NUMBER.test(w) && NUMBER.test(h)) return `0 0 ${Number(w)} ${Number(h)}`;
  return '0 0 16 16';
}

/** Whether a node (or anything under it) draws something. */
function draws(node: ProviderMarkNode): boolean {
  if (node.tag !== 'g') return true;
  return (node.children ?? []).some(draws);
}

/**
 * Parse and sanitise an SVG icon. Null when it is not a well-formed SVG, is too large, or nothing drawable
 * survives the allow-list (the client then shows its generic agent mark).
 */
export function sanitizeSvgIcon(svg: string): ProviderMark | null {
  if (Buffer.byteLength(svg, 'utf8') > MAX_ICON_BYTES) return null;
  const parser = new SaxesParser({ xmlns: false, position: false });
  let viewBox: string | null = null;
  let rootPaint: Record<string, string> = {};
  const root: ProviderMarkNode[] = [];
  /** The children list each open element appends to; `null` = inside a dropped subtree. */
  const stack: Array<ProviderMarkNode[] | null> = [];
  let depth = 0;
  let count = 0;
  let sawRoot = false;

  parser.on('opentag', (tag) => {
    depth++;
    const name = tag.name.includes(':') ? tag.name.slice(tag.name.indexOf(':') + 1) : tag.name;
    const attrs = Object.fromEntries(Object.entries(tag.attributes).map(([k, v]) => [k, String(v)]));
    if (depth === 1) {
      if (name !== 'svg') throw new Error('not an SVG');
      sawRoot = true;
      viewBox = viewBoxOf(attrs);
      rootPaint = cleanAttrs('svg', attrs);
      stack.push(root);
      return;
    }
    const parent = stack[stack.length - 1] ?? null;
    if (parent === null || !isMarkTag(name) || ++count > MAX_NODES) {
      if (count > MAX_NODES) throw new Error('icon too complex');
      // title/desc, or unknown/unsafe (`text`, `style`, `use`, `defs`, `image`, `script`, …): the subtree goes.
      stack.push(null);
      return;
    }
    const node: ProviderMarkNode = { tag: name, attrs: cleanAttrs(name, attrs) };
    parent.push(node);
    if (name === 'g') {
      node.children = [];
      stack.push(node.children);
    } else {
      // Drawable elements have no children we keep (animate, title…).
      stack.push(null);
    }
  });
  parser.on('closetag', () => {
    depth--;
    stack.pop();
  });

  try {
    parser.write(svg).close();
  } catch {
    return null;
  }
  if (!sawRoot || viewBox === null) return null;

  const prune = (nodes: ProviderMarkNode[]): ProviderMarkNode[] =>
    nodes
      .map((n) => (n.tag === 'g' ? { ...n, children: prune(n.children ?? []) } : n))
      .filter(draws);
  let nodes = prune(root);
  if (nodes.length === 0) return null;
  if (Object.keys(rootPaint).length > 0) nodes = [{ tag: 'g', attrs: rootPaint, children: nodes }];
  return { viewBox, nodes };
}
