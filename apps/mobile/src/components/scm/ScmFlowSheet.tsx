// ────────────────────────────────────────────────────────────────
// The commit → push → pull request sheet.
//
// One sheet for the whole flow rather than the old two (Commit, then Create
// PR): the server runs it as one request, and on a phone two sheets meant
// committing, closing, reopening and retyping the same intent.
//
// What is unavailable is shown as a reason, never as a dead switch — the
// readiness contract exists to explain itself (`.github/docs/
// feature-source-control.md` §3, principle 4).
//
// "Generate" asks the server for text (`POST /scm/generate`); it is a
// convenience, not a requirement — an empty message means the flow generates
// one itself.
// ────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { Check, CircleDashed, GitBranch, Sparkles, TriangleAlert, X } from 'lucide-react-native';
import type { RepoReadiness, ScmFlowResult } from '@generatorai/shared';

import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Field, Switch } from '../ui/Form';
import { Spinner } from '../ui/States';
import { useToast } from '../ui/Toast';
import { haptics } from '../ui/haptics';
import { useTheme } from '../../theme/ThemeProvider';
import { useScmApi } from './useScmApi';
import {
  actionReason,
  buildFlowRequest,
  emptyFlowForm,
  plannedSteps,
  readinessLine,
  runLabel,
  stepLabel,
  type ScmFlowForm,
} from './scmModel';

export function ScmFlowSheet({
  visible,
  onClose,
  workspaceId,
  readiness,
  hint,
  busy,
  result,
  onRun,
}: {
  visible: boolean;
  onClose: () => void;
  workspaceId: string;
  readiness: RepoReadiness;
  /** Seeds generated text — the chat's name. */
  hint?: string | undefined;
  busy: boolean;
  /** The last result, so the checklist can show what actually happened. */
  result: ScmFlowResult | null;
  onRun: (form: ScmFlowForm) => void;
}): React.ReactElement | null {
  const { colors } = useTheme();
  const toast = useToast();
  const scm = useScmApi();
  const [form, setForm] = useState<ScmFlowForm>(() => initialForm(readiness));

  // Reset only when the SHEET opens or the mount changes: readiness refetches
  // every 15 seconds, and a new ahead/behind count must not wipe what the user
  // has typed. The effect reads the latest readiness through a ref.
  const readinessRef = useRef(readiness);
  readinessRef.current = readiness;
  const mountKey = `${readiness.alias}:${readiness.defaultBranch ?? ''}`;
  useEffect(() => {
    if (visible) setForm(initialForm(readinessRef.current));
  }, [visible, mountKey]);

  const pushReason = actionReason(readiness, 'push');
  const prReason = actionReason(readiness, 'pullRequest');
  const commitReason = actionReason(readiness, 'commit');

  const generateCommit = useMutation({
    mutationFn: () => scm.generate(workspaceId, { alias: form.alias, kind: 'commit', ...(hint ? { hint } : {}) }),
    onSuccess: (generated) => {
      if (generated.message) setForm((prev) => ({ ...prev, message: generated.message ?? '' }));
    },
    onError: (err) => toast({ message: errorText(err, 'Could not write a message'), variant: 'danger' }),
  });

  const generatePr = useMutation({
    mutationFn: () =>
      scm.generate(workspaceId, {
        alias: form.alias,
        kind: 'pull_request',
        ...(hint ? { hint } : {}),
        ...(form.base.trim() ? { base: form.base.trim() } : {}),
      }),
    onSuccess: (generated) =>
      setForm((prev) => ({
        ...prev,
        title: generated.title ?? prev.title,
        body: generated.body ?? prev.body,
      })),
    onError: (err) => toast({ message: errorText(err, 'Could not write the pull request'), variant: 'danger' }),
  });

  const steps = useMemo(() => plannedSteps(buildFlowRequest(form)), [form]);

  if (!visible) return null;

  return (
    <Sheet visible={visible} onClose={onClose} title="Commit" detents={[0.92]} fitContent>
      <View className="gap-4 px-4 pb-8 pt-4">
        <View className="flex-row items-center gap-2">
          <GitBranch size={14} color={colors['muted-foreground']} />
          <Text numberOfLines={1} className="flex-1 text-xs text-muted-foreground">
            {readiness.alias === '.' ? '' : `${readiness.alias} · `}
            {readinessLine(readiness)}
          </Text>
        </View>

        {commitReason ? (
          <Reason text={commitReason} />
        ) : null}

        <View className="gap-1.5">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-medium text-foreground">Message</Text>
            <Button
              label="Generate"
              size="sm"
              variant="ghost"
              loading={generateCommit.isPending}
              icon={<Sparkles size={14} color={colors.primary} />}
              onPress={() => generateCommit.mutate()}
            />
          </View>
          <Field
            placeholder="Leave empty and the server writes one"
            value={form.message}
            onChangeText={(message) => setForm((prev) => ({ ...prev, message }))}
            multiline
            style={{ minHeight: 72, textAlignVertical: 'top' }}
            accessibilityLabel="Commit message"
          />
        </View>

        <View className="overflow-hidden rounded-3xl border border-border bg-card">
          <ToggleRow
            label="Push"
            help={pushReason ?? 'Push the work branch to the remote.'}
            disabled={Boolean(pushReason)}
            value={form.push || form.pullRequest}
            onChange={(push) => setForm((prev) => ({ ...prev, push, ...(push ? {} : { pullRequest: false }) }))}
          />
          <View className="ml-4 h-px bg-border-muted" />
          <ToggleRow
            label="Open pull request"
            help={prReason ?? 'Opens one against the base branch, or reuses the open one.'}
            disabled={Boolean(prReason)}
            value={form.pullRequest}
            // A pull request implies a push: turning it on turns that on too.
            onChange={(pullRequest) =>
              setForm((prev) => ({ ...prev, pullRequest, push: pullRequest ? true : prev.push }))
            }
          />
        </View>

        {form.pullRequest ? (
          <View className="gap-4">
            <View className="gap-1.5">
              <View className="flex-row items-center justify-between">
                <Text className="text-sm font-medium text-foreground">Title</Text>
                <Button
                  label="Generate"
                  size="sm"
                  variant="ghost"
                  loading={generatePr.isPending}
                  icon={<Sparkles size={14} color={colors.primary} />}
                  onPress={() => generatePr.mutate()}
                />
              </View>
              <Field
                placeholder="Generated from the commits when empty"
                value={form.title}
                onChangeText={(title) => setForm((prev) => ({ ...prev, title }))}
                accessibilityLabel="Pull request title"
              />
            </View>
            <Field
              label="Description"
              value={form.body}
              onChangeText={(body) => setForm((prev) => ({ ...prev, body }))}
              multiline
              style={{ minHeight: 96, textAlignVertical: 'top' }}
              accessibilityLabel="Pull request description"
            />
            <Field
              label="Base branch"
              placeholder={readiness.defaultBranch ?? 'The repository default'}
              value={form.base}
              onChangeText={(base) => setForm((prev) => ({ ...prev, base }))}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Base branch"
            />
            <View className="flex-row items-center justify-between">
              <Text className="text-sm text-foreground">Open as draft</Text>
              <Switch
                value={form.draft}
                onValueChange={(draft) => setForm((prev) => ({ ...prev, draft }))}
                accessibilityLabel="Open as draft"
              />
            </View>
          </View>
        ) : null}

        <StepList steps={steps} busy={busy} result={result} />

        <Button
          label={runLabel(form)}
          full
          size="lg"
          loading={busy}
          onPress={() => {
            haptics.success();
            onRun(form);
          }}
        />
      </View>
    </Sheet>
  );
}

