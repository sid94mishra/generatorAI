// MB-47 PermissionModePicker (03 MB-47; MWorkflowLaunchAdvanced, the run's permission change): the run modes as
// radio rows, strictest first, each with its one-line meaning; Bypass is a "Requires admin access" row (→ the
// scope request sheet) on a device without `admin:settings`. `null` = no choice yet (the workflow's, then the
// server's default applies).
import React from 'react';
import { router } from 'expo-router';

import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { scopeRequestHref } from '../shell/hrefs';
import { BYPASS_SCOPE, PERMISSION_MODE_DETAIL, PERMISSION_MODE_LABEL, RUN_PERMISSION_MODES, type RunPermissionMode } from './permissionModeModel';

type Href = Parameters<typeof router.push>[0];

export interface PermissionModePickerProps {
  value: RunPermissionMode | null;
  onValueChange: (mode: RunPermissionMode) => void;
  /** The device holds `admin:settings`. */
  canBypass: boolean;
  title?: string;
  footer?: string;
  testIDPrefix?: string;
}

export function PermissionModePicker({ value, onValueChange, canBypass, title = 'Permission mode', footer, testIDPrefix = 'permission-mode' }: PermissionModePickerProps): React.ReactElement {
  return (
    <ListSection title={title} {...(footer ? { footer } : {})}>
      {RUN_PERMISSION_MODES.map((mode) =>
        mode === 'bypassPermissions' && !canBypass ? (
          <ListRow key={mode} kind="requires-admin" title={PERMISSION_MODE_LABEL[mode]} subtitle="Needs admin off this computer" onPress={() => router.push(scopeRequestHref([BYPASS_SCOPE], 'Run without approvals') as Href)} testID={`${testIDPrefix}-${mode}`} />
        ) : (
          <ListRow key={mode} kind="radio" title={PERMISSION_MODE_LABEL[mode]} subtitle={PERMISSION_MODE_DETAIL[mode]} selected={value === mode} onPress={() => onValueChange(mode)} testID={`${testIDPrefix}-${mode}`} />
        ),
      )}
    </ListSection>
  );
}
