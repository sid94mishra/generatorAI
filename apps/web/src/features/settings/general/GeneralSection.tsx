// ────────────────────────────────────────────────────────────────
// F-settings-02 General (04 §3.1). Application-wide preferences that are not
// about how the app LOOKS — that moved to Appearance once there were enough
// themes for a live-preview grid.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { ModelPicker } from '@/blocks/model-picker/index.js';
import { getDefaultChatModel, setDefaultChatModel } from '@/lib/appPreferences.js';
import { KeyValueList } from '@/ui/patterns/KeyValueList/KeyValueList.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { SettingRow, SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';

export function GeneralSection() {
  const [defaultModel, setDefaultModel] = useState<string>(() => getDefaultChatModel());

  return (
    <SettingsSection title="General" description="Application-wide preferences for GeneratorAI.">
      <div className="flex flex-col">
        <SettingRow
          label="Default model for new chats"
          hint="Pre-selects this model when you create a chat. You can still change it per chat."
          control={
            <div className="w-64">
              <ModelPicker
                value={defaultModel}
                onChange={(v) => {
                  setDefaultModel(v);
                  setDefaultChatModel(v);
                }}
                variant="field"
                ariaLabel="Default chat model"
              />
            </div>
          }
        />
      </div>

      <div className="flex flex-col gap-3">
        <SectionHeader title="About GeneratorAI" level={3} />
        <p className="text-small text-fg-3">
          An autonomous AI agent platform with a provider-agnostic harness — run agents on GitHub Copilot, Claude Code,
          Codex and more, side by side. Supports multi-session workflow execution with real-time streaming.
        </p>
        <KeyValueList
          labelWidth={64}
          items={[
            { label: 'Version', value: __APP_VERSION__ },
            { label: 'Runtime', value: 'Node.js' },
          ]}
        />
      </div>
    </SettingsSection>
  );
}
