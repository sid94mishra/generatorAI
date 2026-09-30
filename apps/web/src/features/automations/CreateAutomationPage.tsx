// ────────────────────────────────────────────────────────────────
// CreateAutomationPage (L-02 Wizard + C-17 Stepper, TanStack Form 1 + zod 4
// — D-38; 04-screen-map.md §2.6 AutomationCreate) — ports
// pages/CreateAutomationPage.tsx (40 `useState`s) onto the kit as a 4-step
// wizard (D-35 fallback port): Basics, Trigger, Workflow & permission,
// Advanced & review.
//
// The board's wizard chrome (Draft badge, "Draft saved HH:mm", Save draft)
// has no backing: automations have no draft/autosave concept in the API
// (unlike workflow definitions) — CreateAutomationParams is one atomic POST.
// Rendering it would be fake data (D-36), so this wizard's header has no
// Draft badge and its ActionBar has no Save-draft button; the last step's
// primary action is "Create automation".
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useForm, useStore } from '@tanstack/react-form';
import { Link as RouterLink } from 'react-router';
import { getNextCronRun } from '@generatorai/shared';
import { useCreateAutomation } from '@/hooks/automationQueries.js';
import { useProjects } from '@/hooks/projectQueries.js';
import { useWorkflowDefinitions } from '@/hooks/workflowQueries.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Chip } from '@/ui/primitives/Chip/Chip.js';
import { Field } from '@/ui/primitives/Field/Field.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { Select, type SelectItem } from '@/ui/primitives/Select/Select.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { Textarea } from '@/ui/primitives/Textarea/Textarea.js';
import { ActionBar } from '@/ui/patterns/ActionBar/ActionBar.js';
import { Breadcrumb } from '@/ui/patterns/Breadcrumb/Breadcrumb.js';
import { ChoiceCardGrid } from '@/ui/patterns/ChoiceCardGrid/ChoiceCardGrid.js';
import { FormSection } from '@/ui/patterns/FormSection/FormSection.js';
import { PageHeader } from '@/ui/patterns/PageHeader/PageHeader.js';
import { Stepper, type StepperStep } from '@/ui/patterns/Stepper/Stepper.js';
import { Wizard } from '@/ui/templates/Wizard/Wizard.js';
import {
  automationFormSchema,
  automationFormToParams,
  emptyAutomationForm,
  validateAutomationForm,
  type AutomationFormValues,
  type AutomationInputMode,
} from './automationFormSchema.js';
import { WebhookCredentialsDialog, type WebhookCredentials } from './WebhookCredentialsDialog.js';

const STEP_IDS = ['basics', 'trigger', 'workflow', 'review'] as const;
type StepId = (typeof STEP_IDS)[number];

const STEP_TITLES: Record<StepId, string> = {
  basics: 'Basics',
  trigger: 'Trigger',
  workflow: 'Workflow & permission',
  review: 'Advanced & review',
};

const TRIGGER_OPTIONS = [
  { value: 'manual', icon: 'hand' as const, title: 'Manual', description: 'Runs when someone clicks Run now, optionally with a dataset.' },
  { value: 'schedule', icon: 'clock' as const, title: 'Schedule', description: 'Runs on a repeating schedule while the server is up.' },
  { value: 'webhook', icon: 'webhook' as const, title: 'Webhook', description: 'Runs on an HTTP POST signed with a token you get after saving.' },
];

const INPUT_MODE_OPTIONS: { value: AutomationInputMode; title: string; description: string }[] = [
  { value: 'single', title: 'Single run', description: 'Runs once per trigger with the base variables.' },
  { value: 'each_row', title: 'Each row', description: 'Runs once per row of a dataset supplied at trigger time.' },
  { value: 'group_by', title: 'Grouped rows', description: 'Groups rows by one or more fields and runs once per group.' },
  { value: 'whole_dataset', title: 'Whole dataset', description: 'Runs once with the whole dataset bound to one variable.' },
];

const PERMISSION_ITEMS: SelectItem[] = [
  { value: 'acceptEdits', label: 'Accept edits', meta: 'file edits run, other tools wait' },
  { value: 'default', label: 'Ask', meta: 'every gated tool call waits' },
  { value: 'plan', label: 'Plan', meta: 'read-only; the plan waits for approval' },
  { value: 'bypassPermissions', label: 'Bypass', meta: 'no approvals — needs admin for a webhook' },
];

