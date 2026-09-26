// ────────────────────────────────────────────────────────────────
// TriggerAutomationDialog — manually trigger a schema-driven automation:
// paste/upload the dataset for THIS run, preview the iterations it expands
// to, optionally save it as the automation's default. Ported from
// components/automation/TriggerAutomationModal.tsx onto the kit (D-35
// fallback port); feature-local (only this feature's detail page imports it).
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import type { Automation } from '@generatorai/shared';
import { usePreviewIterations, useTriggerAutomation } from '@/hooks/automationQueries.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Dialog, DialogBody, DialogFooter } from '@/ui/primitives/Dialog/Dialog.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { FileInput } from '@/ui/primitives/FileInput/FileInput.js';
import { Select } from '@/ui/primitives/Select/Select.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';

interface Props {
  open: boolean;
  onClose: () => void;
  automation: Automation;
}

type DatasetFormat = 'json_array' | 'csv' | 'jsonl';

const FORMAT_ITEMS = [
  { value: 'json_array', label: 'JSON array' },
  { value: 'csv', label: 'CSV' },
  { value: 'jsonl', label: 'JSONL' },
];

const PLACEHOLDER: Record<DatasetFormat, string> = {
  json_array: '[\n  {"name":"api-users","priority":"high"}\n]',
  csv: 'name,priority\napi-users,high\napi-orders,medium',
  jsonl: '{"name":"api-users","priority":"high"}\n{"name":"api-orders","priority":"medium"}',
};

/** Run-now dialog for a schema-driven automation: dataset, preview, save-as-default. */
export function TriggerAutomationDialog({ open, onClose, automation }: Props) {
  const [format, setFormat] = useState<DatasetFormat>(automation.dataSchema?.format ?? 'json_array');
  const [data, setData] = useState(automation.defaultDataset?.data ?? '');
  const [saveAsDefault, setSaveAsDefault] = useState(false);

  const previewMutation = usePreviewIterations();
  const triggerMutation = useTriggerAutomation();

  const hasSchema = Boolean(automation.dataSchema);
  const canPreview = hasSchema && data.trim().length > 0;
  const preview = previewMutation.data;
  const previewError = previewMutation.error instanceof Error ? previewMutation.error.message : null;

  const handlePreview = () => {
    if (!automation.dataSchema || !automation.iterationMode) return;
    previewMutation.mutate({ dataSchema: automation.dataSchema, iterationMode: automation.iterationMode, dataset: { format, data } });
  };

  const handleRun = async () => {
    const dataset = data.trim().length > 0 ? { format, data } : undefined;
    await triggerMutation.mutateAsync({ id: automation.id, body: dataset ? { dataset, saveAsDefault } : { saveAsDefault } });
    onClose();
  };

  const handleFileChosen = (files: FileList) => {
    const file = files[0];
    if (!file) return;
    void file.text().then((text) => {
      setData(text);
      if (file.name.endsWith('.csv')) setFormat('csv');
      else if (file.name.endsWith('.jsonl')) setFormat('jsonl');
      else setFormat('json_array');
    });
  };

  const triggerLabel = useMemo(
    () => (preview?.totalIterations ? `Run ${preview.totalIterations} iteration${preview.totalIterations === 1 ? '' : 's'}` : 'Run'),
    [preview?.totalIterations],
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()} title={`Run "${automation.name}"`} size="lg">
      <DialogBody>
        {hasSchema ? (
          <>
            <Field label="Dataset format">
              <Select value={format} onValueChange={(v) => setFormat((v ?? 'json_array') as DatasetFormat)} items={FORMAT_ITEMS} />
            </Field>
            <Field
              label="Dataset"
              hint={
                <span className="flex items-center gap-3">
                  {automation.defaultDataset ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setFormat(automation.defaultDataset!.format);
                        setData(automation.defaultDataset!.data);
                      }}
                    >
                      Load default
                    </Button>
                  ) : null}
                  <FileInput accept=".json,.csv,.jsonl,.txt" onFilesSelected={handleFileChosen}>
                    {(open) => (
                      <Button variant="ghost" size="sm" onClick={open}>
                        Upload file
                      </Button>
                    )}
                  </FileInput>
                </span>
              }
            >
              <Textarea
                aria-label="Dataset"
                value={data}
                onChange={(e) => setData(e.target.value)}
                rows={8}
                textareaClassName="font-mono text-small"
                placeholder={PLACEHOLDER[format]}
              />
            </Field>

            <div className="flex items-center gap-3">
              <Button variant="secondary" onClick={handlePreview} disabled={!canPreview || previewMutation.isPending} loading={previewMutation.isPending}>
                Preview iterations
              </Button>
              <Switch checked={saveAsDefault} onCheckedChange={setSaveAsDefault} label="Save as default" />
            </div>

            {previewError ? <Callout tone="err">{previewError}</Callout> : null}

            {preview ? (
              <Callout title={`${preview.totalIterations} iteration${preview.totalIterations === 1 ? '' : 's'}${preview.parsedRowCount !== preview.totalIterations ? ` · ${preview.parsedRowCount} rows` : ''}`}>
                <ol className="flex flex-col gap-0.5 text-small">
                  {preview.iterations.map((it, i) => (
                    <li key={i} className="truncate">
                      <span className="text-fg-3">{i + 1}.</span> {it.label}
                    </li>
                  ))}
                </ol>
                {preview.warnings.length > 0 ? (
                  <div className="mt-2 text-small text-warn">
                    <p className="font-medium">Warnings:</p>
                    <ul className="ml-4 list-disc">
                      {preview.warnings.slice(0, 5).map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </Callout>
            ) : null}
          </>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => void handleRun()} disabled={triggerMutation.isPending} loading={triggerMutation.isPending}>
          {triggerLabel}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
