// Automation wizard (MAutomationCreate1–4; `/automations/new[?from=<id>]` and `/automations/[id]/edit[?page=]`,
// full-screen modal, MD-21): six pages, one Stepper node each (MD-66) — Basics (name, description, project scope),
// Trigger (Manual / Schedule / Webhook; Repeats every day / weekdays / weekly / cron, time, time zone, missed and
// overlap policy), Workflow & permission (ordered workflows with move up / down, permission mode; Bypass locked
// without admin for a webhook, PD-18), Dataset (schema fields, rows — chips for a one-field schema else JSON — CSV / JSON
// import, concurrency, on error), Variables & retry, Review (rows jump to their page). Header: Cancel only on create
// (MD-85; Save on edit); the sticky bar carries Back · Continue / "Create automation". "Save draft" is not rendered
// until MG-10 lands; the schedule preview waits for the WO (G-26). A webhook automation reveals its credentials once.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import type { AutomationTriggerType, DataFieldType, WorkflowRunPermissionMode } from '@generatorai/shared';

import { AUTOMATIONS_HREF } from '../../blocks/shell/hrefs';
import { pickTextFile } from '../../services/native/pickTextFile';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { FullScreenEditor } from '../../ui/layout/FullScreenEditor';
import { KeyValueList } from '../../ui/layout/KeyValueList';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { StickyActionBar } from '../../ui/layout/StickyActionBar';
import { Stepper } from '../../ui/layout/Stepper';
import { errorText } from '../../ui/lib/format';
import { DatePicker } from '../../ui/native/DatePicker';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { Select } from '../../ui/native/Select';
import { useSheet } from '../../ui/native/Sheet';
import { useSizeClass } from '../../ui/platform/breakpoints';
import { haptic } from '../../ui/platform/haptics';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { Chip } from '../../ui/primitives/Chip';
import { ChipGroup } from '../../ui/primitives/ChipGroup';
import { ChoiceCard } from '../../ui/primitives/ChoiceCard';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Field } from '../../ui/primitives/Field';
import { IconButton } from '../../ui/primitives/IconButton';
import { Input } from '../../ui/primitives/Input';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';
import { toast } from '../../ui/primitives/Toast';
import { RevealCredentials } from './components/WebhookCredentials';
import {
  FIELD_TYPES,
  PERMISSION_LABEL,
  WIZARD_STEPS,
  blankDraft,
  createBody,
  draftFromAutomation,
  pageProblem,
  reviewRows,
  updateBody,
  type AutomationDraft,
} from './model/automationsModel';
import { DAY_SHORT, scheduleToCron, timeZones, type Repeats } from './model/scheduleModel';
import { useAutomation, useAutomationWrites, useCreateAutomation, useProjectsList, useWorkflowNames } from './queries';

type Href = Parameters<typeof router.replace>[0];

function PageTitle({ title, hint }: { title: string; hint: string }): React.ReactElement {
  return (
    <View className="gap-1">
      <Text role="title" weight={600} accessibilityRole="header">
        {title}
      </Text>
      <Text role="body" tone="fg-2">
        {hint}
      </Text>
    </View>
  );
}

