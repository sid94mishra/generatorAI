// ────────────────────────────────────────────────────────────────
// BrowserVisibilityPicker — UI for the `BrowserConfig.visibility`
// knob + companion `evalAllowed` and `allowedHosts` toggles.
//
// Ships in the New-Chat dialog and the Workflow Definition editor.
// Kept intentionally minimal — three visibility radios + a small
// switch for allowing `run_playwright_code`. Advanced options live
// on the workspace/workflow config editor (Phase 3+).
// ────────────────────────────────────────────────────────────────

import { Eye, EyeOff, Ban, Code2 } from 'lucide-react';
import { Input, Button } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';
import { Checkbox } from '@/components/ui/primitives/checkbox.js';

export type BrowserVisibility = 'visible' | 'headless' | 'off';

/**
 * The subset of BrowserConfig we let users edit from a modal / creation
 * form. Kept small on purpose — a full editor should live on a dedicated
 * settings surface with hosts, permissions, PII, etc.
 */
export interface BrowserPickerValue {
  visibility: BrowserVisibility;
  /** Enable `run_playwright_code` tool. Default false — security-safe. */
  evalAllowed?: boolean;
  /**
   * Comma/space-separated allowlist for the URL bar + agent navigations.
   * Empty = allow all. Stored server-side as `string[]` inside
   * `browserConfig.allowedHosts`.
   */
  allowedHostsCsv?: string;
}

export interface BrowserVisibilityPickerProps {
  value: BrowserPickerValue;
  onChange: (next: BrowserPickerValue) => void;
  /**
   * When true, render as a compact horizontal row (fits well inside
   * modals). Default (false) is a stacked, labelled layout.
   */
  compact?: boolean;
  /** Optional class for the outer container. */
  className?: string;
}

const OPTIONS: Array<{
  value: BrowserVisibility;
  label: string;
  hint: string;
  icon: React.ReactNode;
}> = [
  {
    value: 'headless',
    label: 'Headless',
    hint: 'Runs invisibly. Fast, safe, recommended default.',
    icon: <EyeOff className="h-3.5 w-3.5" />,
  },
  {
    value: 'visible',
    label: 'Visible',
    hint: "Auto-opens the Browser tab so you watch the agent live.",
    icon: <Eye className="h-3.5 w-3.5" />,
  },
  {
    value: 'off',
    label: 'Off',
    hint: 'Do not start the browser. Tools still exist — LLM boots lazily.',
    icon: <Ban className="h-3.5 w-3.5" />,
  },
];

export function BrowserVisibilityPicker({
  value,
  onChange,
  compact = false,
  className,
}: BrowserVisibilityPickerProps): React.JSX.Element {
  return (
    <div className={cn('space-y-2', className)} data-testid="browser-visibility-picker">
      <div>
        <label className="mb-1.5 block text-sm font-medium text-[var(--color-foreground)]">
          Integrated Browser
        </label>
        <p className="text-[10.5px] text-[var(--color-muted-foreground)] mb-2">
          Ten browser tools (open_browser_page, click_element, run_playwright_code, …)
          are always available to the agent. This controls how Chromium is launched.
        </p>
        <div
          role="radiogroup"
          aria-label="Browser visibility"
          className={cn(compact ? 'grid grid-cols-3 gap-1.5' : 'grid grid-cols-3 gap-2')}
        >
          {OPTIONS.map((opt) => {
            const selected = value.visibility === opt.value;
            return (
              <Button
                key={opt.value}
                variant="ghost"
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`browser-visibility-${opt.value}`}
                onClick={() => onChange({ ...value, visibility: opt.value })}
                className={cn(
                  'h-auto flex flex-col items-start gap-0.5 rounded-md border px-2.5 py-2 text-left transition-colors',
                  'text-[11.5px] font-medium',
                  selected
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                    : 'border-[var(--color-input)] text-[var(--color-muted-foreground)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-foreground)]',
                )}
                title={opt.hint}
              >
                <span className="flex items-center gap-1.5">
                  {opt.icon}
                  <span>{opt.label}</span>
                </span>
                {!compact && (
                  <span className="mt-0.5 line-clamp-2 text-[9.5px] font-normal opacity-80">
                    {opt.hint}
                  </span>
                )}
              </Button>
            );
          })}
        </div>
      </div>

      {/* Enable run_playwright_code toggle. Off by default because
          arbitrary page.evaluate is powerful. Off means the tool is
          registered but service-layer gate throws when the LLM calls it. */}
      <label
        className="flex items-center gap-2 rounded-md border border-[var(--color-input)] px-2.5 py-2 text-[11.5px] text-[var(--color-foreground)]"
        title="Allows the LLM to execute arbitrary Playwright code via run_playwright_code. Off by default."
      >
        <Checkbox
          data-testid="browser-eval-allowed"
          checked={value.evalAllowed === true}
          onCheckedChange={(v) => onChange({ ...value, evalAllowed: v === true })}
          className="h-3.5 w-3.5"
        />
        <Code2 className="h-3.5 w-3.5 text-[var(--color-muted-foreground)]" />
        <span className="font-medium">Allow run_playwright_code</span>
        <span className="text-[10px] text-[var(--color-muted-foreground)]">
          — the agent can run arbitrary Playwright JS
        </span>
      </label>

      {/* Allowed hosts — comma/space list. Left as a plain input rather
          than tag chips to keep the surface tiny for the modal case. */}
      <div>
        <label htmlFor="browser-allowed-hosts" className="mb-1 block text-[11.5px] font-medium text-[var(--color-foreground)]">
          Allowed hosts <span className="text-[10px] text-[var(--color-muted-foreground)]">(optional; empty = allow all)</span>
        </label>
        <Input
          id="browser-allowed-hosts"
          type="text"
          data-testid="browser-allowed-hosts"
          value={value.allowedHostsCsv ?? ''}
          onChange={(e) => onChange({ ...value, allowedHostsCsv: e.target.value })}
          placeholder="playwright.dev, *.example.com"
          className="h-auto px-2 py-1.5 text-[11.5px] font-mono"
        />
      </div>
    </div>
  );
}

/**
 * Serialise a {@link BrowserPickerValue} to the payload the server's
 * `CreateChatSchema.browserConfig` accepts. Returns `undefined` when
 * the user picked `visibility: 'headless'` with no custom options —
 * that's the server default, so we don't need to send anything.
 */
export function pickerValueToBrowserConfig(v: BrowserPickerValue): Record<string, unknown> | undefined {
  const defaultShape =
    v.visibility === 'headless' &&
    !v.evalAllowed &&
    (!v.allowedHostsCsv || v.allowedHostsCsv.trim() === '');
  if (defaultShape) return undefined;
  const allowedHosts = (v.allowedHostsCsv ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // `enabled` = true whenever the user has meaningfully touched the
  // config. 'off' visibility still counts as "enabled" so the LLM's
  // lazy-start path works — visibility='off' only skips the up-front
  // Chromium boot, it doesn't disable the tool set.
  return {
    enabled: true,
    visibility: v.visibility,
    ...(v.evalAllowed ? { evalAllowed: true } : {}),
    ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
  };
}

/** Reasonable defaults used by both the chat and workflow forms. */
export const DEFAULT_BROWSER_PICKER_VALUE: BrowserPickerValue = {
  visibility: 'headless',
  evalAllowed: false,
  allowedHostsCsv: '',
};
