// MB-49 RunRow (03 MB-49; MWorkflowDetail, MProjectDetail): EntityRow with the status glyph, the run's words from
// runRowModel and the mono duration; a tap opens the run under its workflow (MD-80). Menu: Open.
import React from 'react';
import { router } from 'expo-router';

import { EntityRow } from '../../ui/layout/EntityRow';
import type { RowPosition } from '../../ui/layout/ListSection/ListSection.types';
import { Text } from '../../ui/primitives/Text';
import { runHref } from '../shell/hrefs';
import { runRowView, type RunRowInput } from './runRowModel';

type Href = Parameters<typeof router.push>[0];

export interface RunRowProps {
  run: RunRowInput;
  /** 'workflow': inside the workflow's screens (title = the status word); 'any': lists across workflows. */
  context: 'workflow' | 'any';
  versionLabel?: string | null;
  workflowName?: string;
  position?: RowPosition;
  testID?: string;
}

export function RunRow({ run, context, versionLabel, workflowName, position, testID }: RunRowProps): React.ReactElement {
  const view = runRowView(run, { context, ...(versionLabel !== undefined ? { versionLabel } : {}), ...(workflowName ? { workflowName } : {}) });
  return (
    <EntityRow
      title={view.title}
      leading={{ status: view.status.state }}
      meta={view.meta}
      {...(view.duration ? { trailing: <Text role="monoSm" tone={view.live ? 'run' : 'fg-3'}>{view.duration}</Text> } : {})}
      onPress={() => router.push(runHref(run.workflowDefinitionId, run.id) as Href)}
      {...(position ? { position } : {})}
      testID={testID ?? `run-row-${run.id}`}
    />
  );
}