function initialForm(readiness: RepoReadiness): ScmFlowForm {
  return {
    ...emptyFlowForm(readiness.alias),
    base: '',
    // Pushing is the common intent when the branch already tracks a remote.
    push: readiness.can.push && readiness.hasUpstream,
  };
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function Reason({ text }: { text: string }): React.ReactElement {
  const { colors } = useTheme();
  return (
    <View className="flex-row gap-2 rounded-2xl border border-border bg-subtle p-3">
      <TriangleAlert size={14} color={colors.warning} />
      <Text className="flex-1 text-xs leading-relaxed text-muted-foreground">{text}</Text>
    </View>
  );
}

function ToggleRow({
  label,
  help,
  value,
  disabled,
  onChange,
}: {
  label: string;
  help: string;
  value: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}): React.ReactElement {
  return (
    <View className="min-h-14 flex-row items-center gap-3 px-4 py-2.5">
      <View className="flex-1 gap-0.5">
        <Text className={`text-md ${disabled ? 'text-muted-foreground' : 'text-foreground'}`}>{label}</Text>
        <Text className="text-xs text-muted-foreground">{help}</Text>
      </View>
      <Switch value={value && !disabled} disabled={disabled} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  );
}

/**
 * The flow's progress.
 *
 * The server answers once, at the end, so "progress" is honest about that:
 * while the request is in flight every planned step is pending; once it
 * answers each step shows what it actually did (done / skipped / blocked /
 * failed) with the server's own detail.
 */
function StepList({
  steps,
  busy,
  result,
}: {
  steps: readonly string[];
  busy: boolean;
  result: ScmFlowResult | null;
}): React.ReactElement | null {
  const { colors } = useTheme();
  if (!busy && !result) return null;
  const byId = new Map((result?.steps ?? []).map((s) => [s.id as string, s]));

  return (
    <View className="gap-2 rounded-2xl border border-border bg-subtle p-3" accessibilityLabel="Flow progress">
      {steps.map((id) => {
        const step = byId.get(id);
        const status = step?.status;
        return (
          <View key={id} className="flex-row items-center gap-2">
            {status === 'done' ? (
              <Check size={14} color={colors.success} />
            ) : status === 'failed' || status === 'blocked' ? (
              <X size={14} color={status === 'failed' ? colors.danger : colors.warning} />
            ) : busy ? (
              <Spinner />
            ) : (
              <CircleDashed size={14} color={colors['muted-foreground']} />
            )}
            <Text className="flex-1 text-xs text-muted-foreground" numberOfLines={2}>
              {stepLabel(id as Parameters<typeof stepLabel>[0])}
              {step?.detail ? ` — ${step.detail}` : status === 'skipped' ? ' — skipped' : ''}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
