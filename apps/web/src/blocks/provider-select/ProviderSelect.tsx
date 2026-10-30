// ────────────────────────────────────────────────────────────────
// ProviderSelect — pick an agent provider for an agent's runtime or a
// workflow session (agent editor, workflow stage / workflow defaults).
//
// Lists only the providers this server serves (`GET /api/harness/providers`,
// so an experimental provider the server hides never appears, D-131), each
// with its logo (D-132). A saved value the server no longer serves stays
// visible as "<name> · not available" instead of silently reading as the
// empty choice.
// ────────────────────────────────────────────────────────────────

import { useMemo } from 'react';
import { harnessProviderLabel } from '@generatorai/shared';
import { useHarnessProviders } from '@/hooks/harnessQueries.js';
import { ProviderLogo } from '@/ui/primitives/ProviderLogo/ProviderLogo.js';
import { Select, type SelectItem } from '@/ui/primitives/Select/Select.js';

export interface ProviderSelectProps {
  /** Provider id, or '' for the empty choice. */
  value: string;
  onChange: (provider: string) => void;
  /** Label of the empty choice ("Any provider", "Workflow default", "Route by model"). */
  emptyLabel: string;
  'aria-label': string;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
}

/** A provider Select over the providers this server serves. */
export function ProviderSelect({ value, onChange, emptyLabel, size, disabled, className, ...rest }: ProviderSelectProps) {
  const { data } = useHarnessProviders();
  const items = useMemo<SelectItem[]>(() => {
    const served = data?.providers ?? [];
    const rows: SelectItem[] = served.map((p) => ({
      value: p.type,
      label: p.label,
      leading: <ProviderLogo provider={p.type} />,
    }));
    if (value && data && !served.some((p) => p.type === value)) {
      rows.push({ value, label: `${harnessProviderLabel(value)} · not available`, leading: <ProviderLogo provider={value} /> });
    }
    return [{ value: '', label: emptyLabel }, ...rows];
  }, [data, emptyLabel, value]);

  return (
    <Select
      aria-label={rest['aria-label']}
      size={size}
      value={value}
      disabled={disabled}
      onValueChange={(v) => onChange(v ?? '')}
      items={items}
      className={className}
    />
  );
}
