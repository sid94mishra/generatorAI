// New project (MProjectCreate; `/projects/new`, full-screen modal MD-21; header text confirm "Create", MD-85): name and
// description; Worktrees — retention (Immediate / 24 h / 72 h / Manual) and max codebases; Repositories — draft rows
// added from "+ Git remote / + Local git / + Local folder" (each opens the codebase form in a sheet; the default branch
// comes from the remote, MG-11). Create makes the project, then links each repository; remotes clone in the background.
import React, { useState } from 'react';
import { View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import type { CodebaseType, WorktreeRetentionPolicy } from '@generatorai/shared';

import { PROJECTS_HREF, projectHref } from '../../blocks/shell/hrefs';
import { FullScreenEditor } from '../../ui/layout/FullScreenEditor';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { useSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { Button } from '../../ui/primitives/Button';
import { Chip } from '../../ui/primitives/Chip';
import { Field } from '../../ui/primitives/Field';
import { Input } from '../../ui/primitives/Input';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';
import { toast } from '../../ui/primitives/Toast';
import { errorText } from '../../ui/lib/format';
import { CodebaseForm, FolderBrowser } from './components/CodebaseForm';
import {
  CODEBASE_KINDS,
  DEFAULT_MAX_CODEBASES,
  DEFAULT_RETENTION,
  EMPTY_CODEBASE_DRAFT,
  MAX_CODEBASES_LIMIT,
  RETENTION_OPTIONS,
  codebaseBodies,
  codebaseDraftError,
  codebaseLocation,
  codebaseTypeLabel,
  validateProjectName,
  type CodebaseDraft,
} from './model/projectsModel';
import { useCreateProject } from './queries';

type Href = Parameters<typeof router.replace>[0];

/** The repository form inside the imperative sheet; "Browse" swaps in the folder browser (one sheet, MD-62). */
function RepoDraftSheet({ initial, onAdd }: { initial: CodebaseDraft; onAdd: (d: CodebaseDraft) => void }): React.ReactElement {
  const [draft, setDraft] = useState(initial);
  const [browsing, setBrowsing] = useState(false);
  const [touched, setTouched] = useState(false);
  const error = codebaseDraftError(draft);
  if (browsing) {
    return (
      <FolderBrowser
        initial={draft.location}
        onChoose={(path) => {
          setDraft({ ...draft, location: path });
          setBrowsing(false);
        }}
      />
    );
  }
  return (
    <View className="gap-4 pb-4">
      <CodebaseForm draft={draft} onChange={setDraft} onBrowse={() => setBrowsing(true)} error={touched ? error : null} />
      <Button
        label="Add repository"
        variant="primary"
        size="lg"
        fullWidth
        onPress={() => {
          setTouched(true);
          if (!error) onAdd(draft);
        }}
        testID="repo-draft-add"
      />
    </View>
  );
}

export default function ProjectCreateScreen(): React.ReactElement {
  const navigation = useNavigation();
  const sheet = useSheet();
  const create = useCreateProject();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [retention, setRetention] = useState<WorktreeRetentionPolicy>(DEFAULT_RETENTION);
  const [maxCodebases, setMaxCodebases] = useState(DEFAULT_MAX_CODEBASES);
  const [repos, setRepos] = useState<CodebaseDraft[]>([]);
  const [touched, setTouched] = useState(false);
  const nameError = validateProjectName(name);
  const dirty = name.trim().length > 0 || description.trim().length > 0 || repos.length > 0;
  const aliases = codebaseBodies(repos).map((b) => b.alias);

  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(PROJECTS_HREF as Href);
  };
  const addRepo = (kind: CodebaseType): void =>
    sheet.present(
      <RepoDraftSheet
        initial={{ ...EMPTY_CODEBASE_DRAFT, kind }}
        onAdd={(draft) => {
          setRepos((prev) => [...prev, draft]);
          sheet.dismiss();
        }}
      />,
      { title: `Add ${codebaseTypeLabel(kind).toLowerCase()}`, detents: ['large'], scrollable: true },
    );
  const submit = (): void => {
    setTouched(true);
    if (nameError || repos.length > maxCodebases) return;
    create.mutate(
      { name, description, settings: { worktreeRetention: retention, maxCodebases }, codebases: repos },
      {
        onSuccess: ({ project, failed }) => {
          haptic('success');
          router.replace(projectHref(project.id) as Href);
          if (failed.length) toast({ kind: 'error', message: `Created ${project.name}, but ${failed.join(', ')} could not be added. Add ${failed.length === 1 ? 'it' : 'them'} from the project.` });
        },
        onError: (e) => toast({ kind: 'error', message: errorText(e) }),
      },
    );
  };
  const retentionHint = RETENTION_OPTIONS.find((o) => o.value === retention)!.hint;

  return (
    <FullScreenEditor
      title="New project"
      primary={{ label: 'Create', onPress: submit, loading: create.isPending, disabled: create.isPending }}
      onCancel={close}
      dirty={dirty && !create.isSuccess}
      navigation={navigation as never}
      testID="project-create"
    >
      <ListSection>
        <Field {...(touched && nameError ? { error: nameError } : {})}>
          <Input label="Name" value={name} onChangeText={setName} placeholder="payments-service" autoFocus testID="project-create-name" />
        </Field>
        <Textarea label="Description" value={description} onChangeText={setDescription} placeholder="What lives here" presentation="row" minRows={2} testID="project-create-description" />
      </ListSection>

      <ListSection title="Worktrees" footer={retentionHint}>
        <ListRow
          kind="segmented"
          title="Worktree retention"
          segmented={{ value: retention, onValueChange: (v) => setRetention(v as WorktreeRetentionPolicy), segments: RETENTION_OPTIONS.map((o) => ({ value: o.value, label: o.short })), testID: 'project-create-retention' }}
        />
        <ListRow kind="stepper" title="Max codebases" stepper={{ value: maxCodebases, onValueChange: setMaxCodebases, min: Math.max(1, repos.length), max: MAX_CODEBASES_LIMIT, testID: 'project-create-max' }} />
      </ListSection>

      <View className="gap-2">
        {repos.length ? (
          <ListSection title="Repositories" count={repos.length}>
            {repos.map((repo, i) => (
              <ListRow
                key={`${i}:${repo.location}`}
                kind="info"
                icon={repo.kind === 'git-remote' ? 'link' : 'folder-open'}
                title={aliases[i] ?? repo.alias}
                subtitle={`${codebaseLocation({ type: repo.kind, url: repo.location, localPath: repo.location })} · ${codebaseTypeLabel(repo.kind)}${repo.branch ? ` · branch ${repo.branch}` : ''}`}
                badge={<Button label="Remove" size="sm" variant="ghost" onPress={() => setRepos((prev) => prev.filter((_, j) => j !== i))} accessibilityLabel={`Remove ${aliases[i] ?? repo.alias}`} />}
              />
            ))}
          </ListSection>
        ) : (
          <Text role="footnote" weight={600} tone="fg-2" className="px-4">
            Repositories
          </Text>
        )}
        <View className="flex-row flex-wrap gap-2 px-4">
          {CODEBASE_KINDS.map((k) => (
            <Chip key={k.value} variant="add" label={k.label} icon="plus" onPress={() => addRepo(k.value)} testID={`project-create-add-${k.value}`} />
          ))}
        </View>
        <Text role="footnote" tone="fg-3" className="px-4">
          Remote repositories clone in the background after you create the project; progress shows in each codebase's Logs.
        </Text>
        {touched && repos.length > maxCodebases ? (
          <Text role="footnote" tone="err" className="px-4">
            {`More repositories than the codebase limit (${maxCodebases}).`}
          </Text>
        ) : null}
      </View>
    </FullScreenEditor>
  );
}
