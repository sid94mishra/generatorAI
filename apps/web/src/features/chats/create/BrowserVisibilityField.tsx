// ────────────────────────────────────────────────────────────────
// BrowserVisibilityField — the "Integrated browser" control in the
// create-chat "More"/Options group (ChatCreate board §More, NewChat board's
// collapsed Options summary "browser headless").
//
// Kit rebuild of `components/browser/BrowserVisibilityPicker.tsx` (P5-09),
// which had exactly one consumer (`CreateChatDialog`, now deleted) — folded
// in here rather than kept as a shared block. Operates directly on
// `ChatCreateBrowserSettings` (ui-contract) instead of the legacy
// `BrowserPickerValue`; the server-payload mapping lives in
// `mapDraftToParams.ts`'s `browserSettingsToConfig`.
// ────────────────────────────────────────────────────────────────

import type { ChatCreateBrowserSettings } from '@generatorai/shared/ui-contract';
import { Checkbox } from '@/ui/primitives/Checkbox/Checkbox.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { SegmentedControl } from '@/ui/primitives/SegmentedControl/SegmentedControl.js';

export const DEFAULT_BROWSER_SETTINGS: ChatCreateBrowserSettings = {
  visibility: 'headless',
  evalAllowed: false,
  allowedHostsCsv: '',
};

const VISIBILITY_HINT: Record<ChatCreateBrowserSettings['visibility'], string> = {
  headless: 'Runs invisibly. Fast, safe, recommended default.',
  visible: 'Auto-opens the Browser tab so you watch the agent live.',
  off: 'Does not start the browser. Tools still exist — it boots lazily.',
};

export interface BrowserVisibilityFieldProps {
  value: ChatCreateBrowserSettings;
  onChange: (next: ChatCreateBrowserSettings) => void;
  /** Denser layout for the 640 dialog's Options disclosure. */
  compact?: boolean;
  className?: string;
}

/** "Integrated browser" visibility + `run_playwright_code` + allowed hosts. */
export function BrowserVisibilityField({ value, onChange, compact = false, className }: BrowserVisibilityFieldProps) {
  return (
    <div className={className} data-testid="browser-visibility-picker">
      <div className="flex flex-col gap-1.5">
        <span className="text-small font-medium text-fg">Integrated browser</span>
        <SegmentedControl
          label="Browser visibility"
          value={value.visibility}
          onValueChange={(visibility) => onChange({ ...value, visibility })}
          data-testid="browser-visibility"
          items={[
            { value: 'headless', label: 'Headless' },
            { value: 'visible', label: 'Visible' },
            { value: 'off', label: 'Off' },
          ]}
        />
        {compact ? null : <span className="text-small text-fg-3">{VISIBILITY_HINT[value.visibility]}</span>}
      </div>

      <label
        className="mt-3 flex items-center gap-2 text-ui text-fg"
        title="Allows the agent to execute arbitrary Playwright code via run_playwright_code. Off by default."
      >
        <Checkbox
          data-testid="browser-eval-allowed"
          checked={value.evalAllowed === true}
          onCheckedChange={(next) => onChange({ ...value, evalAllowed: next })}
        />
        Allow <span className="font-mono text-small">run_playwright_code</span>
        <span className="text-small text-fg-3">arbitrary Playwright JS</span>
      </label>

      <Field label="Allowed hosts" optional className="mt-3">
        <Input
          data-testid="browser-allowed-hosts"
          value={value.allowedHostsCsv ?? ''}
          onChange={(e) => onChange({ ...value, allowedHostsCsv: e.target.value })}
          placeholder="Empty = all, e.g. *.acme.dev"
          mono
        />
      </Field>
    </div>
  );
}
