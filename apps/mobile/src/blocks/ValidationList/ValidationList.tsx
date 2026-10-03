// MB-37 ValidationList (03 MB-37; MWorkflowValidate): the validation result as a sheet body — the headline with "Check
// again", the banner "Publish and Run are blocked until the errors are fixed. Save still works." (a warn Callout, only
// with errors), then one row per issue, errors first: the glyph + word (error / warning), the stage it belongs to,
// the code (mono), the message and its hint, and "Go to". "Fix" is not drawn: quick-fix payloads do not exist yet
// (MG-33).
import React from 'react';
import { View } from 'react-native';
import type { ValidationIssue } from '@generatorai/workflow-spec';

import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { Icon } from '../../ui/primitives/Icon';
import { IconButton } from '../../ui/primitives/IconButton';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { issueStageKey, sortIssues, validationHeadline } from './validationModel';

export interface ValidationListProps {
  issues: readonly ValidationIssue[] | null;
  loading: boolean;
  /** "checked 14:07". */
  checkedAt?: number | null;
  stageKeys: readonly string[];
  stageName: (key: string) => string;
  onRecheck: () => void;
  onGoTo?: (stageKey: string) => void;
  error?: string | null;
  testID?: string;
}

const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

export function ValidationList({ issues, loading, checkedAt, stageKeys, stageName, onRecheck, onGoTo, error, testID = 'validation-list' }: ValidationListProps): React.ReactElement {
  const list = sortIssues(issues ?? []);
  const errors = list.filter((i) => i.severity === 'error').length;
  return (
    <View className="gap-3 pb-4" testID={testID}>
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Text role="headline" weight={600}>
            {loading && !issues ? 'Checking…' : issues ? validationHeadline(list) : 'Not checked'}
          </Text>
          {checkedAt ? (
            <Text role="footnote" tone="fg-3">{`checked ${clock.format(checkedAt)}`}</Text>
          ) : null}
        </View>
        <IconButton icon="refresh" label="Check again" onPress={onRecheck} disabled={loading} testID="validation-recheck" />
      </View>
      {error ? <Callout tone="err" title="Couldn't validate" body={error} /> : null}
      {errors ? <Callout tone="warn" title="Publish and Run are blocked until the errors are fixed." body="Save still works." /> : null}
      {loading && !issues ? <Skeleton preset="list" count={3} /> : null}
      {issues && !list.length ? (
        <View className="flex-row items-center gap-2">
          <Icon concept="status-succeeded" size={16} tone="ok" />
          <Text role="body">No problems found.</Text>
        </View>
      ) : null}
      {list.map((issue, i) => {
        const key = issueStageKey(issue, stageKeys);
        const isError = issue.severity === 'error';
        return (
          <View key={`${issue.code}-${issue.path}-${i}`} className="flex-row gap-3 border-b border-line-soft pb-3" testID={`validation-issue-${i}`}>
            <Icon concept={isError ? 'status-failed' : 'warning'} size={18} tone={isError ? 'err' : 'warn'} accessibilityLabel={isError ? 'Error' : 'Warning'} />
            <View className="flex-1 gap-1">
              <Text role="subhead" weight={600}>
                {key ? stageName(key) : 'Workflow'}
              </Text>
              <View className="flex-row flex-wrap items-center gap-1.5">
                <Badge label={issue.code} mono size="sm" />
                <Text role="caption" tone={isError ? 'err' : 'warn'}>
                  {isError ? 'error' : 'warning'}
                </Text>
              </View>
              <Text role="footnote" selectable>
                {issue.message}
              </Text>
              {issue.hint ? (
                <Text role="footnote" tone="fg-3">
                  {issue.hint}
                </Text>
              ) : null}
            </View>
            {key && onGoTo ? <Button label="Go to" size="sm" onPress={() => onGoTo(key)} testID={`validation-goto-${i}`} /> : null}
          </View>
        );
      })}
    </View>
  );
}
