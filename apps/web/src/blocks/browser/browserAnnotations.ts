// ────────────────────────────────────────────────────────────────
// Native annotation (comment pin) → chat attachments. Pure.
//
// A drained annotation becomes a Markdown context file (the element summary
// plus the user's requested change) and, when the page cropped one, a PNG.
// ────────────────────────────────────────────────────────────────

/** A picked DOM element (native desktop) awaiting a user comment. */
export interface PickedElement {
  url: string;
  tag: string;
  id: string | null;
  classes: string[];
  label: string;
  text: string;
  cssSelector: string;
  xpath: string;
  outerHtml: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  computedStyle?: Record<string, string>;
  screenshot?: string | null;
  comment?: string;
}

/** A lightweight annotation list entry (count badge + comments popover). */
export interface AnnotationSummary {
  key: string;
  n: number;
  label: string;
  tag: string;
  comment: string;
  region: boolean;
}

/** The Markdown "UI change request" for one annotation. */
export function annotationMarkdown(p: PickedElement): string {
  const comment = (p.comment ?? '').trim();
  const cssLines = p.computedStyle
    ? Object.entries(p.computedStyle).map(([k, v]) => `  ${k}: ${v};`).join('\n')
    : '';
  return [
    `# UI change request`,
    ``,
    `**Requested change:** ${comment || '_(none provided)_'}`,
    ``,
    `## Selected element`,
    `- **Element:** \`${p.label}\``,
    `- **Tag:** \`${p.tag}\`${p.id ? ` · **id:** \`${p.id}\`` : ''}${p.classes.length ? ` · **classes:** \`${p.classes.join(' ')}\`` : ''}`,
    `- **Page:** ${p.url}`,
    `- **CSS selector:** \`${p.cssSelector}\``,
    `- **XPath:** \`${p.xpath}\``,
    p.text ? `- **Text:** ${p.text}` : '',
    `- **Box:** ${Math.round(p.boundingBox.width)}×${Math.round(p.boundingBox.height)} @ (${Math.round(p.boundingBox.x)}, ${Math.round(p.boundingBox.y)})`,
    ``,
    `## HTML`,
    '```html',
    p.outerHtml,
    '```',
    cssLines ? `\n## Computed CSS\n\`\`\`css\n${p.cssSelector} {\n${cssLines}\n}\n\`\`\`` : '',
    '',
  ].filter((l) => l !== '').join('\n');
}

/** `element-<id|tag>-<stamp>`: the shared stem of an annotation's files. */
export function annotationFileStem(p: PickedElement, stamp: string): string {
  const safe = (p.id || p.tag || 'element').replace(/[^a-z0-9]+/gi, '-').slice(0, 32);
  return `element-${safe}-${stamp}`;
}

export function annotationMarkdownFile(p: PickedElement, stem: string): File {
  return new File([new Blob([annotationMarkdown(p)], { type: 'text/markdown' })], `${stem}.md`, { type: 'text/markdown' });
}

/** The cropped screenshot (a base64 data URL) as a PNG file. Throws on bad base64. */
export function annotationScreenshotFile(dataUrl: string, stem: string): File {
  const bstr = atob(dataUrl.split(',')[1] ?? '');
  const u8 = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
  return new File([new Blob([u8], { type: 'image/png' })], `${stem}.png`, { type: 'image/png' });
}
