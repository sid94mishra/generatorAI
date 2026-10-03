// Settings › Skills (MSetSkills, MDF-109; `/settings/skills`): the built-in (system) skills with a per-device switch
// (MD-30 — a switched-off skill is not offered on this device; the server is unchanged), a search, "n of m enabled";
// a row tap expands its description with "Preview full details" (the skill's file in the sheet); both the switch and
// the expansion are accessibility actions. "Upload a project skill" points at Projects › Customization.
import React, { useDeferredValue, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import type { SystemArtifact } from '@generatorai/client-core';

import { AssistantText } from '../../blocks/AssistantText';
import { PROJECTS_HREF } from '../../blocks/shell/hrefs';
import { setSkillEnabled, useDisabledSkills } from '../../services/prefs/skillPrefs';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { useSheet } from '../../ui/native/Sheet';
import { Switch } from '../../ui/native/Switch';
import { Badge } from '../../ui/primitives/Badge';
import { Button } from '../../ui/primitives/Button';
import { EmptyState } from '../../ui/primitives/EmptyState';
import { ErrorState } from '../../ui/primitives/ErrorState';
import { Icon } from '../../ui/primitives/Icon';
import { Pressable } from '../../ui/primitives/Pressable';
import { SearchInput } from '../../ui/primitives/SearchInput';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { SettingsPage } from './components/SettingsPage';
import { useSystemArtifactContent, useSystemArtifacts } from './queries';

type Href = Parameters<typeof router.push>[0];

function SkillPreview({ skill }: { skill: SystemArtifact }): React.ReactElement {
  const content = useSystemArtifactContent(skill.id);
  if (content.isLoading) return <Skeleton preset="card" />;
  if (content.isError) return <ErrorState title="Couldn't read this skill" error={content.error} onRetry={() => void content.refetch()} />;
  return <AssistantText text={content.data?.content ?? skill.description ?? ''} testID="skill-preview-text" />;
}

function SkillRow({ skill, enabled, expanded, onToggle, onExpand, onPreview }: { skill: SystemArtifact; enabled: boolean; expanded: boolean; onToggle: (v: boolean) => void; onExpand: () => void; onPreview: () => void }): React.ReactElement {
  return (
    <View className={expanded ? 'bg-selected' : undefined}>
      <Pressable
        onPress={onExpand}
        frame="none"
        accessibilityRole="button"
        accessibilityLabel={`${skill.name}, system skill, ${enabled ? 'on' : 'off'}${skill.description ? `. ${skill.description}` : ''}`}
        accessibilityState={{ expanded }}
        accessibilityActions={[
          { name: 'toggle', label: enabled ? 'Turn off on this device' : 'Turn on on this device' },
          { name: 'activate', label: expanded ? 'Hide description' : 'Show description' },
        ]}
        onAccessibilityAction={(name) => (name === 'toggle' ? onToggle(!enabled) : onExpand())}
        className="min-h-row-2 flex-row items-center gap-3 px-4 py-3"
        testID={`settings-skill-${skill.id}`}
      >
        <Icon concept="skills" tone={enabled ? 'fg-2' : 'fg-3'} />
        <View className="min-w-0 flex-1 gap-0.5">
          <View className="flex-row items-center gap-1.5">
            <Text role="body" tone={enabled ? 'fg' : 'fg-3'} numberOfLines={1} className="shrink">
              {skill.name}
            </Text>
            <Badge label="System" size="sm" />
          </View>
          {skill.description ? (
            <Text role="footnote" tone="fg-3" numberOfLines={1}>
              {skill.description}
            </Text>
          ) : null}
        </View>
        <Switch value={enabled} onValueChange={onToggle} label={`${skill.name} on this device`} testID={`settings-skill-switch-${skill.id}`} />
      </Pressable>
      {expanded ? (
        <View className="gap-3 pb-3 pl-12 pr-4">
          <View className="gap-1 rounded-card bg-sunken p-3">
            <Text role="footnote" weight={600} tone="fg-2">
              Description
            </Text>
            <Text role="subhead">{skill.description || 'No description.'}</Text>
          </View>
          <View className="self-start">
            <Button label="Preview full details" icon="view" variant="secondary" size="sm" onPress={onPreview} testID={`settings-skill-preview-${skill.id}`} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export default function SkillsSettingsScreen(): React.ReactElement {
  const artifacts = useSystemArtifacts();
  const disabled = useDisabledSkills();
  const sheet = useSheet();
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const query = useDeferredValue(search).trim().toLowerCase();
  const skills = useMemo(() => (artifacts.data ?? []).filter((a) => a.type === 'skill'), [artifacts.data]);
  const list = useMemo(() => skills.filter((s) => !query || `${s.name} ${s.description ?? ''}`.toLowerCase().includes(query)), [skills, query]);
  const enabledCount = skills.filter((s) => !disabled.includes(s.id)).length;

  const preview = (skill: SystemArtifact): void => sheet.present(<SkillPreview skill={skill} />, { title: skill.name, subtitle: 'System skill', detents: ['medium', 'large'], scrollable: true, testID: 'skill-preview-sheet' });

  return (
    <SettingsPage
      title="Skills"
      intro="Built-in skills extend what agents can do. Skills you switch off aren't offered on this device."
      onRefresh={async () => void (await artifacts.refetch())}
      state={artifacts.isError && !artifacts.data ? { kind: 'error', error: artifacts.error, onRetry: () => void artifacts.refetch(), title: "Couldn't load skills" } : { kind: 'ready' }}
      testID="settings-skills-screen"
    >
      <View className="px-4">
        <SearchInput value={search} onChangeText={setSearch} placeholder="Search skills" testID="settings-skills-search" />
      </View>
      {artifacts.isLoading ? (
        <Skeleton preset="list" count={4} />
      ) : list.length === 0 ? (
        query ? <EmptyState compact icon="search" title="No matching skills" /> : <EmptyState compact copyKey="skills" />
      ) : (
        <ListSection title={`${enabledCount} of ${skills.length} enabled`} footer="Disabled skills aren't offered on this device.">
          {list.map((s) => (
            <SkillRow key={s.id} skill={s} enabled={!disabled.includes(s.id)} expanded={expanded === s.id} onToggle={(v) => setSkillEnabled(s.id, v)} onExpand={() => setExpanded((e) => (e === s.id ? null : s.id))} onPreview={() => preview(s)} />
          ))}
        </ListSection>
      )}
      <ListSection>
        <ListRow kind="navigation" icon="upload" title="Upload a project skill" subtitle="Project skills live in Projects › Customization" onPress={() => router.push(PROJECTS_HREF as Href)} testID="settings-skills-upload" />
      </ListSection>
    </SettingsPage>
  );
}
