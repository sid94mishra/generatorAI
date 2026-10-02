// The codebase form of MAddCodebase and MProjectCreate's repository rows: source (Git remote / Local git / Local
// folder), alias, the URL or the server path ("Browse" opens the server folder browser as a page of the same sheet,
// MD-62), the default branch — a Select of the remote's branches once MG-11 answers, else a text field — and the
// optional subdirectory.
import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ApiError } from '@generatorai/client-core';
import type { CodebaseType } from '@generatorai/shared';

import { ListRow } from '../../../ui/layout/ListRow';
import { ListSection } from '../../../ui/layout/ListSection';
import { Select } from '../../../ui/native/Select';
import { SegmentedControl } from '../../../ui/native/SegmentedControl';
import { Button } from '../../../ui/primitives/Button';
import { Callout } from '../../../ui/primitives/Callout';
import { ErrorState } from '../../../ui/primitives/ErrorState';
import { Field } from '../../../ui/primitives/Field';
import { Input } from '../../../ui/primitives/Input';
import { PermissionState } from '../../../ui/primitives/PermissionState';
import { Skeleton } from '../../../ui/primitives/Skeleton';
import { Text } from '../../../ui/primitives/Text';
import { CODEBASE_KINDS, defaultAlias, validateGitUrl, type CodebaseDraft } from '../model/projectsModel';
import { isForbidden, useRemoteRefs, useServerDirs } from '../queries';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The message for an MG-11 failure (the branch then falls back to a text field). */
export function remoteRefsProblem(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'This remote needs credentials the server does not have. Type the branch.';
    if (error.status === 404) return 'The server could not find this repository.';
    if (error.status === 504) return 'The remote did not answer in time. Type the branch.';
    if (error.status === 403) return 'This device cannot list remote branches. Type the branch.';
  }
  return 'Could not list the branches. Type the branch.';
}

function RemoteBranch({ draft, onChange }: { draft: CodebaseDraft; onChange: (d: CodebaseDraft) => void }): React.ReactElement {
  const url = useDebounced(draft.location.trim(), 500);
  const valid = url.length > 0 && validateGitUrl(url) === null;
  const refs = useRemoteRefs(url, valid);
  // The remote's default branch becomes the value once known, unless the user already chose one.
  useEffect(() => {
    if (refs.data?.defaultBranch && !draft.branch) onChange({ ...draft, branch: refs.data.defaultBranch });
  }, [refs.data, draft, onChange]);
  if (valid && refs.data && refs.data.branches.length > 0) {
    return (
      <Select
        label="Default branch"
        value={draft.branch || refs.data.defaultBranch || null}
        options={refs.data.branches.map((b) => ({ value: b, label: b, ...(b === refs.data!.defaultBranch ? { description: 'Default' } : {}) }))}
        onValueChange={(branch) => onChange({ ...draft, branch })}
        searchable={refs.data.branches.length > 20}
        presentation="field"
        testID="codebase-branch"
      />
    );
  }
  return (
    <Field {...(valid && refs.isError ? { help: remoteRefsProblem(refs.error) } : refs.isFetching ? { help: 'Reading the remote’s branches…' } : {})}>
      <Input label="Default branch" value={draft.branch} onChangeText={(branch) => onChange({ ...draft, branch })} placeholder="main" kind="mono" presentation="standalone" testID="codebase-branch" />
    </Field>
  );
}

