// ────────────────────────────────────────────────────────────────
// TriggerAutomationModal — Track C
//   Modal for manually triggering a schema-driven automation.
//   Lets the user paste / upload the dataset for THIS run and
//   optionally save it as the automation's default.
// ────────────────────────────────────────────────────────────────

import { useMemo, useRef, useState } from 'react';
import { Modal } from '../ui/Modal.js';
import { Button } from '../ui/Button.js';
import { usePreviewIterations, useTriggerAutomation } from '@/hooks/automationQueries.js';
import type { Automation } from '@generatorai/shared';
import { Checkbox } from '@/components/ui/primitives/checkbox.js';

interface Props {
  open: boolean;
  onClose: () => void;
  automation: Automation;
}

type DatasetFormat = 'json_array' | 'csv' | 'jsonl';

const formatOptions: Array<{ value: DatasetFormat; label: string }> = [
  { value: 'json_array', label: 'JSON array' },
  { value: 'csv', label: 'CSV' },
  { value: 'jsonl', label: 'JSONL' },
];

export function TriggerAutomationModal({ open, onClose, automation }: Props) {
  const initialFormat: DatasetFormat = automation.dataSchema?.format ?? 'json_array';
  const initialData = automation.defaultDataset?.data ?? '';
  const [format, setFormat] = useState<DatasetFormat>(initialFormat);
  const [data, setData] = useState<string>(initialData);
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const previewMutation = usePreviewIterations();
  const triggerMutation = useTriggerAutomation();

  const hasSchema = !!automation.dataSchema;
  const canPreview = hasSchema && data.trim().length > 0;

  const preview = previewMutation.data;
  const previewError =
    previewMutation.error instanceof Error ? previewMutation.error.message : null;

  const handlePreview = () => {
    if (!hasSchema || !automation.iterationMode) return;
    previewMutation.mutate({
      dataSchema: automation.dataSchema!,
      iterationMode: automation.iterationMode,
      dataset: { format, data },
    });
  };

  const handleRun = async () => {
    const dataset = data.trim().length > 0 ? { format, data } : undefined;
    await triggerMutation.mutateAsync({
      id: automation.id,
      body: dataset ? { dataset, saveAsDefault } : { saveAsDefault },
    });
    onClose();
  };

  const handleLoadLast = () => {
    if (automation.defaultDataset) {
      setFormat(automation.defaultDataset.format);
      setData(automation.defaultDataset.data);
    }
  };

  const handleFileChosen = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      setData(text);
      if (file.name.endsWith('.csv')) setFormat('csv');
      else if (file.name.endsWith('.jsonl')) setFormat('jsonl');
      else setFormat('json_array');
    });
  };

  const triggerLabel = useMemo(() => {
    if (preview?.totalIterations) {
      return `Run ${preview.totalIterations} iteration${preview.totalIterations === 1 ? '' : 's'}`;
    }
    return 'Run';
  }, [preview?.totalIterations]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Run "${automation.name}"`}
      size="lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleRun}
            disabled={triggerMutation.isPending}
            loading={triggerMutation.isPending}
          >
            {triggerLabel}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {hasSchema && (
          <>
            <div>
              <label className="block text-sm font-medium mb-1">Dataset format</label>
              <select
                aria-label="Dataset format"
                className="w-full rounded-md border bg-background px-2 py-1 text-sm"
                value={format}
                onChange={(e) => setFormat(e.target.value as DatasetFormat)}
              >
                {formatOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-sm font-medium">Dataset</label>
                <div className="flex gap-2 text-xs">
                  {automation.defaultDataset && (
                    <Button variant="unstyled"
                      className="text-primary hover:underline"
                      onClick={handleLoadLast}
                    >
                      Load default
                    </Button>
                  )}
                  <Button variant="unstyled"
                    className="text-primary hover:underline"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload file
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,.csv,.jsonl,.txt"
                    className="hidden"
                    onChange={handleFileChosen}
                  />
                </div>
              </div>
              <textarea
                aria-label="Dataset"
                className="w-full h-40 rounded-md border bg-background p-2 font-mono text-xs"
                placeholder={format === 'csv'
                  ? 'name,priority\napi-users,high\napi-orders,medium'
                  : format === 'jsonl'
                    ? '{"name":"api-users","priority":"high"}\n{"name":"api-orders","priority":"medium"}'
                    : '[\n  {"name":"api-users","priority":"high"}\n]'}
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={handlePreview}
                disabled={!canPreview || previewMutation.isPending}
                loading={previewMutation.isPending}
              >
                Preview iterations
              </Button>
              <label className="flex items-center gap-1 text-sm">
                <Checkbox
                  checked={saveAsDefault}
                  onCheckedChange={(v) => setSaveAsDefault(v === true)}
                />
                Save as default
              </label>
            </div>

            {previewError && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {previewError}
              </div>
            )}

            {preview && (
              <div className="rounded-md border p-3 text-sm">
                <div className="mb-2 font-medium">
                  {preview.totalIterations} iteration{preview.totalIterations === 1 ? '' : 's'}
                  {preview.parsedRowCount !== preview.totalIterations && (
                    <span className="text-muted-foreground"> · {preview.parsedRowCount} rows</span>
                  )}
                </div>
                <ol className="space-y-1 text-xs">
                  {preview.iterations.map((it, i) => (
                    <li key={i} className="truncate">
                      <span className="text-muted-foreground">{i + 1}.</span> {it.label}
                    </li>
                  ))}
                </ol>
                {preview.warnings.length > 0 && (
                  <div className="mt-2 text-xs text-warning-foreground">
                    <div className="font-medium">Warnings:</div>
                    <ul className="ml-4 list-disc">
                      {preview.warnings.slice(0, 5).map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
