// MB-14 StepDetail (MChatStepDetail): the body of the pushed step screen — heading (glyph + verb + mono target),
// FactStrip (status, exit code, duration), "Input" code block, the error callout, "Output" (last N of M lines +
// "Show all"; a running step says the output arrives when it finishes — the live tail waits for MG-37), and the
// BottomToolbar: ↑ / ↓ step navigation, Copy, and "Open in terminal" for shell steps (the screen's one primary).
import React, { useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { formatStepDuration, transcriptStepStatus } from '@generatorai/client-core';

import { BottomToolbar } from '../../ui/layout/BottomToolbar';
import { FactStrip } from '../../ui/layout/FactStrip';
import { Callout } from '../../ui/primitives/Callout';
import { CodeText } from '../../ui/primitives/CodeText';
import { StatusBadge } from '../../ui/primitives/StatusBadge';
import { Text } from '../../ui/primitives/Text';
import { Button } from '../../ui/primitives/Button';
import { StepGlyph } from '../TranscriptView/parts/StepRow';
import { outputTail, type StepDetailView } from './stepDetailModel';

export interface StepDetailProps {
  view: StepDetailView;
  onNavigate: (callId: string) => void;
  /** Shell steps only; the screen runs the step-up and opens the pane's Terminal tab. */
  onOpenInTerminal?: () => void;
}

export function StepDetailBody({ view }: { view: StepDetailView }): React.ReactElement {
  const [all, setAll] = useState(false);
  const { step } = view;
  const status = transcriptStepStatus(step.status);
  const tail = outputTail(view.output, all ? Number.MAX_SAFE_INTEGER : 40);
  const running = step.status === 'running';
  return (
    <View className="gap-4 px-4 pb-6 pt-2">
      <View className="flex-row items-center gap-2.5">
        <StepGlyph step={step} size={18} />
        <Text role="headline" weight={600}>
          {step.verb}
        </Text>
        <Text role="mono" tone="fg-2" numberOfLines={2} ellipsizeMode="middle" className="flex-1" selectable>
          {step.target}
        </Text>
      </View>
      <FactStrip
        facts={[
          { label: 'Status', value: <StatusBadge state={status.state} {...(status.label ? { label: status.label } : {})} size="sm" /> },
          ...(view.exitCode !== null ? [{ label: 'Exit code', value: String(view.exitCode), mono: true }] : []),
          ...(step.durationMs ? [{ label: 'Duration', value: formatStepDuration(step.durationMs) ?? '—', mono: true }] : []),
        ]}
      />
      {view.input ? (
        <View className="gap-1.5">
          <Text role="footnote" weight={600} tone="fg-2">
            Input
          </Text>
          <CodeText form="block" code={view.input} language={view.shell ? 'bash' : 'json'} copyable />
        </View>
      ) : null}
      {step.status === 'failed' ? <Callout tone="err" title={view.exitCode !== null ? `Process exited with code ${view.exitCode}` : 'The step failed'} {...(step.errorText ? { body: step.errorText.split('\n')[0] } : {})} /> : null}
      <View className="gap-1.5">
        <View className="flex-row items-center justify-between">
          <Text role="footnote" weight={600} tone="fg-2">
            Output
          </Text>
          {tail.total > tail.shown ? (
            <Text role="monoSm" tone="fg-3">
              {`last ${tail.shown} of ${tail.total} lines`}
            </Text>
          ) : null}
        </View>
        {running && !view.output ? (
          <Text role="footnote" tone="fg-3">
            Output arrives when the command finishes.
          </Text>
        ) : view.output ? (
          <>
            <CodeText form="block" code={tail.text} copyable />
            {tail.total > tail.shown ? <Button label="Show all" size="sm" variant="ghost" onPress={() => setAll(true)} /> : null}
          </>
        ) : (
          <Text role="footnote" tone="fg-3">
            No output.
          </Text>
        )}
      </View>
    </View>
  );
}

export function StepDetailToolbar({ view, onNavigate, onOpenInTerminal }: StepDetailProps): React.ReactElement {
  return (
    <BottomToolbar
      nav={[
        { icon: 'chevron-up', label: view.previous ? `Previous step: ${view.previous.label}` : 'Previous step', disabled: !view.previous, onPress: () => view.previous && onNavigate(view.previous.callId) },
        { icon: 'chevron-down', label: view.next ? `Next step: ${view.next.label}` : 'Next step', disabled: !view.next, onPress: () => view.next && onNavigate(view.next.callId) },
      ]}
      actions={[{ label: 'Copy', icon: 'copy', onPress: () => void Clipboard.setStringAsync(view.output || view.input) }]}
      {...(view.shell && onOpenInTerminal ? { primary: { label: 'Open in terminal', icon: 'terminal', onPress: onOpenInTerminal } } : {})}
    />
  );
}
