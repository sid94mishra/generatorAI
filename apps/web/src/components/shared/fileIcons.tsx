// ────────────────────────────────────────────────────────────────
// fileIcons — one file-type icon set, shared by every surface
// ────────────────────────────────────────────────────────────────
//
// The file tree renders inside @pierre/trees' shadow root and draws its own
// icons from a built-in sprite. Everything else — right-pane tabs, the diff's
// file rows, the opened-file header, the codebase browser — is ordinary
// React. Drawing those from a *different* icon set (we used to use
// `material-file-icons`) meant the same `.ts` file was one glyph in the tree
// and a different glyph on the tab above it.
//
// So this module renders the tree's OWN sprite. `getBuiltInSpriteSheet` and
// `createFileTreeIconResolver` are public exports intended for exactly this,
// which means the matching rules (exact filename → extension → default) are
// not reimplemented here: the tree and this component ask the same resolver
// the same question and get the same answer by construction.
//
// Colour is the one thing that cannot be shared directly, because the
// library defines its palette inside the shadow root. `--file-icon-*` in
// globals.css mirrors it, keyed by the token the resolver hands back.

import { useEffect, useMemo } from 'react';
import { Folder, FolderOpen } from 'lucide-react';
import { createFileTreeIconResolver, getBuiltInSpriteSheet } from '@pierre/trees';
import { cn } from '@/lib/utils.js';

/**
 * Icon set, shared with the file tree.
 *
 * Exported so `ChangesTree` configures @pierre/trees from this exact value
 * rather than its own copy — two literals that had to stay equal is the bug
 * this module exists to remove.
 *
 * `complete` is the widest of the three built-ins: the point of the feature
 * is recognising a file at a glance, and the smaller sets fall back to the
 * generic document for anything unusual.
 */
export const FILE_ICON_SET = { set: 'complete', colored: true } as const;

const resolver = createFileTreeIconResolver(FILE_ICON_SET);

/**
 * Token → palette variable, mirroring @pierre/trees' own mapping.
 *
 * Tokens the library leaves uncoloured (`font`, `nextjs`, `stylelint`) are
 * absent on purpose: they fall through to the muted foreground, which is
 * what the tree shows for them too.
 */
const TOKEN_COLOR: Record<string, string> = {
  astro: 'purple',
  babel: 'yellow',
  bash: 'green',
  biome: 'blue',
  bootstrap: 'indigo',
  browserslist: 'yellow',
  bun: 'mauve',
  c: 'blue',
  claude: 'orange',
  cpp: 'blue',
  css: 'indigo',
  database: 'purple',
  default: 'gray',
  docker: 'blue',
  eslint: 'indigo',
  git: 'vermilion',
  go: 'cyan',
  graphql: 'pink',
  html: 'orange',
  image: 'pink',
  javascript: 'yellow',
  json: 'orange',
  markdown: 'green',
  mcp: 'teal',
  npm: 'red',
  oxc: 'cyan',
  postcss: 'red',
  prettier: 'teal',
  python: 'blue',
  react: 'cyan',
  ruby: 'red',
  rust: 'orange',
  sass: 'pink',
  svelte: 'red',
  svg: 'orange',
  svgo: 'green',
  swift: 'orange',
  table: 'teal',
  tailwind: 'cyan',
  terraform: 'indigo',
  text: 'gray',
  typescript: 'blue',
  vite: 'purple',
  vscode: 'blue',
  vue: 'green',
  wasm: 'indigo',
  webpack: 'blue',
  yml: 'red',
  zig: 'orange',
  zip: 'orange',
};

const SPRITE_ID = 'pierre-file-icon-sprite';

/**
 * Put the sprite in the document once.
 *
 * `<use href="#id">` resolves against the containing tree, so the symbols
 * have to live in the light DOM for our React icons to reach them — the
 * tree's own copy is sealed inside its shadow root.
 */
function ensureSprite(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(SPRITE_ID)) return;
  const holder = document.createElement('div');
  holder.id = SPRITE_ID;
  // Out of the layout and out of the a11y tree; it paints nothing itself.
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  // Trusted, static library asset — no user input reaches this.
  holder.innerHTML = getBuiltInSpriteSheet(FILE_ICON_SET.set);
  document.body.prepend(holder);
}

/**
 * Colour-coded file-type icon for a filename, matching the file tree.
 *
 * `name` may be a bare basename or a whole path; the resolver only looks at
 * the last segment.
 */
export function FileTypeIcon({ name, className }: { name: string; className?: string }) {
  // Injected on mount rather than at import time so this module stays safe
  // to import in a non-DOM context (tests, SSR).
  useEffect(ensureSprite, []);

  const icon = useMemo(() => resolver.resolveIcon('file-tree-icon-file', name), [name]);
  const palette = icon.token ? TOKEN_COLOR[icon.token] : undefined;

  return (
    <svg
      aria-hidden
      data-icon-token={icon.token}
      viewBox={icon.viewBox ?? '0 0 16 16'}
      className={cn('shrink-0', className ?? 'h-4 w-4')}
      style={{
        color: palette
          ? `var(--file-icon-${palette})`
          : 'var(--color-muted-foreground)',
        // The sprite's paths are filled, not stroked.
        fill: 'currentColor',
      }}
    >
      <use href={`#${icon.name}`} />
    </svg>
  );
}

/**
 * Folder icon (open/closed).
 *
 * Not from the sprite: @pierre/trees draws folders as a chevron, which reads
 * as "expandable row" and only makes sense inside a tree. A flat listing
 * (the codebase browser) needs a glyph that says "folder" on its own.
 */
export function FolderTypeIcon({ open, className }: { open?: boolean; className?: string }) {
  const Icon = open ? FolderOpen : Folder;
  return (
    <Icon
      className={cn('shrink-0', className ?? 'h-4 w-4')}
      style={{ color: 'var(--file-icon-yellow)' }}
    />
  );
}
