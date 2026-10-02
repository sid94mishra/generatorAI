// MB-05 CapabilityEditor (MAgentPickerCaps): "Adds to <agent>'s own, for this chat only." Nav rows to the Skills /
// MCP servers checklists and Extra instructions, then the 8 capabilities as switch rows; a row that differs from the
// agent shows "Changed ↶" (tap resets it). Only what `AgentOverrides` supports is editable; the overrides are
// applied at create and frozen at session start (NG-05).
import React from 'react';
import { View } from 'react-native';
import type { AgentToolPolicy } from '@generatorai/shared';

import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { Chip } from '../../ui/primitives/Chip';
import { Text } from '../../ui/primitives/Text';
import { Textarea } from '../../ui/primitives/Textarea';

export interface CapabilityRow {
  key: keyof AgentToolPolicy;
  label: string;
  /** Effective value for this chat. */
  value: boolean;
  /** Differs from the agent's own. */
  changed: boolean;
}

export interface CapabilityEditorProps {
  agentName: string;
  rows: ReadonlyArray<CapabilityRow>;
  onToggle: (key: keyof AgentToolPolicy, value: boolean) => void;
  onReset: (key: keyof AgentToolPolicy) => void;
  skills: { on: number; total: number | null; summary: string };
  mcp: { on: number; total: number | null; summary: string };
  instructions: string;
  onOpen: (page: 'skills' | 'mcp' | 'instructions') => void;
}

export function CapabilityEditor({ agentName, rows, onToggle, onReset, skills, mcp, instructions, onOpen }: CapabilityEditorProps): React.ReactElement {
  const on = rows.filter((r) => r.value).length;
  return (
    <View className="gap-3">
      <Text role="footnote" tone="fg-3">{`Adds to ${agentName}’s own, for this chat only.`}</Text>
      <ListSection>
        <ListRow kind="navigation" icon="skills" title="Skills" subtitle={skills.summary} value={skills.total !== null ? `${skills.on}/${skills.total}` : String(skills.on)} mono onPress={() => onOpen('skills')} testID="caps-skills" />
        <ListRow kind="navigation" icon="mcp" title="MCP servers" subtitle={mcp.summary} value={mcp.total !== null ? `${mcp.on}/${mcp.total}` : String(mcp.on)} mono onPress={() => onOpen('mcp')} testID="caps-mcp" />
        <ListRow kind="navigation" icon="file-text" title="Extra instructions" subtitle={`Appended after ${agentName}’s own`} value={instructions.trim() ? 'Set' : 'None'} onPress={() => onOpen('instructions')} testID="caps-instructions" />
      </ListSection>
      <ListSection title="Capabilities" count={on}>
        {rows.map((row) => (
          <ListRow
            key={row.key}
            kind="toggle"
            title={row.label}
            switchValue={row.value}
            onValueChange={(v) => onToggle(row.key, v)}
            {...(row.changed ? { provenance: <Chip variant="filter" label="Changed" icon="undo" onPress={() => onReset(row.key)} /> } : {})}
            testID={`caps-tool-${row.key}`}
          />
        ))}
      </ListSection>
    </View>
  );
}

/** A Skills / MCP checklist page: on = effective for this chat. */
export function CapabilityChecklist({ items, onToggle }: { items: ReadonlyArray<{ id: string; label: string; description?: string; on: boolean; fromAgent: boolean }>; onToggle: (id: string, on: boolean) => void }): React.ReactElement {
  return (
    <ListSection>
      {items.map((item) => (
        <ListRow key={item.id} kind="check" title={item.label} subtitle={item.fromAgent ? `From the agent${item.description ? ` · ${item.description}` : ''}` : item.description} selected={item.on} onValueChange={(v) => onToggle(item.id, v)} onPress={() => onToggle(item.id, !item.on)} />
      ))}
    </ListSection>
  );
}

export function InstructionsEditor({ agentName, value, onChange }: { agentName: string; value: string; onChange: (v: string) => void }): React.ReactElement {
  return <Textarea label="Extra instructions" value={value} onChangeText={onChange} placeholder={`Appended after ${agentName}’s own instructions`} minRows={6} testID="caps-instructions-text" />;
}
