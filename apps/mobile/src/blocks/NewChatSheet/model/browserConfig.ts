// ────────────────────────────────────────────────────────────────
// Browser visibility → `CreateChatSchema.browserConfig`.
//
// Port of web's `pickerValueToBrowserConfig`: the server default is
// headless with no extras, so that exact shape sends nothing; anything the
// user touched sends `enabled: true` plus the knobs. `'off'` still counts as
// enabled — it only skips the up-front Chromium boot, not the tool set.
// ────────────────────────────────────────────────────────────────

export type BrowserVisibility = 'visible' | 'headless' | 'off';

export interface BrowserPickerValue {
  visibility: BrowserVisibility;
  evalAllowed?: boolean;
  allowedHostsCsv?: string;
}

export const BROWSER_VISIBILITY_OPTIONS: ReadonlyArray<{
  value: BrowserVisibility;
  title: string;
  help: string;
}> = [
  {
    value: 'headless',
    title: 'Headless',
    help: 'The agent’s browser runs in the background. Default.',
  },
  {
    value: 'visible',
    title: 'Visible',
    help: 'Opens a window on the host machine so you can watch it drive.',
  },
  {
    value: 'off',
    title: 'Off until needed',
    help: 'No browser is started up front; the agent can still open one.',
  },
];

export const DEFAULT_BROWSER_PICKER_VALUE: BrowserPickerValue = {
  visibility: 'headless',
  evalAllowed: false,
  allowedHostsCsv: '',
};

export function parseAllowedHosts(csv: string | undefined): string[] {
  return (csv ?? '')
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function pickerValueToBrowserConfig(
  v: BrowserPickerValue,
): Record<string, unknown> | undefined {
  const allowedHosts = parseAllowedHosts(v.allowedHostsCsv);
  const defaultShape = v.visibility === 'headless' && !v.evalAllowed && allowedHosts.length === 0;
  if (defaultShape) return undefined;
  return {
    enabled: true,
    visibility: v.visibility,
    ...(v.evalAllowed ? { evalAllowed: true } : {}),
    ...(allowedHosts.length > 0 ? { allowedHosts } : {}),
  };
}

export function browserSummary(v: BrowserPickerValue): string {
  const base = BROWSER_VISIBILITY_OPTIONS.find((o) => o.value === v.visibility)?.title ?? v.visibility;
  const extras = [v.evalAllowed ? 'eval' : null, parseAllowedHosts(v.allowedHostsCsv).length ? 'hosts' : null]
    .filter(Boolean)
    .join(', ');
  return extras ? `${base} (${extras})` : base;
}
