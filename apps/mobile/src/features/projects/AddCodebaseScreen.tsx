// Add codebase (MAddCodebase; `/projects/[id]/add-codebase`, a route sheet at the large detent; MD-85: the form's
// action is the sheet footer's one `lg` primary): the codebase form; "Browse" turns the sheet into the server folder
// browser page (MD-62). A remote clones in the background (its Logs show progress).
import React, { useState } from 'react';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';

import { projectHref } from '../../blocks/shell/hrefs';
import { RouteSheet } from '../../ui/native/Sheet';
import { haptic } from '../../ui/platform/haptics';
import { Button } from '../../ui/primitives/Button';
import { toast } from '../../ui/primitives/Toast';
import { errorText } from '../../ui/lib/format';
import { CodebaseForm, FolderBrowser } from './components/CodebaseForm';
import { EMPTY_CODEBASE_DRAFT, codebaseBody, codebaseDraftError, type CodebaseDraft } from './model/projectsModel';
import { useLinkCodebase, useProject } from './queries';

type Href = Parameters<typeof router.replace>[0];

export default function AddCodebaseScreen(): React.ReactElement {
  const { id = '' } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const project = useProject(id);
  const link = useLinkCodebase(id);
  const [draft, setDraft] = useState<CodebaseDraft>(EMPTY_CODEBASE_DRAFT);
  const [page, setPage] = useState<'form' | 'browse'>('form');
  const [touched, setTouched] = useState(false);
  const error = codebaseDraftError(draft);
  const dirty = draft.location.trim().length > 0 || draft.alias.trim().length > 0;
  const max = project.data?.settings?.maxCodebases;
  const atLimit = typeof max === 'number' && (project.data?.codebases.length ?? 0) >= max;

  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(projectHref(id) as Href);
  };
  const submit = (): void => {
    setTouched(true);
    if (error || atLimit) return;
    const body = codebaseBody(draft, (project.data?.codebases ?? []).map((c) => c.alias));
    link.mutate(
      { ...body },
      {
        onSuccess: () => {
          haptic('success');
          close();
        },
        onError: (e) => toast({ kind: 'error', message: errorText(e) }),
      },
    );
  };

  if (page === 'browse') {
    return (
      <RouteSheet title="Server folder" back={{ label: 'Add codebase', onPress: () => setPage('form') }} onDismiss={close} scrollable navigation={navigation as never} testID="add-codebase-browse">
        <FolderBrowser
          initial={draft.location}
          onChoose={(path) => {
            setDraft({ ...draft, location: path });
            setPage('form');
          }}
        />
      </RouteSheet>
    );
  }
  return (
    <RouteSheet
      title="Add codebase"
      subtitle="Repositories are cloned under the project root. Every chat and run works in its own worktree."
      dirty={dirty && !link.isSuccess}
      onDismiss={close}
      scrollable
      navigation={navigation as never}
      footer={
        <Button
          label="Add codebase"
          variant="primary"
          size="lg"
          fullWidth
          loading={link.isPending}
          disabled={atLimit}
          {...(atLimit ? { disabledReason: `This project has reached its limit of ${max} codebases.` } : {})}
          onPress={submit}
          testID="add-codebase-submit"
        />
      }
      testID="add-codebase"
    >
      <CodebaseForm draft={draft} onChange={setDraft} onBrowse={() => setPage('browse')} error={touched ? error : null} />
    </RouteSheet>
  );
}
