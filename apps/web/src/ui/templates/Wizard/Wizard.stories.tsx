import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { Badge } from '../../primitives/Badge/Badge.js';
import { Button } from '../../primitives/Button/Button.js';
import { Field } from '../../primitives/Field/Field.js';
import { Input } from '../../primitives/Input/Input.js';
import { ActionBar } from '../../patterns/ActionBar/ActionBar.js';
import { Breadcrumb } from '../../patterns/Breadcrumb/Breadcrumb.js';
import { PageHeader } from '../../patterns/PageHeader/PageHeader.js';
import { Stepper, type StepperStep } from '../../patterns/Stepper/Stepper.js';
import { Wizard } from './Wizard.js';

const STEP_IDS = ['basics', 'trigger', 'workflow', 'review'] as const;

function Demo() {
  const [step, setStep] = useState<(typeof STEP_IDS)[number]>('trigger');
  const index = STEP_IDS.indexOf(step);
  const steps: StepperStep[] = [
    { id: 'basics', title: 'Basics', subtitle: 'Nightly audit', state: index > 0 ? 'done' : 'current' },
    { id: 'trigger', title: 'Trigger', subtitle: 'Schedule', state: index > 1 ? 'done' : index === 1 ? 'current' : 'future' },
    { id: 'workflow', title: 'Workflow & permission', subtitle: 'Permission mode is required', state: index > 2 ? 'done' : index === 2 ? 'current' : 'future' },
    { id: 'review', title: 'Retry & review', subtitle: 'Retry policy, summary', state: index === 3 ? 'current' : 'future' },
  ];
  return (
    <div className="h-[600px] w-260 overflow-hidden rounded-panel border border-line-soft">
      <Wizard
        header={
          <PageHeader
            breadcrumb={<Breadcrumb items={[{ label: 'Automations' }, { label: 'New automation' }]} />}
            meta={<Badge>Draft</Badge>}
            actions={<Button variant="ghost">Cancel</Button>}
          />
        }
        stepper={
          <Stepper
            steps={steps}
            current={step}
            onSelect={(id) => setStep(id as (typeof STEP_IDS)[number])}
            footer="Saving validates every step."
          />
        }
        content={
          <>
            <div>
              <p className="text-small text-fg-3">
                Step {index + 1} of {STEP_IDS.length}
              </p>
              <h2 className="text-heading text-fg">{steps[index]?.title}</h2>
            </div>
            <Field label="Name">
              <Input placeholder="My automation" />
            </Field>
          </>
        }
        actions={
          <ActionBar
            hint="Next: workflow and permission"
            secondary={
              <>
                <Button variant="ghost" disabled={index === 0} onClick={() => setStep(STEP_IDS[Math.max(0, index - 1)]!)}>
                  Back
                </Button>
                <Button variant="ghost">Save draft</Button>
              </>
            }
            primary={
              <Button variant="primary" onClick={() => setStep(STEP_IDS[Math.min(STEP_IDS.length - 1, index + 1)]!)}>
                Continue
              </Button>
            }
          />
        }
      />
    </div>
  );
}

const meta = {
  component: Wizard,
  tags: ['vrt-themes'],
  args: { header: null, stepper: null, content: null, actions: null },
} satisfies Meta<typeof Wizard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => <Demo />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: /Continue/ })).toBeInTheDocument();
    await expect(within(canvasElement).getByRole('heading', { name: /Trigger/ })).toBeInTheDocument();
  },
};