export function FolderBrowser({ initial, onChoose }: { initial: string; onChoose: (path: string) => void }): React.ReactElement {
  const [path, setPath] = useState(initial);
  const dirs = useServerDirs(path, true);
  if (dirs.isLoading) return <Skeleton preset="list" count={6} />;
  if (dirs.isError) {
    return isForbidden(dirs.error) ? (
      <PermissionState kind="scope" status="missing-scope" scope="Browse server folders" />
    ) : (
      <ErrorState title="Couldn't read this folder" error={dirs.error} onRetry={() => void dirs.refetch()} />
    );
  }
  const data = dirs.data!;
  return (
    <View className="gap-3">
      <Text role="monoSm" tone="fg-2" selectable>
        {data.path || '/'}
      </Text>
      <ListSection>
        {data.parent !== null ? <ListRow kind="navigation" icon="back" title="Up one folder" onPress={() => setPath(data.parent ?? '')} /> : null}
        {(data.roots ?? []).length > 0 && !data.path
          ? data.roots!.map((root) => <ListRow key={root} kind="navigation" icon="folder-open" title={root} mono onPress={() => setPath(root)} />)
          : data.entries.map((entry) => (
              <ListRow key={entry.path} kind="navigation" icon={entry.isGit ? 'branch' : 'folder-open'} title={entry.name} mono {...(entry.isGit ? { value: 'git' } : {})} onPress={() => setPath(entry.path)} />
            ))}
      </ListSection>
      <Button label="Use this folder" variant="primary" size="lg" fullWidth disabled={!data.path} onPress={() => onChoose(data.path)} testID="folder-browser-choose" />
    </View>
  );
}

export interface CodebaseFormProps {
  draft: CodebaseDraft;
  onChange: (draft: CodebaseDraft) => void;
  /** Opens the folder browser page (the host decides how: a page of its sheet). */
  onBrowse: () => void;
  error?: string | null;
}

export function CodebaseForm({ draft, onChange, onBrowse, error }: CodebaseFormProps): React.ReactElement {
  const kind = CODEBASE_KINDS.find((k) => k.value === draft.kind)!;
  const remote = draft.kind === 'git-remote';
  return (
    <View className="gap-4">
      <View className="gap-2">
        <Text role="footnote" weight={600} tone="fg-2">
          Source
        </Text>
        <SegmentedControl<CodebaseType>
          accessibilityLabel="Source"
          value={draft.kind}
          onValueChange={(next) => onChange({ ...draft, kind: next, location: '', branch: '' })}
          segments={CODEBASE_KINDS.map((k) => ({ value: k.value, label: k.label }))}
          fullWidth
          testID="codebase-kind"
        />
        <Text role="footnote" tone="fg-3">
          {kind.hint}
        </Text>
      </View>
      <Input label="Alias" value={draft.alias} onChangeText={(alias) => onChange({ ...draft, alias })} placeholder={defaultAlias(draft.kind, draft.location) || 'payments-api'} presentation="standalone" testID="codebase-alias" />
      {remote ? (
        <Field {...(error ? { error } : {})}>
          <Input label="Repository URL" value={draft.location} onChangeText={(location) => onChange({ ...draft, location })} placeholder="https://github.com/acme/app.git" kind="url" presentation="standalone" testID="codebase-url" />
        </Field>
      ) : (
        <Field {...(error ? { error } : { help: 'A path on the machine running GeneratorAI.' })}>
          <Input
            label="Server path"
            value={draft.location}
            onChangeText={(location) => onChange({ ...draft, location })}
            placeholder="/srv/repos/app"
            kind="mono"
            presentation="standalone"
            trailing={<Button label="Browse" size="sm" variant="ghost" onPress={onBrowse} testID="codebase-browse" />}
            testID="codebase-path"
          />
        </Field>
      )}
      {remote ? <RemoteBranch draft={draft} onChange={onChange} /> : draft.kind === 'git-local' ? (
        <Input label="Default branch" value={draft.branch} onChangeText={(branch) => onChange({ ...draft, branch })} placeholder="main" kind="mono" presentation="standalone" testID="codebase-branch" />
      ) : null}
      <Input label="Subdirectory (optional)" value={draft.subdirectory} onChangeText={(subdirectory) => onChange({ ...draft, subdirectory })} placeholder="services/ledger" kind="mono" presentation="standalone" testID="codebase-subdirectory" />
      {remote ? <Callout tone="info" title="Cloning runs in the background; progress shows in the codebase's Logs." /> : null}
    </View>
  );
}
