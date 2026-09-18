// ────────────────────────────────────────────────────────────────
// TriggerInputSheet — run a schema-driven automation with a dataset.
//
// Mirrors web's TriggerAutomationModal: pick a format, paste the rows or
// pick a file, or fall back on the saved default; optionally save this
// dataset as the new default. `triggerInput.ts` pre-flights the text so an
// obvious mistake is caught here rather than as a 400 — the server still
// parses and validates against the automation's DataSchema.
//
// One Idempotency-Key per open sheet: a double tap or a retry after a
// dropped response replays instead of starting a second execution.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileUp, History, Play } from 'lucide-react-native';
import { queryKeys } from '@generatorai/client-core';

import { useAdminApi } from '../../api/useAdminApi';
import { pickAttachments, readAttachmentBytes } from '../chat/composer/attachmentPickers';
import { Button } from '../ui/Button';
import { Chip } from '../ui/Chip';
import { Field, Switch } from '../ui/Form';
import { Sheet } from '../ui/Sheet';
import { haptics } from '../ui/haptics';
import { useTheme } from '../../theme/ThemeProvider';
import { executionIdOf, makeIdempotencyKey, type AutomationView } from './automationModel';
import {
  DATASET_FORMATS,
  DATASET_FORMAT_LABEL,
  checkDataset,
  datasetPlaceholder,
  defaultDatasetOf,
  formatFromFileName,
  schemaFieldsOf,
  schemaFormatOf,
  type DatasetFormat,
} from './triggerInput';

export function TriggerInputSheet({
  visible,
  onClose,
  automation,
  onTriggered,
}: {
  visible: boolean;
  onClose: () => void;
  automation: AutomationView;
  /** Called with the new (or replayed) execution id. */
  onTriggered: (executionId: string | null) => void;
}): React.ReactElement {
  const admin = useAdminApi();
  const queryClient = useQueryClient();
  const { colors } = useTheme();

  const fields = useMemo(() => schemaFieldsOf(automation.dataSchema), [automation.dataSchema]);
  const saved = useMemo(() => defaultDatasetOf(automation.defaultDataset), [automation.defaultDataset]);

  const [format, setFormat] = useState<DatasetFormat>(() => schemaFormatOf(automation.dataSchema));
  const [text, setText] = useState('');
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const key = useRef<string | null>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (visible && !opened.current) {
      setFormat(saved?.format ?? schemaFormatOf(automation.dataSchema));
      setText('');
      setSaveAsDefault(false);
      setShowErrors(false);
      setNotice(null);
      setServerError(null);
      key.current = null;
    }
    opened.current = visible;
  }, [visible, saved, automation.dataSchema]);

  // Blank is fine when the server has a saved dataset to fall back on.
  const check = checkDataset(format, text, fields, { allowEmpty: saved !== null });
  const usingDefault = !text.trim() && saved !== null;

  const trigger = useMutation({
    mutationFn: (idempotencyKey: string) =>
      admin.automations.trigger(
        automation.id,
        usingDefault ? {} : { dataset: { format, data: text }, saveAsDefault },
        { idempotencyKey },
      ),
    onSuccess: (response) => {
      haptics.success();
      key.current = null;
      onClose();
      onTriggered(executionIdOf(response));
    },
    onError: (err) => {
      haptics.error();
      setServerError(err instanceof Error ? err.message : String(err));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.automation(automation.id) });
    },
  });

  const pickFile = async (): Promise<void> => {
    setNotice(null);
    const outcome = await pickAttachments('file');
    if (outcome.status !== 'picked') {
      if (outcome.status !== 'cancelled') setNotice(outcome.reason);
      return;
    }
    const item = outcome.items[0];
    if (!item) return;
    try {
      const { data } = await readAttachmentBytes(item);
      const decoded = new TextDecoder().decode(data);
      setText(decoded);
      const guessed = formatFromFileName(item.name);
      if (guessed) setFormat(guessed);
      setNotice(`Loaded ${item.name}`);
      // A new dataset is a new intent.
      key.current = null;
    } catch (err) {
      setNotice(`Could not read ${item.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const submit = (): void => {
    setServerError(null);
    if (!check.ok) {
      setShowErrors(true);
      haptics.warn();
      return;
    }
    key.current ??= makeIdempotencyKey(automation.id);
    haptics.commit();
    trigger.mutate(key.current);
  };

  const expects = fields.map((f) => (f.required ? `${f.name}*` : f.name)).join(', ');
  const status = usingDefault
    ? 'Leave blank to run with the saved default dataset.'
    : check.rowCount !== null && check.ok
      ? `${check.rowCount} row${check.rowCount === 1 ? '' : 's'} ready`
      : null;

  return (
    <Sheet visible={visible} onClose={onClose} title={`Run ${automation.name}`} detents={[0.75, 0.95]}>
      <View className="gap-4 px-4 pb-6 pt-2">
        {expects ? (
          <Text className="text-sm text-muted-foreground">Each row needs: {expects}</Text>
        ) : null}

        <View className="gap-2">
          <Text className="text-sm font-medium text-foreground">Format</Text>
          <View className="flex-row flex-wrap gap-2">
            {DATASET_FORMATS.map((f) => (
              <Chip
                key={f}
                label={DATASET_FORMAT_LABEL[f]}
                selected={format === f}
                tone="accent"
                onPress={() => {
                  setFormat(f);
                  key.current = null;
                }}
              />
            ))}
          </View>
        </View>

        <View className="flex-row flex-wrap gap-2">
          <Button
            label="Pick file"
            variant="secondary"
            size="sm"
            haptic="tap"
            icon={<FileUp size={16} color={colors.foreground} />}
            onPress={() => void pickFile()}
          />
          {saved ? (
            <Button
              label="Load saved default"
              variant="secondary"
              size="sm"
              haptic="tap"
              icon={<History size={16} color={colors.foreground} />}
              onPress={() => {
                setFormat(saved.format);
                setText(saved.data);
                key.current = null;
              }}
            />
          ) : null}
        </View>
        {notice ? <Text className="text-sm text-muted-foreground">{notice}</Text> : null}

        <Field
          label="Dataset"
          value={text}
          onChangeText={(next) => {
            setText(next);
            key.current = null;
          }}
          placeholder={datasetPlaceholder(format, fields)}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={{ minHeight: 160, maxHeight: 280, textAlignVertical: 'top', fontFamily: 'JetBrainsMono' }}
          error={showErrors && !check.ok ? check.errors.join('\n') : null}
          {...(status ? { hint: status } : {})}
        />

        {!usingDefault ? (
          <View className="min-h-11 flex-row items-center gap-3">
            <View className="flex-1 gap-0.5">
              <Text className="text-sm font-medium text-foreground">Save as default</Text>
              <Text className="text-sm text-muted-foreground">Scheduled runs and later triggers reuse it.</Text>
            </View>
            <Switch value={saveAsDefault} onValueChange={setSaveAsDefault} accessibilityLabel="Save as default" />
          </View>
        ) : null}

        {serverError ? (
          <Text accessibilityLiveRegion="assertive" className="text-sm text-danger">
            {serverError}
          </Text>
        ) : null}

        <Button
          label={check.rowCount && !usingDefault ? `Run ${check.rowCount} row${check.rowCount === 1 ? '' : 's'}` : 'Run now'}
          size="lg"
          full
          haptic="none"
          icon={<Play size={18} color={colors['primary-foreground']} />}
          loading={trigger.isPending}
          disabled={trigger.isPending}
          onPress={submit}
        />
      </View>
    </Sheet>
  );
}
