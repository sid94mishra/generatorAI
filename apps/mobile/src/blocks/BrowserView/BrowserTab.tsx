// MB-28 / MB-29 tab bodies behind their gates: `exec:browser` / `exec:computer` (Request access) and the step-up,
// asked only while the tab is on screen (TabGates).
import React from 'react';

import { ComputerView } from '../ComputerView';
import { LockedTab, StepUpTab } from '../WorkspacePane/TabGates';
import { checkFeature } from '../../services/auth/featureGate';
import { useGrantedScopes } from '../../services/auth/useCapability';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { BrowserView, type BrowserViewProps } from './BrowserView';

const noWorkspace = <EmptyState icon="browser" title="No workspace yet" description="A workspace is created the first time the agent runs here." />;

export function BrowserTab({ workspaceId, ...rest }: Omit<BrowserViewProps, 'workspaceId'> & { workspaceId: string | null }): React.ReactElement {
  const feature = checkFeature('browser', useGrantedScopes());
  if (!workspaceId) return noWorkspace;
  if (!feature.available) return <LockedTab title="Browser" feature={feature} scope="exec:browser" />;
  return (
    <StepUpTab reason="Confirm opening the browser" active={rest.active}>
      <BrowserView workspaceId={workspaceId} {...rest} />
    </StepUpTab>
  );
}

export function ComputerTab({ workspaceId, active }: { workspaceId: string | null; active: boolean }): React.ReactElement {
  const feature = checkFeature('computer', useGrantedScopes());
  if (!workspaceId) return noWorkspace;
  if (!feature.available) return <LockedTab title="Computer use" feature={feature} scope="exec:computer" />;
  return (
    <StepUpTab reason="Confirm viewing computer use" active={active}>
      <ComputerView workspaceId={workspaceId} active={active} />
    </StepUpTab>
  );
}
