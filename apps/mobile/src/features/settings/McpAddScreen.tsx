// Add MCP server (MSetMcpAdd, MDF-110; `/settings/mcp/add[?project=<id>|?edit=<id>]`, full-screen modal with Cancel
// and a text "Add" / "Save", MD-85): name, transport Local / HTTP / SSE; Local: command + arguments (mono) and
// environment variables; HTTP / SSE: URL and headers — values are secret inputs written to the vault and never shown
// again (an edited server shows its stored keys with masked values; leaving one untouched keeps it); timeout in
// seconds. `?project=` adds the server to that project (Customization), `?edit=` replaces a custom server. Admin
// write: `admin:settings` + step-up. Dirty guard on Cancel / Back.
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';

import { projectTabHref, settingsHref } from '../../blocks/shell/hrefs';
import { FullScreenEditor } from '../../ui/layout/FullScreenEditor';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { haptic } from '../../ui/platform/haptics';
import { Field } from '../../ui/primitives/Field';
import { IconButton } from '../../ui/primitives/IconButton';
import { Input } from '../../ui/primitives/Input';
import { Text } from '../../ui/primitives/Text';
import type { McpEntryLike } from './mcpModel';
import { DEFAULT_MCP_TIMEOUT_S, EMPTY_MCP_DRAFT, hasErrors, mcpBody, mcpDraftDirty, validateMcpDraft, type McpDraft, type McpTransport } from './model/mcpForm';
import { useMcpServers, useMcpWrites } from './queries';
import { adminWrite } from './useSettingsAccess';

type Href = Parameters<typeof router.replace>[0];

const TRANSPORTS = [
  { value: 'stdio', label: 'Local' },
  { value: 'http', label: 'HTTP' },
  { value: 'sse', label: 'SSE' },
];

function draftFrom(server: McpEntryLike): McpDraft {
  const transport = server.serverType ?? (server.command ? 'stdio' : 'http');
  const map = transport === 'stdio' ? server.env : server.headers;
  return {
    name: server.name,
    transport,
    command: server.command ?? '',
    args: (server.args ?? []).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' '),
    url: server.url ?? '',
    pairs: Object.entries(map ?? {}).map(([key, value]) => ({ key, value })),
    timeout: server.timeoutMs ? String(Math.round(server.timeoutMs / 1000)) : '',
  };
}