export function CreateAutomationPage() {
  const navigate = useNavigate();
  const createMutation = useCreateAutomation();
  const { data: projects } = useProjects();
  const { data: workflows, isLoading: workflowsLoading } = useWorkflowDefinitions();

  const [step, setStep] = useState<StepId>('basics');
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [webhookCredentials, setWebhookCredentials] = useState<WebhookCredentials | null>(null);
  const [createdAutomationId, setCreatedAutomationId] = useState<string | null>(null);

  const form = useForm({
    defaultValues: emptyAutomationForm(),
    onSubmit: async ({ value }) => {
      const errors = validateAutomationForm(value);
      if (errors.length > 0) {
        setSaveAttempted(true);
        return;
      }
      const params = automationFormToParams(value);
      const automation = await createMutation.mutateAsync(params);
      // The server shows the raw webhook token + signing secret ONLY in the
      // create response (PARITY-9) — never again on any GET/list/update.
      const created = automation as typeof automation & { webhookSigningSecret?: string };
      if (created.triggerType === 'webhook' && created.webhookToken) {
        setWebhookCredentials({
          webhookUrl: `${window.location.origin}/api/automations/webhooks/${created.webhookToken}`,
          token: created.webhookToken,
          signingSecret: created.webhookSigningSecret,
        });
        setCreatedAutomationId(automation.id);
        return;
      }
      navigate(`/automations/${automation.id}`);
    },
  });

  const values = useStore(form.store, (s) => s.values);
  const isSubmitting = useStore(form.store, (s) => s.isSubmitting);
  const errors = validateAutomationForm(values);
  const showErrors = errors.length > 0 && saveAttempted;

  const runnableWorkflows = (workflows ?? []).filter((w) => w.status === 'published' && !w.archivedAt);
  const filteredWorkflows = values.projectId ? runnableWorkflows.filter((w) => w.projectId === values.projectId || !w.projectId) : runnableWorkflows;

  // Maps each zod issue's top-level field to the step that owns it, so the
  // Stepper can mark exactly the step(s) with a real validation problem
  // (C-17 "errors in text-err") instead of a substring guess over messages.
  const FIELD_STEP: Partial<Record<string, StepId>> = {
    name: 'basics',
    cronExpression: 'trigger',
    workflowIds: 'workflow',
    variablesText: 'review',
    dataSchemaText: 'review',
    groupByFieldsText: 'review',
    retryMaxAttempts: 'review',
    retryOnFailed: 'review',
  };
  const parseResult = automationFormSchema.safeParse(values);
  const fieldErrorSteps = new Set(parseResult.success ? [] : parseResult.error.issues.map((issue) => FIELD_STEP[String(issue.path[0])]).filter(Boolean));
  const stepHasError = (id: StepId) => saveAttempted && fieldErrorSteps.has(id);
  /** The first validation message for one field, once a save has been attempted. */
  const fieldError = (name: string): string | undefined => {
    if (!saveAttempted || parseResult.success) return undefined;
    return parseResult.error.issues.find((issue) => issue.path[0] === name)?.message;
  };

  const steps: StepperStep[] = STEP_IDS.map((id) => ({
    id,
    title: STEP_TITLES[id],
    subtitle:
      id === 'basics'
        ? values.name || 'Name and description'
        : id === 'trigger'
          ? TRIGGER_OPTIONS.find((t) => t.value === values.triggerType)?.title
          : id === 'workflow'
            ? `${values.workflowIds.length} workflow${values.workflowIds.length === 1 ? '' : 's'}`
            : 'Variables, dataset, retry',
    state: STEP_IDS.indexOf(id) < STEP_IDS.indexOf(step) ? 'done' : id === step ? 'current' : 'future',
    error: stepHasError(id),
  }));

  const stepIndex = STEP_IDS.indexOf(step);
  const goNext = () => setStep(STEP_IDS[Math.min(STEP_IDS.length - 1, stepIndex + 1)]!);
  const goBack = () => setStep(STEP_IDS[Math.max(0, stepIndex - 1)]!);

  const nextRuns =
    values.triggerType === 'schedule'
      ? (() => {
          const out: Date[] = [];
          try {
            let from = new Date();
            for (let i = 0; i < 3; i++) {
              from = getNextCronRun(values.cronExpression.trim(), from, values.timezone);
              out.push(from);
            }
          } catch {
            /* an invalid cron expression is reported by the step's own error */
          }
          return out;
        })()
      : [];

  return (
    <>
      <Wizard
        header={
          <PageHeader
            breadcrumb={<Breadcrumb currentIsHeading items={[{ label: 'Automations', render: <RouterLink to="/automations" /> }, { label: 'New automation' }]} />}
            actions={
              <Button variant="ghost" onClick={() => navigate('/automations')}>
                Cancel
              </Button>
            }
          />
        }
        stepper={<Stepper steps={steps} current={step} onSelect={(id) => setStep(id as StepId)} footer="Saving validates every step." />}
        content={
          <>
            <div>
              <p className="text-small text-fg-3">
                Step {stepIndex + 1} of {STEP_IDS.length}
              </p>
              <h2 className="text-heading text-fg">{STEP_TITLES[step]}</h2>
            </div>

            {showErrors ? (
              <Callout tone="err" data-testid="automation-form-errors">
                <ul className="flex flex-col gap-0.5">
                  {errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </Callout>
            ) : null}

            {step === 'basics' ? (
              <FormSection title="Name & description" first>
                <form.Field name="name">
                  {(field) => (
                    <Field label="Name *">
                      <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="Nightly audit" />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="description">
                  {(field) => (
                    <Field label="Description" optional>
                      <Textarea value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} rows={2} placeholder="What this automation does" />
                    </Field>
                  )}
                </form.Field>
                <form.Field name="projectId">
                  {(field) => (
                    <Field label="Project scope" hint="Only workflows from this project will be offered in the next step.">
                      <Select
                        aria-label="Project scope"
                        value={field.state.value || null}
                        onValueChange={(v) => {
                          field.handleChange(v ?? '');
                          form.setFieldValue('workflowIds', []);
                        }}
                        items={[{ value: '', label: 'All projects (global)' }, ...(projects ?? []).filter((p) => p.status === 'active').map((p) => ({ value: p.id, label: p.name }))]}
                      />
                    </Field>
                  )}
                </form.Field>
              </FormSection>
            ) : null}

            {step === 'trigger' ? (
              <FormSection title="Choose a trigger" first>
                <form.Field name="triggerType">
                  {(field) => (
                    <ChoiceCardGrid
                      label="Trigger"
                      columns={3}
                      value={field.state.value}
                      onValueChange={(v) => field.handleChange(v as AutomationFormValues['triggerType'])}
                      options={TRIGGER_OPTIONS}
                    />
                  )}
                </form.Field>
                {values.triggerType === 'schedule' ? (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <form.Field name="cronExpression">
                        {(field) => (
                          <Field label="Cron expression *" hint='Minute hour day month weekday. Example: "0 9 * * *" = daily at 9 AM' error={fieldError('cronExpression')}>
                            <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} mono placeholder="0 9 * * *" />
                          </Field>
                        )}
                      </form.Field>
                      <form.Field name="timezone">
                        {(field) => (
                          <Field label="Timezone">
                            <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="America/New_York" />
                          </Field>
                        )}
                      </form.Field>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <form.Field name="missedRunPolicy">
                        {(field) => (
                          <Field label="If the server was off at run time">
                            <Select
                              aria-label="Missed-run policy"
                              value={field.state.value}
                              onValueChange={(v) => field.handleChange((v ?? 'skip') as AutomationFormValues['missedRunPolicy'])}
                              items={[{ value: 'skip', label: 'Skip' }, { value: 'run_once', label: 'Run once on start' }]}
                            />
                          </Field>
                        )}
                      </form.Field>
                      <form.Field name="overlapPolicy">
                        {(field) => (
                          <Field label="If the previous execution is still running">
                            <Select
                              aria-label="Overlap policy"
                              value={field.state.value}
                              onValueChange={(v) => field.handleChange((v ?? 'skip') as AutomationFormValues['overlapPolicy'])}
                              items={[{ value: 'skip', label: 'Skip' }, { value: 'queue', label: 'Queue' }]}
                            />
                          </Field>
                        )}
                      </form.Field>
                    </div>
                    {nextRuns.length > 0 ? (
                      <Callout title={`Next ${nextRuns.length} runs`}>
                        <ul className="flex flex-col gap-1 font-mono text-small">
                          {nextRuns.map((d, i) => (
                            <li key={i}>{d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</li>
                          ))}
                        </ul>
                      </Callout>
                    ) : null}
                  </>
                ) : null}
              </FormSection>
            ) : null}

            {step === 'workflow' ? (
              <FormSection title="Workflows *" first hint="Selected workflows run sequentially, in order.">
                {values.workflowIds.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {values.workflowIds.map((wid) => {
                      const wf = (workflows ?? []).find((w) => w.id === wid);
                      return (
                        <Chip key={wid} onRemove={() => form.setFieldValue('workflowIds', values.workflowIds.filter((w) => w !== wid))}>
                          {wf?.name ?? wid.slice(0, 8)}
                        </Chip>
                      );
                    })}
                  </div>
                ) : null}
                <Select
                  aria-label="Add a workflow"
                  value={null}
                  disabled={workflowsLoading}
                  onValueChange={(v) => {
                    if (v && !values.workflowIds.includes(v)) form.setFieldValue('workflowIds', [...values.workflowIds, v]);
                  }}
                  placeholder="+ Add a workflow…"
                  items={filteredWorkflows.filter((w) => !values.workflowIds.includes(w.id)).map((w) => ({ value: w.id, label: `${w.name}${w.projectId ? '' : ' (global)'}` }))}
                />

                <div className="grid grid-cols-2 gap-4">
                  <form.Field name="maxConcurrency">
                    {(field) => (
                      <Field label="Max concurrency">
                        <NumberField value={field.state.value} onValueChange={(v) => field.handleChange(Math.max(1, Math.min(10, v ?? 1)))} min={1} max={10} aria-label="Max concurrency" />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field name="onError">
                    {(field) => (
                      <Field label="On error">
                        <Select
                          aria-label="On error"
                          value={field.state.value}
                          onValueChange={(v) => field.handleChange((v ?? 'continue') as AutomationFormValues['onError'])}
                          items={[{ value: 'continue', label: 'Continue on error' }, { value: 'stop', label: 'Stop on error' }]}
                        />
                      </Field>
                    )}
                  </form.Field>
                </div>
                <form.Field name="permissionMode">
                  {(field) => (
                    <Field label="Permission mode" hint="Nobody watches an automation run, so its tool-approval policy is set here.">
                      <Select aria-label="Permission mode" value={field.state.value} onValueChange={(v) => field.handleChange((v ?? 'acceptEdits') as AutomationFormValues['permissionMode'])} items={PERMISSION_ITEMS} />
                    </Field>
                  )}
                </form.Field>
              </FormSection>
            ) : null}

            {step === 'review' ? (
              <>
                <FormSection title="Base variables" first hint="JSON object merged into every workflow run">
                  <form.Field name="variablesText">
                    {(field) => (
                      <Field label="Base variables (JSON)" error={fieldError('variablesText')}>
                        <Textarea aria-label="Base variables (JSON)" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} rows={4} textareaClassName="font-mono text-small" placeholder='{ "key": "value" }' />
                      </Field>
                    )}
                  </form.Field>
                </FormSection>

                <FormSection title="Input mode" hint="Without a dataset an automation runs its workflows once with the base variables.">
                  <form.Field name="inputMode">
                    {(field) => (
                      <ChoiceCardGrid label="Input mode" columns={2} value={field.state.value} onValueChange={(v) => field.handleChange(v as AutomationInputMode)} options={INPUT_MODE_OPTIONS} />
                    )}
                  </form.Field>

                  {values.inputMode !== 'single' ? (
                    <>
                      <form.Field name="dataSchemaText">
                        {(field) => (
                          <Field label="Data schema (JSON)" error={fieldError('dataSchemaText')}>
                            <Textarea value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} rows={8} textareaClassName="font-mono text-micro" />
                          </Field>
                        )}
                      </form.Field>
                      {values.inputMode === 'group_by' ? (
                        <div className="grid grid-cols-2 gap-4">
                          <form.Field name="groupByFieldsText">
                            {(field) => (
                              <Field label="Fields (comma-separated)" error={fieldError('groupByFieldsText')}>
                                <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="priority,team" />
                              </Field>
                            )}
                          </form.Field>
                          <form.Field name="groupVariable">
                            {(field) => (
                              <Field label="Group variable">
                                <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="items" />
                              </Field>
                            )}
                          </form.Field>
                        </div>
                      ) : values.inputMode === 'whole_dataset' ? (
                        <form.Field name="groupVariable">
                          {(field) => (
                            <Field label="Dataset variable">
                              <Input value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} placeholder="items" />
                            </Field>
                          )}
                        </form.Field>
                      ) : null}
                      <form.Field name="defaultDatasetFormat">
                        {(formatField) => (
                          <form.Field name="defaultDatasetText">
                            {(textField) => (
                              <Field label="Default dataset" hint="Used for schedule triggers and as a fallback for manual triggers.">
                                <div className="mb-1 flex gap-2">
                                  {(['json_array', 'csv', 'jsonl'] as const).map((f) => (
                                    <Chip key={f} pressed={formatField.state.value === f} onClick={() => formatField.handleChange(f)}>
                                      {f}
                                    </Chip>
                                  ))}
                                </div>
                                <Textarea aria-label="Default dataset" value={textField.state.value} onChange={(e) => textField.handleChange(e.target.value)} rows={5} textareaClassName="font-mono text-micro" placeholder="Leave blank if manual-only" />
                              </Field>
                            )}
                          </form.Field>
                        )}
                      </form.Field>
                    </>
                  ) : null}
                </FormSection>

                <FormSection title="Retry policy" hint="Re-run a failing iteration up to N times with exponential backoff.">
                  <form.Field name="retryEnabled">
                    {(field) => <Switch checked={field.state.value} onCheckedChange={field.handleChange} label="Enable retries" />}
                  </form.Field>
                  {values.retryEnabled ? (
                    <div className="grid grid-cols-2 gap-4">
                      <form.Field name="retryMaxAttempts">
                        {(field) => (
                          <Field label="Max attempts" error={fieldError('retryMaxAttempts')}>
                            <NumberField value={field.state.value} onValueChange={(v) => field.handleChange(v ?? 2)} min={2} max={10} aria-label="Max attempts" />
                          </Field>
                        )}
                      </form.Field>
                      <form.Field name="retryInitialBackoffMs">
                        {(field) => (
                          <Field label="Initial backoff">
                            <NumberField value={field.state.value} onValueChange={(v) => field.handleChange(v ?? 1000)} min={100} unit="ms" aria-label="Initial backoff (ms)" />
                          </Field>
                        )}
                      </form.Field>
                      <form.Field name="retryBackoffMultiplier">
                        {(field) => (
                          <Field label="Backoff multiplier">
                            <NumberField value={field.state.value} onValueChange={(v) => field.handleChange(v ?? 2)} min={1} step={0.5} aria-label="Backoff multiplier" />
                          </Field>
                        )}
                      </form.Field>
                      <form.Field name="retryMaxBackoffMs">
                        {(field) => (
                          <Field label="Max backoff">
                            <NumberField value={field.state.value} onValueChange={(v) => field.handleChange(v ?? 60_000)} min={1000} unit="ms" aria-label="Max backoff (ms)" />
                          </Field>
                        )}
                      </form.Field>
                      <div className="col-span-2 flex items-center gap-4" role="group" aria-label="Retry on">
                        <form.Field name="retryOnFailed">{(field) => <Switch checked={field.state.value} onCheckedChange={field.handleChange} label="workflow_failed" />}</form.Field>
                        <form.Field name="retryOnTimeout">{(field) => <Switch checked={field.state.value} onCheckedChange={field.handleChange} label="timeout" />}</form.Field>
                        <form.Field name="retryOnNetwork">{(field) => <Switch checked={field.state.value} onCheckedChange={field.handleChange} label="network" />}</form.Field>
                      </div>
                    </div>
                  ) : null}
                </FormSection>
              </>
            ) : null}
          </>
        }
        actions={
          <ActionBar
            secondary={
              <Button variant="ghost" disabled={stepIndex === 0} onClick={goBack}>
                Back
              </Button>
            }
            primary={
              step === 'review' ? (
                <Button
                  variant="primary"
                  icon="plus"
                  disabled={isSubmitting}
                  loading={isSubmitting}
                  onClick={() => {
                    setSaveAttempted(true);
                    void form.handleSubmit();
                  }}
                  data-testid="automation-create-submit"
                >
                  Create automation
                </Button>
              ) : (
                <Button variant="primary" onClick={goNext}>
                  Continue
                </Button>
              )
            }
          />
        }
      />
      <WebhookCredentialsDialog
        open={webhookCredentials !== null}
        credentials={webhookCredentials}
        onClose={() => {
          setWebhookCredentials(null);
          if (createdAutomationId) navigate(`/automations/${createdAutomationId}`);
        }}
      />
    </>
  );
}
