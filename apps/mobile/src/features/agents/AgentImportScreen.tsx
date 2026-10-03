// Import agent (MAgentImport; `/agents/import`, a route sheet; footer `lg` "Import", MD-85): pick an `.agent.md`
// (expo-file-system's picker, ≤ 256 KB); the dry-run preview from MG-12 — name, role, model · effort, instruction size,
// skills · MCP, the instructions' opening lines — and its warnings; Import to Global / Project; "Replace existing
// <name>" only when an agent with that ref exists (`global:x` vN becomes vN+1; bound chats keep their snapshot).
import React, { useState } from 'react';
import { View } from 'react-native';
import { ApiError } from '@generatorai/client-core';
import { router, useNavigation } from 'expo-router';

import { AGENTS_HREF, agentHref } from '../../blocks/shell/hrefs';
import { pickTextFile, type PickedTextFile } from '../../services/native/pickTextFile';
import { KeyValueList } from '../../ui/layout/KeyValueList';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { errorText, formatBytes } from '../../ui/lib/format';
import { RouteSheet } from '../../ui/native/Sheet';
import { SegmentedControl } from '../../ui/native/SegmentedControl';
import { Select } from '../../ui/native/Select';
import { haptic } from '../../ui/platform/haptics';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { Card } from '../../ui/primitives/Card';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { toast } from '../../ui/primitives/Toast';
import { ROLE_LABEL } from './model/agentsModel';
import { useAgentWrites, useImportPreview, useProjectsForAgents } from './queries';

type Href = Parameters<typeof router.replace>[0];
const MAX_BYTES = 256 * 1024;

export default function AgentImportScreen(): React.ReactElement {
  const navigation = useNavigation();
  const writes = useAgentWrites();
  const projects = useProjectsForAgents();
  const [file, setFile] = useState<PickedTextFile | null>(null);
  const [scope, setScope] = useState<'global' | 'project'>('global');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const ready = file !== null && (scope === 'global' || projectId !== null);
  const preview = useImportPreview(ready ? { markdown: file!.text, scope, ...(projectId && scope === 'project' ? { projectId } : {}) } : null);
  const p = preview.data;
  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace(AGENTS_HREF as Href);
  };
  const pick = async (): Promise<void> => {
    const r = await pickTextFile(MAX_BYTES);
    if (r.status === 'picked') {
      setFile(r.file);
      setOverwrite(false);
    } else if (r.status === 'too-large') toast({ kind: 'error', message: `${r.name} is ${formatBytes(r.size)}; the limit is 256 KB.` });
    else if (r.status === 'error') toast({ kind: 'error', message: r.reason });
  };
  const submit = (): void => {
    if (!file) return;
    setBusy(true);
    writes
      .import({ markdown: file.text, scope, ...(scope === 'project' && projectId ? { projectId } : {}), overwrite })
      .then((agent) => {
        haptic('success');
        router.replace(agentHref(agent.id) as Href);
      })
      .catch((e: unknown) => toast({ kind: 'error', message: e instanceof ApiError && e.status === 409 ? 'An agent with this slug already exists. Turn on Replace to update it.' : errorText(e) }))
      .finally(() => setBusy(false));
  };
  const parseError = preview.error instanceof ApiError && (preview.error.status === 400 || preview.error.status === 413) ? errorText(preview.error) : null;
  const blocked = !p || Boolean(p.conflict && !overwrite);

  return (
    <RouteSheet
      title="Import agent"
      onDismiss={close}
      scrollable
      navigation={navigation as never}
      footer={<Button label="Import" variant="primary" size="lg" fullWidth loading={busy} disabled={blocked} {...(p?.conflict && !overwrite ? { disabledReason: `Turn on Replace to update ${p.conflict.name}.` } : {})} onPress={submit} testID="agent-import-submit" />}
      testID="agent-import"
    >
      <View className="gap-4">
        <ListSection>
          <ListRow
            kind="navigation"
            icon="file-text"
            title={file?.name ?? 'Choose an .agent.md file'}
            subtitle={file ? `${formatBytes(file.size)} · max 256 KB` : 'A credential-free agent definition, up to 256 KB'}
            value={file ? 'Change' : undefined}
            onPress={() => void pick()}
            testID="agent-import-file"
          />
        </ListSection>
        {file && preview.isLoading ? <Skeleton preset="card" /> : null}
        {parseError ? <Callout tone="err" title="This file can't be imported" body={parseError} /> : null}
        {p ? (
          <View className="gap-3">
            <Text role="subhead" weight={600} className="px-4">
              Parsed from the file
            </Text>
            <View className="px-4">
              <Card radius="group">
                <KeyValueList
                  items={[
                    { label: 'Name', value: p.parsed.name },
                    { label: 'Role', value: <Badge label={ROLE_LABEL[p.parsed.role]} size="sm" /> },
                    ...(p.parsed.model ? [{ label: 'Model', value: [p.parsed.model, p.parsed.effort].filter(Boolean).join(' · '), mono: true }] : []),
                    { label: 'Instructions', value: formatBytes(p.parsed.instructionsBytes), mono: true },
                    ...(p.parsed.skills.length || p.parsed.mcp.length ? [{ label: 'Skills · MCP', value: [...p.parsed.skills, ...p.parsed.mcp].join(' · ') }] : []),
                    ...(p.parsed.team.length ? [{ label: 'Team', value: p.parsed.team.join(', '), mono: true }] : []),
                  ]}
                />
              </Card>
            </View>
            {p.parsed.instructionsExcerpt ? (
              <View className="mx-4 rounded-card bg-sunken p-3">
                <Text role="monoSm" tone="fg-2" numberOfLines={6}>
                  {p.parsed.instructionsExcerpt}
                </Text>
              </View>
            ) : null}
            {p.warnings.map((w, i) => (
              <View key={i} className="px-4">
                <Callout tone="warn" title={w.message} />
              </View>
            ))}
          </View>
        ) : null}
        <View className="gap-2 px-4">
          <Text role="subhead" weight={600}>
            Import to
          </Text>
          <SegmentedControl<'global' | 'project'>
            accessibilityLabel="Import to"
            value={scope}
            onValueChange={(s) => {
              setScope(s);
              setOverwrite(false);
            }}
            segments={[
              { value: 'global', label: 'Global', icon: 'link' },
              { value: 'project', label: 'Project', icon: 'folder-open' },
            ]}
            fullWidth
            testID="agent-import-scope"
          />
          {scope === 'project' ? (
            <Select
              label="Project"
              value={projectId}
              placeholder="Choose a project"
              options={(projects.data ?? []).filter((x) => x.status !== 'archived').map((x) => ({ value: x.id, label: x.name }))}
              onValueChange={setProjectId}
              presentation="field"
              testID="agent-import-project"
            />
          ) : null}
        </View>
        {p?.conflict ? (
          <ListSection>
            <ListRow
              kind="toggle"
              icon="warning"
              title={`Replace existing ${p.conflict.name}`}
              subtitle={`${p.conflict.ref} v${p.conflict.version} becomes v${p.conflict.version + 1}. Chats and stages bound to it keep their snapshot.`}
              switchValue={overwrite}
              onValueChange={setOverwrite}
              testID="agent-import-replace"
            />
          </ListSection>
        ) : null}
        <Text role="footnote" tone="fg-3" className="px-4">
          Export shares a credential-free .agent.md through the share sheet.
        </Text>
      </View>
    </RouteSheet>
  );
}