export default function McpAddScreen(): React.ReactElement {
  const navigation = useNavigation();
  const { project, edit } = useLocalSearchParams<{ project?: string; edit?: string }>();
  const servers = useMcpServers();
  const editing = useMemo(() => (edit ? (servers.data ?? []).find((s) => s.id === edit && s.source === 'custom') : undefined), [edit, servers.data]);
  const initial = useMemo(() => (editing ? draftFrom(editing) : EMPTY_MCP_DRAFT), [editing]);
  const writes = useMcpWrites();
  const [draft, setDraft] = useState<McpDraft | null>(null);
  const d = draft ?? initial;
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const errors = validateMcpDraft(d);
  const set = (patch: Partial<McpDraft>): void => setDraft({ ...d, ...patch });
  const pairLabel = d.transport === 'stdio' ? 'Environment variables' : 'Headers';
  const dirty = editing ? JSON.stringify(d) !== JSON.stringify(initial) : mcpDraftDirty(d);

  const close = (): void => {
    if (router.canGoBack()) router.back();
    else router.replace((project ? projectTabHref(project, 'customization', 'kind=mcp') : settingsHref('mcp')) as Href);
  };
  const submit = (): void => {
    setTouched(true);
    if (hasErrors(errors)) return;
    const body = mcpBody(d);
    setSaving(true);
    const work = async (): Promise<true> => {
      if (editing?.id) await writes.updateCustom(editing.id, body);
      else if (project) await writes.addToProject(project, body);
      else await writes.addCustom(body);
      return true;
    };
    void adminWrite(editing ? `Save ${body.name}` : `Add the MCP server ${body.name}`, work)
      .then((done) => {
        if (!done) return;
        haptic('success');
        setDraft(null);
        close();
      })
      .finally(() => setSaving(false));
  };
  const err = (key: keyof typeof errors): { error: string } | Record<string, never> => (touched && errors[key] ? { error: errors[key]! } : {});

  return (
    <FullScreenEditor
      title={editing ? 'Edit server' : 'Add server'}
      primary={{ label: editing ? 'Save' : 'Add', onPress: submit, loading: saving, disabled: saving }}
      onCancel={close}
      dirty={dirty && !saving}
      navigation={navigation as never}
      testID="mcp-add-screen"
    >
      <ListSection title="Server" {...(project ? { footer: 'Added to this project only.' } : {})}>
        <Field {...err('name')}>
          <Input label="Server name" value={d.name} onChangeText={(name) => set({ name })} placeholder="docs-search" autoFocus={!editing} testID="mcp-add-name" />
        </Field>
        <ListRow kind="segmented" title="Transport" segmented={{ value: d.transport, onValueChange: (v) => set({ transport: v as McpTransport, pairs: [] }), segments: TRANSPORTS, testID: 'mcp-add-transport' }} />
      </ListSection>

      {d.transport === 'stdio' ? (
        <ListSection title="Local command">
          <Field {...err('command')}>
            <Input label="Command" kind="mono" value={d.command} onChangeText={(command) => set({ command })} placeholder="npx" testID="mcp-add-command" />
          </Field>
          <Input label="Arguments" kind="mono" value={d.args} onChangeText={(args) => set({ args })} placeholder="-y @modelcontextprotocol/server-filesystem" testID="mcp-add-args" />
        </ListSection>
      ) : (
        <ListSection title="Endpoint">
          <Field {...err('url')}>
            <Input label="URL" kind="url" value={d.url} onChangeText={(url) => set({ url })} placeholder="https://example.com/mcp" testID="mcp-add-url" />
          </Field>
        </ListSection>
      )}

      <View className="gap-2">
        <ListSection title={pairLabel} footer="Values are written to the secrets vault and never appear again in this form or in any response.">
          {d.pairs.map((p, i) => (
            <View key={i} className="flex-row items-center gap-2 pr-2">
              <View className="flex-1">
                <Input label="Key" kind="mono" value={p.key} onChangeText={(key) => set({ pairs: d.pairs.map((x, j) => (j === i ? { ...x, key } : x)) })} placeholder={d.transport === 'stdio' ? 'API_TOKEN' : 'Authorization'} testID={`mcp-add-key-${i}`} />
              </View>
              <View className="flex-1">
                <Input label="Value" kind="secret" value={p.value} onChangeText={(value) => set({ pairs: d.pairs.map((x, j) => (j === i ? { ...x, value } : x)) })} testID={`mcp-add-value-${i}`} />
              </View>
              <IconButton icon="x" label={`Remove ${p.key || 'variable'}`} onPress={() => set({ pairs: d.pairs.filter((_, j) => j !== i) })} />
            </View>
          ))}
          <ListRow kind="navigation" icon="plus" title={d.transport === 'stdio' ? 'Add variable' : 'Add header'} onPress={() => set({ pairs: [...d.pairs, { key: '', value: '' }] })} testID="mcp-add-pair" />
        </ListSection>
        {touched && errors.pairs ? (
          <Text role="footnote" tone="err" className="px-4">
            {errors.pairs}
          </Text>
        ) : null}
      </View>

      <ListSection title="Timeout" footer={`Default: ${DEFAULT_MCP_TIMEOUT_S} seconds (3 minutes).`}>
        <Field {...err('timeout')}>
          <Input label="Seconds" kind="number" value={d.timeout} onChangeText={(timeout) => set({ timeout })} placeholder={String(DEFAULT_MCP_TIMEOUT_S)} testID="mcp-add-timeout" />
        </Field>
      </ListSection>

      {edit && !editing && !servers.isLoading ? (
        <Text role="footnote" tone="fg-3" className="px-4">
          Only custom servers can be edited here; this form adds a new one.
        </Text>
      ) : null}
    </FullScreenEditor>
  );
}