export default function AutomationWizardScreen(): React.ReactElement {
  const params = useLocalSearchParams<{ id?: string; from?: string; page?: string }>();
  const navigation = useNavigation();
  const sheet = useSheet();
  const { sizeClass } = useSizeClass();
  const editing = Boolean(params.id);
  const sourceId = params.id ?? params.from ?? '';
  const source = useAutomation(sourceId);
  const projects = useProjectsList();
  const writes = useAutomationWrites();
  const create = useCreateAutomation();
  const scopes = useGrantedScopes();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = useMemo(() => timeZones(), []);

  const seeded = useMemo<AutomationDraft | null>(() => {
    if (!sourceId) return blankDraft(zone);
    if (!source.data) return null;
    const d = draftFromAutomation(source.data, zone);
    return editing ? d : { ...d, name: `${d.name} copy` };
  }, [sourceId, source.data, editing, zone]);
  const [edited, setDraft] = useState<AutomationDraft | null>(null);
  const draft = edited ?? seeded;
  const [page, setPage] = useState(() => Math.min(5, Math.max(0, Number(params.page ?? 0) || 0)));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rowInput, setRowInput] = useState('');
  const { workflows, byId } = useWorkflowNames(draft?.projectId ?? null);

  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(AUTOMATIONS_HREF as Href);
  };
  if (!draft) {
    return (
      <FullScreenEditor title={editing ? 'Edit automation' : 'New automation'} onCancel={close} dirty={false} navigation={navigation as never}>
        {source.isError ? <ErrorState title="Couldn't load the automation" error={source.error} onRetry={() => void source.refetch()} /> : <Skeleton preset="list" count={6} />}
      </FullScreenEditor>
    );
  }
  const set = (patch: Partial<AutomationDraft>): void => setDraft({ ...draft, ...patch });
  const problem = pageProblem(draft, page);
  const last = page === WIZARD_STEPS.length - 1;
  const dirty = edited !== null;
  const bypassLocked = draft.triggerType === 'webhook' && !scopes.includes('admin:settings');
  const projectName = draft.projectId ? ((projects.data ?? []).find((p) => p.id === draft.projectId)?.name ?? 'Project') : 'All projects';

  const finish = (): void => {
    for (let i = 0; i < WIZARD_STEPS.length; i++) {
      const p = pageProblem(draft, i);
      if (p) {
        setPage(i);
        setTouched(true);
        return;
      }
    }
    setSaving(true);
    if (editing) {
      writes
        .update(params.id!, updateBody(draft))
        .then(() => {
          haptic('success');
          setDraft(null);
          close();
        })
        .catch((e: unknown) => toast({ kind: 'error', message: errorText(e) }))
        .finally(() => setSaving(false));
      return;
    }
    create.mutate(createBody(draft), {
      onSuccess: (a) => {
        haptic('success');
        router.replace(`/automations/${encodeURIComponent(a.id)}` as Href);
        if (a.webhookToken) sheet.present(<RevealCredentials token={a.webhookToken} secret={a.webhookSigningSecret} onDone={() => sheet.dismiss()} />, { title: 'Webhook credentials', detents: ['large'] });
      },
      onError: (e) => toast({ kind: 'error', message: errorText(e) }),
      onSettled: () => setSaving(false),
    });
  };
  const next = (): void => {
    setTouched(true);
    if (problem) return;
    setTouched(false);
    if (last) finish();
    else setPage(page + 1);
  };
  const addWorkflow = (): void =>
    sheet.present(
      <ListSection>
        {(workflows.data ?? [])
          .filter((w) => !draft.workflowIds.includes(w.id))
          .map((w) => (
            <ListRow
              key={w.id}
              kind="navigation"
              icon="workflows"
              title={w.name}
              subtitle={[w.status === 'draft' ? 'Draft' : 'Published', w.stageCount ? `${w.stageCount} stages` : null].filter(Boolean).join(' · ')}
              onPress={() => {
                set({ workflowIds: [...draft.workflowIds, w.id] });
                sheet.dismiss();
              }}
              testID={`automation-wizard-workflow-${w.id}`}
            />
          ))}
      </ListSection>,
      { title: 'Add a workflow', detents: ['large'], scrollable: true },
    );
  const importRows = async (): Promise<void> => {
    const r = await pickTextFile(5 * 1024 * 1024);
    if (r.status !== 'picked') {
      if (r.status === 'too-large') toast({ kind: 'error', message: 'Datasets are limited to 5 MB.' });
      return;
    }
    const text = r.file.text.trim();
    if (/\.csv$/i.test(r.file.name)) {
      const [head, ...lines] = text.split(/\r?\n/).filter(Boolean);
      const cols = (head ?? '').split(',').map((c) => c.trim());
      const rows = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i] ?? `col${i}`, v.trim()])));
      set({ datasetJson: JSON.stringify(rows, null, 2), rows: [], fields: draft.fields.length ? draft.fields : cols.map((c) => ({ name: c, type: 'string' as DataFieldType })) });
    } else set({ datasetJson: text, rows: [] });
  };

  const time = new Date();
  time.setHours(draft.schedule.hour, draft.schedule.minute, 0, 0);
  let content: React.ReactNode;
  switch (WIZARD_STEPS[page]!.id) {
    case 'basics':
      content = (
        <View className="gap-4">
          <PageTitle title="Basics" hint="Name it and choose where its workflows come from." />
          <Field {...(touched && problem ? { error: problem } : {})}>
            <Input label="Name" value={draft.name} onChangeText={(name) => set({ name })} presentation="standalone" autoFocus={!editing} testID="automation-wizard-name" />
          </Field>
          <Textarea label="Description (optional)" value={draft.description} onChangeText={(description) => set({ description })} minRows={3} testID="automation-wizard-description" />
          <ListSection title="Project scope" footer="Only this project's workflows will be offered.">
            <ListRow kind="radio" icon="layers" title="All projects" subtitle="Global · any workflow" selected={!draft.projectId} onPress={() => set({ projectId: null, workflowIds: [] })} />
            {(projects.data ?? [])
              .filter((p) => p.status !== 'archived')
              .map((p) => (
                <ListRow key={p.id} kind="radio" icon="folder-open" title={p.name} {...(p.summary ? { subtitle: `${p.summary.codebases} codebases` } : {})} selected={draft.projectId === p.id} onPress={() => set({ projectId: p.id, workflowIds: [] })} />
              ))}
          </ListSection>
        </View>
      );
      break;
    case 'trigger': {
      const repeats = draft.schedule.repeats;
      content = (
        <View className="gap-4">
          <PageTitle title="Trigger" hint="Schedules run while the server is up." />
          {/* ChoiceCards stack on a phone and sit side by side from `medium` (MP-48): three in a phone row wrapped the
              titles a few letters per line. */}
          <View className={sizeClass === 'compact' ? 'gap-2' : 'flex-row gap-2'}>
            {(['manual', 'schedule', 'webhook'] as AutomationTriggerType[]).map((t) => (
              <View key={t} className={sizeClass === 'compact' ? undefined : 'flex-1'}>
                <ChoiceCard value={t} selected={draft.triggerType === t} title={{ manual: 'Manual', schedule: 'Schedule', webhook: 'Webhook' }[t]} icon={({ manual: 'hand', schedule: 'clock', webhook: 'webhook' } as const)[t]} onPress={() => set({ triggerType: t })} testID={`automation-wizard-trigger-${t}`} />
              </View>
            ))}
          </View>
          {draft.triggerType === 'schedule' ? (
            <View className="gap-3">
              <SegmentedControl<Repeats>
                accessibilityLabel="Repeats"
                value={repeats}
                onValueChange={(r) => set({ schedule: { ...draft.schedule, repeats: r, cron: r === 'cron' ? scheduleToCron(draft.schedule) : draft.schedule.cron } })}
                segments={[
                  { value: 'daily', label: 'Every day' },
                  { value: 'weekdays', label: 'Weekdays' },
                  { value: 'weekly', label: 'Weekly' },
                  { value: 'cron', label: 'Cron' },
                ]}
                fullWidth
                testID="automation-wizard-repeats"
              />
              {repeats === 'weekly' ? (
                <ChipGroup
                  accessibilityLabel="Days"
                  selection="multi"
                  layout="wrap"
                  value={draft.schedule.days.map(String)}
                  onValueChange={(v) => set({ schedule: { ...draft.schedule, days: (v as string[]).map(Number) } })}
                  items={DAY_SHORT.map((d, i) => ({ id: String(i), label: d }))}
                />
              ) : null}
              {repeats === 'cron' ? (
                <Field {...(problem ? { error: problem } : { help: 'minute hour day month weekday' })}>
                  <Input label="Cron" value={draft.schedule.cron} onChangeText={(cron) => set({ schedule: { ...draft.schedule, cron } })} kind="mono" presentation="standalone" testID="automation-wizard-cron" />
                </Field>
              ) : (
                <ListSection footer={`Cron ${scheduleToCron(draft.schedule)} · generated`}>
                  <ListRow kind="value" title="Time" value="" badge={<DatePicker mode="time" value={time} onValueChange={(d) => set({ schedule: { ...draft.schedule, hour: d.getHours(), minute: d.getMinutes() } })} label="Time" minuteInterval={5} />} />
                </ListSection>
              )}
              <Select label="Time zone" value={draft.schedule.timezone} options={zones.map((z) => ({ value: z, label: z }))} onValueChange={(timezone) => set({ schedule: { ...draft.schedule, timezone } })} searchable presentation="field" testID="automation-wizard-timezone" />
              <ListSection>
                <ListRow kind="segmented" title="Server was off" segmented={{ value: draft.missedRunPolicy, onValueChange: (v) => set({ missedRunPolicy: v as 'skip' | 'run_once' }), segments: [{ value: 'skip', label: 'Skip' }, { value: 'run_once', label: 'Run once on start' }] }} />
                <ListRow kind="segmented" title="Previous run still going" segmented={{ value: draft.overlapPolicy, onValueChange: (v) => set({ overlapPolicy: v as 'skip' | 'queue' }), segments: [{ value: 'skip', label: 'Skip' }, { value: 'queue', label: 'Queue' }] }} />
              </ListSection>
            </View>
          ) : draft.triggerType === 'webhook' ? (
            <Callout tone="info" title="A token and a signing secret are made when you create it and shown once." body="Senders POST to the automation's webhook URL with X-Webhook-Token and an HMAC X-Signature-256." />
          ) : (
            <Callout tone="info" title="Runs only when you start it: Run now, Run with dataset, or from a chat." />
          )}
        </View>
      );
      break;
    }
    case 'workflow':
      content = (
        <View className="gap-4">
          <PageTitle title="Workflow & permission" hint="Several workflows run one after another." />
          <ListSection title="Workflows" action={{ label: 'Add', onPress: addWorkflow }} {...(touched && problem ? { footer: problem } : {})}>
            {draft.workflowIds.length === 0 ? <ListRow kind="link" icon="plus" title="Add a workflow" onPress={addWorkflow} testID="automation-wizard-add-workflow" /> : null}
            {draft.workflowIds.map((wid, i) => {
              const w = byId.get(wid);
              const move = (to: number): void => {
                const ids = [...draft.workflowIds];
                ids.splice(to, 0, ids.splice(i, 1)[0]!);
                set({ workflowIds: ids });
              };
              return (
                <ListRow
                  key={wid}
                  kind="info"
                  icon="workflows"
                  title={`${i + 1}. ${w?.name ?? wid}`}
                  {...(w ? { subtitle: [w.status === 'draft' ? 'Draft' : 'Published', w.stageCount ? `${w.stageCount} stages` : null].filter(Boolean).join(' · ') } : {})}
                  badge={
                    <View className="flex-row">
                      {i > 0 ? <IconButton icon="chevron-up" size="sm" label={`Move ${w?.name ?? 'workflow'} up`} onPress={() => move(i - 1)} /> : null}
                      {i < draft.workflowIds.length - 1 ? <IconButton icon="chevron-down" size="sm" label={`Move ${w?.name ?? 'workflow'} down`} onPress={() => move(i + 1)} /> : null}
                      <IconButton icon="x" size="sm" label={`Remove ${w?.name ?? 'workflow'}`} onPress={() => set({ workflowIds: draft.workflowIds.filter((x) => x !== wid) })} />
                    </View>
                  }
                />
              );
            })}
          </ListSection>
          <View className="gap-2">
            <Text role="subhead" weight={600}>
              Permission mode
            </Text>
            <SegmentedControl<WorkflowRunPermissionMode>
              accessibilityLabel="Permission mode"
              value={draft.permissionMode}
              onValueChange={(permissionMode) => set({ permissionMode })}
              segments={(['plan', 'default', 'acceptEdits', 'bypassPermissions'] as WorkflowRunPermissionMode[]).map((m) => ({ value: m, label: PERMISSION_LABEL[m], ...(m === 'bypassPermissions' && bypassLocked ? { locked: true } : {}) }))}
              fullWidth
              testID="automation-wizard-permission"
            />
            <Text role="footnote" tone="fg-3">
              {bypassLocked ? 'Bypass on a webhook automation needs an admin opt-in (admin:settings).' : 'Every run of this automation uses this mode.'}
            </Text>
          </View>
        </View>
      );
      break;
    case 'dataset': {
      const oneField = draft.fields.length === 1;
      content = (
        <View className="gap-4">
          <PageTitle title="Dataset" hint="One run per row; no rows means one run." />
          <ListSection title="Data schema" count={draft.fields.length} action={{ label: 'Add field', onPress: () => set({ fields: [...draft.fields, { name: '', type: 'string', required: true }] }) }}>
            {draft.fields.length === 0 ? <ListRow kind="info" title="No fields" subtitle="Rows pass their own keys as variables." /> : null}
            {draft.fields.map((f, i) => (
              <View key={i} className="gap-2 px-4 py-3">
                <Input label="Field" value={f.name} onChangeText={(name) => set({ fields: draft.fields.map((x, j) => (j === i ? { ...x, name } : x)) })} kind="mono" presentation="standalone" />
                <View className="flex-row items-center gap-2">
                  <View className="flex-1">
                    <Select label="Type" value={f.type} options={FIELD_TYPES.map((t) => ({ value: t, label: t }))} onValueChange={(t) => set({ fields: draft.fields.map((x, j) => (j === i ? { ...x, type: t as DataFieldType } : x)) })} presentation="field" />
                  </View>
                  <Chip label="Required" selected={f.required !== false} onPress={() => set({ fields: draft.fields.map((x, j) => (j === i ? { ...x, required: !(x.required !== false) } : x)) })} />
                  <IconButton icon="trash" size="sm" label={`Remove ${f.name || 'field'}`} onPress={() => set({ fields: draft.fields.filter((_, j) => j !== i) })} />
                </View>
              </View>
            ))}
          </ListSection>
          <View className="gap-2">
            <View className="flex-row items-center justify-between">
              <Text role="subhead" weight={600}>
                {`Default rows${oneField ? ` · ${draft.rows.length}` : ''}`}
              </Text>
              <Button label="CSV or JSON" icon="upload" size="sm" variant="ghost" onPress={() => void importRows()} testID="automation-wizard-import" />
            </View>
            {oneField && !draft.datasetJson.trim() ? (
              <View className="gap-2">
                <View className="flex-row flex-wrap gap-2">
                  {draft.rows.map((r, i) => (
                    <Chip key={`${r}:${i}`} variant="input" label={r} onRemove={() => set({ rows: draft.rows.filter((_, j) => j !== i) })} />
                  ))}
                </View>
                <Input
                  label={`Add ${draft.fields[0]!.name || 'row'}`}
                  value={rowInput}
                  onChangeText={setRowInput}
                  kind="mono"
                  presentation="standalone"
                  returnKeyType="done"
                  onSubmitEditing={() => {
                    if (rowInput.trim()) set({ rows: [...draft.rows, rowInput.trim()] });
                    setRowInput('');
                  }}
                  testID="automation-wizard-row"
                />
              </View>
            ) : (
              <Field {...(touched && problem ? { error: problem } : {})}>
                <Textarea label="Rows (JSON array)" value={draft.datasetJson} onChangeText={(datasetJson) => set({ datasetJson })} mono minRows={4} placeholder='[{"codebase": "web-dashboard"}]' testID="automation-wizard-dataset" />
              </Field>
            )}
          </View>
          <ListSection footer="Run with dataset… passes other rows at run time.">
            <ListRow kind="stepper" title="Concurrency" stepper={{ value: draft.maxConcurrency, onValueChange: (maxConcurrency) => set({ maxConcurrency }), min: 1, max: 20 }} />
            <ListRow kind="segmented" title="On error" segmented={{ value: draft.onError, onValueChange: (v) => set({ onError: v as 'continue' | 'stop' }), segments: [{ value: 'continue', label: 'Continue' }, { value: 'stop', label: 'Stop' }] }} />
          </ListSection>
        </View>
      );
      break;
    }
    case 'variables':
      content = (
        <View className="gap-4">
          <PageTitle title="Variables & retry" hint="Every run gets these; dataset fields override them." />
          <ListSection title="Base variables" {...(touched && problem ? { footer: problem } : {})}>
            {draft.variables.map((v, i) => (
              <View key={i} className="flex-row items-center gap-2 px-4 py-2">
                <View className="flex-1">
                  <Input label="Name" value={v.key} onChangeText={(key) => set({ variables: draft.variables.map((x, j) => (j === i ? { ...x, key } : x)) })} kind="mono" presentation="standalone" />
                </View>
                <View className="flex-1">
                  <Input label="Value" value={v.value} onChangeText={(value) => set({ variables: draft.variables.map((x, j) => (j === i ? { ...x, value } : x)) })} kind="mono" presentation="standalone" />
                </View>
                <IconButton icon="x" size="sm" label={`Remove ${v.key || 'variable'}`} onPress={() => set({ variables: draft.variables.filter((_, j) => j !== i) })} />
              </View>
            ))}
            <ListRow kind="link" icon="plus" title="Add variable" onPress={() => set({ variables: [...draft.variables, { key: '', value: '' }] })} testID="automation-wizard-add-variable" />
          </ListSection>
          <ListSection>
            <ListRow kind="toggle" icon="retry" title="Retry failed executions" subtitle="3 attempts · 1s × 2, max 60s · workflow_failed, timeout" switchValue={draft.retry} onValueChange={(retry) => set({ retry })} testID="automation-wizard-retry" />
          </ListSection>
        </View>
      );
      break;
    default: {
      const rows = reviewRows(draft, { project: projectName, workflows: draft.workflowIds.map((w) => byId.get(w)?.name ?? w) });
      content = (
        <View className="gap-4">
          <PageTitle title="Review" hint="Tap a row to change it." />
          <ListSection>
            {rows.map((r) => (
              <ListRow key={r.label} kind="navigation" title={r.label} value={r.value} onPress={() => setPage(r.page)} />
            ))}
          </ListSection>
          <KeyValueList items={[{ label: 'Cron', value: draft.triggerType === 'schedule' ? scheduleToCron(draft.schedule) : '—', mono: true }]} />
        </View>
      );
    }
  }

  return (
    <FullScreenEditor
      title={editing ? 'Edit automation' : 'New automation'}
      {...(editing ? { primary: { label: 'Save', onPress: finish, loading: saving, disabled: !dirty || saving } } : {})}
      onCancel={close}
      dirty={dirty && !saving && !create.isSuccess}
      navigation={navigation as never}
      stepper={<Stepper steps={WIZARD_STEPS.map((s) => ({ id: s.id, label: s.label }))} current={page} done={WIZARD_STEPS.map((_, i) => i).filter((i) => i < page)} />}
      stickyBar={
        <StickyActionBar
          summary={{ title: last ? 'Ready' : `Next: ${WIZARD_STEPS[page + 1]!.label.toLowerCase()}` }}
          {...(page > 0 ? { secondary: { label: 'Back', icon: 'back', onPress: () => setPage(page - 1), testID: 'automation-wizard-back' } } : {})}
          primary={{ label: last ? (editing ? 'Save automation' : 'Create automation') : 'Continue', ...(last ? { icon: 'check' as const } : { trailingIcon: 'forward' as const }), loading: saving, onPress: next, testID: 'automation-wizard-next' }}
        />
      }
      testID="automation-wizard"
    >
      {content}
    </FullScreenEditor>
  );
}
