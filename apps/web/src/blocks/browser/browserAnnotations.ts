// ────────────────────────────────────────────────────────────────
// Browser comments and screenshots → chat attachments (D-140). Pure.
//
// Sending N comments makes ONE Markdown file — every numbered comment with
// the element (or area) it is about — plus one PNG per comment showing it in
// context. One file the agent reads top to bottom beats 2N loose files, and
// the composer shows N+1 chips instead of 2N.
// ────────────────────────────────────────────────────────────────

import type { BrowserAnnotationSummary, BrowserPickResult } from '@generatorai/shared';

/** A sent comment, as the page serialised it. */
export type PickedElement = BrowserPickResult;
/** A comment as the tray lists it. */
export type AnnotationSummary = BrowserAnnotationSummary;

/** What the agent is told when comments are sent without a message of your own. */
export const BROWSER_COMMENTS_PROMPT =
  'Please address my browser comments. The .md file lists each numbered comment with the element or area it is about; the matching .png shows it on the page.';

/** Attachment names the composer recognises as browser comments (it supplies BROWSER_COMMENTS_PROMPT). */
export const BROWSER_COMMENT_FILE = /^browser-comments-/;

function screenshotName(stem: string, n: number): string {
  return `${stem}-${n}.png`;
}

function one(p: PickedElement, index: number, stem: string): string {
  const n = p.n ?? index + 1;
  const area = p.tag === 'area';
  const box = p.boundingBox;
  const css = p.computedStyle
    ? Object.entries(p.computedStyle).map(([k, v]) => `  ${k}: ${v};`).join('\n')
    : '';
  const lines = [
    `## ${n}. ${(p.comment ?? '').trim() || '_(no comment)_'}`,
    '',
    area
      ? `- **Area:** ${Math.round(box.width)}×${Math.round(box.height)} at (${Math.round(box.x)}, ${Math.round(box.y)}) in a ${p.viewport ? `${p.viewport.width}×${p.viewport.height}` : ''} viewport`
      : `- **Element:** \`${p.label}\``,
    area ? '' : `- **Selector:** \`${p.cssSelector}\``,
    area || !p.text ? '' : `- **Text:** “${p.text}”`,
    area ? '' : `- **Size:** ${Math.round(box.width)}×${Math.round(box.height)}`,
    p.screenshot ? `- **Screenshot:** \`${screenshotName(stem, n)}\`` : '',
  ].filter((l) => l !== '');
  if (!area && p.outerHtml) lines.push('', '```html', p.outerHtml, '```');
  if (!area && css) lines.push('', '<details><summary>Computed CSS</summary>', '', '```css', `${p.cssSelector} {`, css, '}', '```', '</details>');
  return lines.join('\n');
}

/** The Markdown for a batch of comments on one page. */
export function commentsMarkdown(items: readonly PickedElement[], stem: string): string {
  const first = items[0];
  const count = items.length;
  const header = [
    `# Browser comments (${count})`,
    '',
    first ? `Page: ${first.title ? `${first.title} — ` : ''}${first.url}` : '',
    '',
    'Each comment is about the element or area below it; the screenshot shows it on the page with its numbered pin.',
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '');
  return [...header, '', ...items.map((p, i) => one(p, i, stem)).flatMap((s) => [s, ''])].join('\n');
}

/** A PNG data URL as a File. Throws on bad base64. */
export function dataUrlFile(dataUrl: string, name: string): File {
  const bstr = atob(dataUrl.split(',')[1] ?? '');
  const u8 = new Uint8Array(bstr.length);
  for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
  return new File([new Blob([u8], { type: 'image/png' })], name, { type: 'image/png' });
}

/** `browser-comments-<stamp>.md` plus `browser-comments-<stamp>-<n>.png` per comment that has a screenshot. */
export function commentFiles(items: readonly PickedElement[], stamp: string): File[] {
  if (items.length === 0) return [];
  const stem = `browser-comments-${stamp}`;
  const files = [new File([new Blob([commentsMarkdown(items, stem)], { type: 'text/markdown' })], `${stem}.md`, { type: 'text/markdown' })];
  items.forEach((p, i) => {
    if (!p.screenshot) return;
    try {
      files.push(dataUrlFile(p.screenshot, screenshotName(stem, p.n ?? i + 1)));
    } catch { /* a broken capture just goes without its picture */ }
  });
  return files;
}

/** A sortable, filename-safe stamp: `20261011-142233`. */
export function fileStamp(date = new Date()): string {
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
