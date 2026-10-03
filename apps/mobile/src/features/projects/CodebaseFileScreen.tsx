// A codebase file, full screen (`/projects/[id]/codebases/[cid]/file?path=`; MCodebaseFiles escalation): the
// read-only MB-26 body (wrap, pinch, markdown preview) over the checkout's content.
import React, { useMemo } from 'react';
import { useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';

import { FileContentView } from '../../blocks/FilePreview';
import { PROJECTS_HREF, codebaseFilesHref, projectHref } from '../../blocks/shell/hrefs';
import { useBreadcrumb, useHeaderBack } from '../../blocks/shell/useHeaderNav';
import { Screen } from '../../ui/layout/Screen';
import { Header } from '../../ui/native/router/Header';
import { codebaseFileContent } from './model/projectsModel';
import { useCodebaseFile, useProject } from './queries';

export default function CodebaseFileScreen(): React.ReactElement {
  const { id = '', cid = '', path = '' } = useLocalSearchParams<{ id: string; cid: string; path: string }>();
  const onBack = useHeaderBack();
  const project = useProject(id);
  const alias = project.data?.codebases.find((c) => c.id === cid)?.alias ?? 'Codebase';
  const file = useCodebaseFile(id, cid, path);
  const breadcrumb = useBreadcrumb(
    useMemo(() => [{ label: 'Projects', href: PROJECTS_HREF }, { label: project.data?.name ?? 'Project', href: projectHref(id) }, { label: alias, href: codebaseFilesHref(id, cid) }], [project.data?.name, alias, id, cid]),
  );
  const name = path.split('/').pop() || path;
  return (
    <Screen
      header={<Header role="detail" title={name} breadcrumb={breadcrumb} onBack={onBack} actions={[{ id: 'copy', icon: 'copy', label: 'Copy path', onPress: () => void Clipboard.setStringAsync(path) }]} />}
      scroll="none"
      testID="codebase-file"
    >
      <FileContentView path={path} file={{ ...file, data: file.data ? codebaseFileContent(file.data.content) : undefined }} />
    </Screen>
  );
}

