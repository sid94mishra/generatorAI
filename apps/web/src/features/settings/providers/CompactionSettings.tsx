// ────────────────────────────────────────────────────────────────
// Context compaction (docs/compaction §3.6), in Settings › Model providers:
// whether the providers compact a conversation on their own when its context
// window fills up, and at how full. One setting for every provider; each maps
// it onto its own (a provider without the knob keeps its default and the chat
// says so). A chat applies a change from its next message.
// ────────────────────────────────────────────────────────────────

import { useCompactionSettings, useUpdateCompactionSettings } from '@/hooks/harnessQueries.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { SettingRow } from '@/ui/patterns/SettingsSection/SettingsSection.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';

const DEFAULT_THRESHOLD = 'provider';
const THRESHOLDS = [
  { value: DEFAULT_THRESHOLD, label: "Each provider's default" },
  ...[50, 60, 70, 80, 90].map((pct) => ({ value: String(pct), label: `${pct}% full` })),
] as const;

export function CompactionSettings() {
  const { data } = useCompactionSettings();
  const update = useUpdateCompactionSettings();
  const autoCompact = data?.autoCompact ?? true;
  const threshold = data?.thresholdPct != null ? String(data.thresholdPct) : DEFAULT_THRESHOLD;
  const items = THRESHOLDS.some((t) => t.value === threshold)
    ? THRESHOLDS
    : [...THRESHOLDS, { value: threshold, label: `${threshold}% full` }];

  return (
    <section className="flex flex-col gap-2" data-testid="compaction-settings">
      <SectionHeader title="Context compaction" level={3} />
      <p className="text-small text-fg-3">
        When a conversation fills the model&apos;s context window, the agent summarises it and carries on from the summary.
        You can also compact a chat yourself from the button beside its context gauge.
      </p>
      <SettingRow
        label="Compact automatically"
        hint="Off: a full conversation is not summarised until you compact it (a provider may still stop when the window is full)."
        control={
          <Switch
            aria-label="Compact automatically"
            checked={autoCompact}
            disabled={!data || update.isPending}
            onCheckedChange={(checked) => update.mutate({ autoCompact: checked })}
          />
        }
      />
      <SettingRow
        label="Compact when the window is"
        hint="Earlier keeps more room for long tasks; later keeps more of the conversation word for word. Applies from each chat's next message."
        control={
          <Select
            size="sm"
            aria-label="Compact when the window is"
            value={threshold}
            items={items}
            disabled={!data || !autoCompact || update.isPending}
            onValueChange={(v) => update.mutate({ thresholdPct: !v || v === DEFAULT_THRESHOLD ? null : Number(v) })}
          />
        }
      />
    </section>
  );
}
