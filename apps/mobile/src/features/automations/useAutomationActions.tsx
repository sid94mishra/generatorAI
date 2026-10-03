// The automation actions shared by the list's long-press menu and the detail: Run now, Run with dataset… (a JSON
// rows sheet), Edit / Duplicate (the wizard), Enable / Disable, Delete… (confirmed).
import React, { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import type { Automation } from '@generatorai/shared';

import { AUTOMATIONS_HREF } from '../../blocks/shell/hrefs';
import { errorText } from '../../ui/lib/format';
import { confirm } from '../../ui/native/AlertDialog';
import { useSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { Button } from '../../ui/primitives/Button';
import { Field } from '../../ui/primitives/Field';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';
import { toast } from '../../ui/primitives/Toast';
import type { AutomationMenuId } from './model/automationsModel';
import { executionIdOf } from './model';
import { useAutomationWrites } from './queries';

type Href = Parameters<typeof router.push>[0];

export const executionHref = (id: string, executionId: string): string => `/automations/${encodeURIComponent(id)}/executions/${encodeURIComponent(executionId)}`;

function DatasetForm({ fields, onRun }: { fields: string[]; onRun: (rows: unknown[]) => Promise<void> }): React.ReactElement {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = (): void => {
    let rows: unknown;
    try {
      rows = JSON.parse(text);
    } catch {
      setError("That isn't valid JSON.");
      return;
    }
    if (!Array.isArray(rows)) {
      setError('Paste a JSON array of rows.');
      return;
    }
    setBusy(true);
    void onRun(rows).finally(() => setBusy(false));
  };
  return (
    <View className="gap-3 pb-4">
      <Text role="footnote" tone="fg-2">
        {fields.length ? `One run per row. Fields: ${fields.join(', ')}.` : 'One run per row; each row’s fields become variables.'}
      </Text>
      <Field {...(error ? { error } : {})}>
        <Textarea label="Rows (JSON array)" value={text} onChangeText={(t) => { setText(t); setError(null); }} mono minRows={6} placeholder={'[{"codebase": "web-dashboard"}]'} testID="automation-dataset-rows" />
      </Field>
      <Button label="Run" icon="play" variant="primary" size="lg" fullWidth loading={busy} onPress={run} testID="automation-dataset-run" />
    </View>
  );
}

export function useAutomationActions(): (id: AutomationMenuId, a: Automation) => void {
  const writes = useAutomationWrites();
  const sheet = useSheet();
  return useCallback(
    (id, a) => {
      const trigger = (dataset?: unknown): Promise<void> =>
        writes
          .trigger(a.id, dataset)
          .then((res) => {
            haptic('success');
            sheet.dismiss();
            const execId = executionIdOf(res);
            toast({ kind: 'background', message: `${a.name} started`, ...(execId ? { action: { label: 'Open', onPress: () => router.push(executionHref(a.id, execId) as Href) } } : {}) });
          })
          .catch((e: unknown) => {
            toast({ kind: 'error', message: errorText(e) });
          });
      switch (id) {
        case 'run':
          void trigger();
          return;
        case 'run-dataset':
          sheet.present(<DatasetForm fields={(a.dataSchema?.fields ?? []).map((f) => f.name)} onRun={(rows) => trigger({ format: 'json_array', data: JSON.stringify(rows) })} />, {
            title: 'Run with dataset',
            subtitle: a.name,
            detents: ['large'],
            scrollable: true,
          });
          return;
        case 'edit':
          router.push(`/automations/${encodeURIComponent(a.id)}/edit` as Href);
          return;
        case 'duplicate':
          router.push(`/automations/new?from=${encodeURIComponent(a.id)}` as Href);
          return;
        case 'enable':
        case 'disable':
          writes.setEnabled(a.id, id === 'enable').catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
          return;
        case 'delete':
          void confirm({ title: `Delete ${a.name}?`, message: 'Its executions stay in the run history; the schedule or webhook stops.', confirmLabel: 'Delete automation', icon: 'trash' }).then((ok) => {
            if (!ok) return;
            writes
              .remove(a.id)
              .then(() => {
                if (router.canGoBack()) router.back();
                else router.replace(AUTOMATIONS_HREF as Href);
              })
              .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }));
          });
      }
    },
    [writes, sheet],
  );
}
