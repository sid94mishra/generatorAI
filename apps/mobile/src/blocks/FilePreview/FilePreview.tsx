// MB-26 FilePreview (MPaneFilePreview): one file's current contents, read-only — the meta bar ("M · 71 lines · 2.1 KB ·
// TypeScript", Wrap, and Preview for markdown), then virtualised kit CodeLines with a single number gutter, changed
// lines marked with the start bar over `bg-add-bg` (from the file's diff against the session start), token colours
// (bounded), sideways scroll while unwrapped, pinch for the font size. Markdown can render (MB-10). Binary and
// over-budget files say so.
import React, { useMemo, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';

import { AssistantText } from '../AssistantText';
import { changeLetter, changeTone, formatBytes, type ChangeStatus } from '../ChangesPanel/model/changeKinds';
import { contentWidthFor, fontPinch, gutterWidthFor, languageForPath, parsePatch, setDiffWrap, useDiffPrefs, useFilePatch } from '../DiffView';
import { isMarkdownPath } from '../FileTree/model/fileTree';
import { useFileContent } from '../FileTree/FileTree.queries';
import { languageLabel } from '../../ui/lib/highlight';
import { LegendList } from '../../ui/lib/styled';
import { Chip } from '../../ui/primitives/Chip';
import { CodeLine, codeLineHeight } from '../../ui/primitives/CodeLine';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';

export interface FilePreviewProps {
  workspaceId: string;
  path: string;
  alias?: string;
  /** The file's change, when it has one (the changed-line bars come from its diff). */
  change?: { status: ChangeStatus; oldBlob?: string; newBlob?: string } | null;
  testID?: string;
}

/** A file's contents however it was read (a workspace mount, a codebase checkout). */
export interface FileContent {
  /** Null when the server would not send a file this large. */
  contents: string | null;
  size: number;
  isBinary?: boolean;
  lang?: string;
}

export interface FileContentViewProps {
  path: string;
  file: { data: FileContent | undefined; isLoading: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  /** Changed-line bars, and the change letter in the meta bar. */
  changed?: ReadonlySet<number>;
  change?: { status: ChangeStatus } | null;
  testID?: string;
}

/** New-side line numbers the diff added or changed. */
export function changedLines(patch: string | undefined): Set<number> {
  const out = new Set<number>();
  if (!patch) return out;
  for (const hunk of parsePatch(patch).hunks) for (const row of hunk.rows) if (row.kind === 'add' && row.newNumber !== undefined) out.add(row.newNumber);
  return out;
}

/** The read-only file body (MB-26) for any content source: meta bar, code lines or rendered markdown. */
export function FileContentView({ path, file, changed = NO_LINES, change = null, testID = 'file-preview' }: FileContentViewProps): React.ReactElement {
  const { width: viewport } = useWindowDimensions();
  const { wrap, fontSize } = useDiffPrefs();
  const [rendered, setRendered] = useState(true);
  const pinch = useMemo(() => fontPinch(), []);
  const markdown = isMarkdownPath(path);
  const contents = file.data?.contents ?? '';
  const lines = useMemo(() => contents.split('\n').map((text, i) => ({ key: String(i + 1), number: i + 1, text })), [contents]);
  const language = languageForPath(path, file.data?.lang);
  const gutter = gutterWidthFor(lines.length, fontSize);
  const longest = useMemo(() => lines.reduce((n, l) => Math.max(n, l.text.length), 0), [lines]);
  const width = contentWidthFor({ longest, gutter, fontSize, viewport });

  const meta = [file.data ? `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}` : null, file.data ? formatBytes(file.data.size) : null, language ? languageLabel(language) : null].filter(Boolean).join(' · ');
  const bar = (
    <View className="min-h-hit flex-row items-center gap-2 border-b border-line-soft px-4">
      {change ? (
        <Text role="mono" weight={600} tone={changeTone(change.status)}>
          {changeLetter(change.status)}
        </Text>
      ) : null}
      <Text role="monoSm" tone="fg-3" numberOfLines={1} className="flex-1">
        {meta}
      </Text>
      {markdown ? <Chip label="Preview" selected={rendered} onPress={() => setRendered((v) => !v)} testID="file-preview-rendered" /> : null}
      {!markdown || !rendered ? <Chip label="Wrap" icon="wrap" selected={wrap} onPress={() => setDiffWrap(!wrap)} testID="file-preview-wrap" /> : null}
    </View>
  );

  let body: React.ReactNode;
  if (file.isLoading) {
    body = (
      <View className="p-4" accessibilityLabel="Loading file">
        <Skeleton preset="list" count={8} />
      </View>
    );
  } else if (file.isError) {
    body = <ErrorState title="Couldn't read this file" error={file.error} onRetry={() => void file.refetch()} />;
  } else if (file.data?.isBinary) {
    body = <EmptyState icon="file" title="Binary file" description={`${formatBytes(file.data.size)}. There is no text to show.`} />;
  } else if (file.data && file.data.contents === null) {
    body = <EmptyState icon="file" title="Too large to show here" description={`${formatBytes(file.data.size)}. Open it on desktop.`} />;
  } else if (markdown && rendered) {
    body = (
      <ScrollView contentContainerClassName="p-4 pb-10">
        <AssistantText text={contents} />
      </ScrollView>
    );
  } else {
    const list = (
      <LegendList
        data={lines}
        keyExtractor={(l: { key: string; number: number; text: string }) => l.key}
        renderItem={({ item }: { item: { number: number; text: string } }) => (
          <CodeLine text={item.text} kind="plain" newNumber={item.number} gutterWidth={gutter} fontSize={fontSize} wrap={wrap} language={language} changed={changed.has(item.number)} />
        )}
        estimatedItemSize={codeLineHeight(fontSize)}
        extraData={`${fontSize}|${wrap}|${changed.size}`}
        recycleItems
        contentContainerClassName="pb-10 pt-1"
        className="flex-1"
      />
    );
    body = (
      <GestureDetector gesture={pinch}>
        <View className="flex-1">
          {wrap ? (
            list
          ) : (
            <ScrollView horizontal directionalLockEnabled contentContainerClassName="grow">
              <View className="flex-1" style={{ width }}>
                {list}
              </View>
            </ScrollView>
          )}
        </View>
      </GestureDetector>
    );
  }

  return (
    <View testID={testID} className="flex-1 bg-surface">
      {bar}
      {body}
    </View>
  );
}

const NO_LINES: ReadonlySet<number> = new Set();

export function FilePreview({ workspaceId, path, alias, change = null, testID = 'file-preview' }: FilePreviewProps): React.ReactElement {
  const file = useFileContent(workspaceId, path, alias);
  const patch = useFilePatch(workspaceId, { path, ...(alias ? { alias } : {}), ...(change?.oldBlob ? { oldBlob: change.oldBlob } : {}), ...(change?.newBlob ? { newBlob: change.newBlob } : {}) }, 'baseline', Boolean(change));
  const changed = useMemo(() => (change ? changedLines(patch.data?.patch) : NO_LINES), [change, patch.data?.patch]);
  return <FileContentView path={path} file={file} changed={changed} change={change} testID={testID} />;
}
