// ────────────────────────────────────────────────────────────────
// SyntaxHighlightedCode — Code viewer with line numbers + hljs
// ────────────────────────────────────────────────────────────────

import React, { useMemo, useState } from 'react';
import hljs from 'highlight.js';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { useHighlightTheme } from '@/hooks/useHighlightTheme.js';

/** Map common file extensions to highlight.js language aliases */
const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  mjs: 'javascript', cjs: 'javascript', mts: 'typescript', cts: 'typescript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
  cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c', hpp: 'cpp',
  sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
  json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml',
  toml: 'toml', xml: 'xml', html: 'xml', htm: 'xml', svg: 'xml',
  css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', graphql: 'graphql', proto: 'protobuf',
  dockerfile: 'dockerfile', makefile: 'makefile',
  swift: 'swift', kt: 'kotlin', dart: 'dart',
  r: 'r', lua: 'lua', vim: 'vim', tf: 'hcl',
  md: 'markdown', mdx: 'markdown',
};

export function extToLang(ext: string): string {
  return EXT_LANG_MAP[ext.toLowerCase()] ?? ext;
}

/** Resolve to a language highlight.js actually has registered, else null. */
function resolveHljsLanguage(lang: string): string | null {
  if (!lang) return null;
  return hljs.getLanguage(lang) ? lang : null;
}

interface SyntaxHighlightedCodeProps {
  code: string;
  language?: string;
  fileName?: string;
  showLineNumbers?: boolean;
  showCopyButton?: boolean;
  maxHeight?: string;
  className?: string;
}

export function SyntaxHighlightedCode({
  code,
  language,
  fileName,
  showLineNumbers = true,
  showCopyButton = true,
  maxHeight,
  className,
}: SyntaxHighlightedCodeProps) {
  const [copied, setCopied] = useState(false);
  useHighlightTheme();

  const ext = fileName ? fileName.split('.').pop() ?? '' : '';
  const lang = language ?? extToLang(ext);

  const highlighted = useMemo(() => {
    if (!code) return null;
    const resolved = resolveHljsLanguage(lang);
    try {
      // Use the explicit language only when hljs has it registered; otherwise
      // let hljs auto-detect. This avoids noisy "unknown language" errors for
      // extensions like .sln/.bak while still colourising known code.
      const result = resolved
        ? hljs.highlight(code, { language: resolved, ignoreIllegals: true })
        : hljs.highlightAuto(code);
      return result.value;
    } catch {
      try {
        return hljs.highlightAuto(code).value;
      } catch {
        return null;
      }
    }
  }, [code, lang]);

  const lines = code.split('\n');
  // Width of line number gutter based on digit count
  const gutterWidth = String(lines.length).length * 0.7 + 1.2;

  const handleCopy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className={cn('relative group', className)}>
      {/* Copy button (floats top-right) */}
      {showCopyButton && (
        <button
          onClick={handleCopy}
          className={cn(
            'absolute right-2 top-2 z-10 flex items-center gap-1 rounded px-1.5 py-1 text-[10px] transition-all',
            'opacity-0 group-hover:opacity-100',
            copied
              ? 'text-green-600 bg-green-50 dark:bg-green-900/20'
              : 'text-[var(--color-muted-foreground)] bg-[var(--color-background)]/80 hover:bg-[var(--color-accent)]',
          )}
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}

      <div
        className="overflow-auto"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <table className="w-full border-collapse">
          <tbody>
            {lines.map((line, index) => (
              <tr key={index} className="hover:bg-[var(--color-accent)]/20 leading-relaxed">
                {showLineNumbers && (
                  <td
                    className="select-none text-right align-top pr-3 font-mono text-[10px] text-[var(--color-muted-foreground)]/50 border-r border-[var(--color-border)]/40"
                    style={{ width: `${gutterWidth}em`, minWidth: `${gutterWidth}em` }}
                  >
                    {index + 1}
                  </td>
                )}
                <td className="pl-3 font-mono text-xs whitespace-pre text-[var(--color-foreground)]">
                  {highlighted ? (
                    <span
                      dangerouslySetInnerHTML={{
                        __html: getLineHtml(highlighted, index),
                      }}
                    />
                  ) : (
                    <span>{line || '\u00a0'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Split a full highlighted HTML string by newlines and get one line.
 * We cache the split per component render via useMemo in parent,
 * but for simplicity we do it per-call here.
 */
const lineCache = new WeakMap<object, string[]>();

function getLineHtml(fullHtml: string, lineIndex: number): string {
  // We use a simple string marker approach:
  // hljs output uses \n for line breaks but spans may cross lines.
  // We need to close open tags at line ends and re-open them.
  const key = { html: fullHtml };

  // Check if we have a cached version for this exact HTML
  // For performance, we split once and cache
  let cachedLines = lineCache.get(key);

  if (!cachedLines) {
    cachedLines = splitHtmlByLines(fullHtml);
    lineCache.set(key, cachedLines);
  }

  return cachedLines[lineIndex] ?? '\u00a0';
}

function splitHtmlByLines(html: string): string[] {
  // Simple approach: split by \n, track open <span> tags to carry across lines
  const rawLines = html.split('\n');
  const result: string[] = [];
  let openTags: string[] = [];

  for (const rawLine of rawLines) {
    // Prepend any tags that were open from previous line
    let line = openTags.join('') + rawLine;

    // Track open/close span tags
    const openMatches = line.match(/<span[^>]*>/g) ?? [];
    const closeMatches = line.match(/<\/span>/g) ?? [];

    // Update open tags for next line
    const netOpen = openMatches.length - closeMatches.length;

    if (netOpen > 0) {
      // Some tags weren't closed - close them for this line, carry them forward
      const closingSuffix = '</span>'.repeat(netOpen);
      line += closingSuffix;
      // For next line, we need to reopen those tags
      // Get the last `netOpen` opening tags
      openTags = openMatches.slice(-netOpen);
    } else if (netOpen < 0) {
      // More closes than opens - shouldn't happen with valid HTML, but handle gracefully
      openTags = [];
    } else {
      openTags = [];
    }

    result.push(line || '\u00a0');
  }

  return result;
}
