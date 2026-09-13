// ────────────────────────────────────────────────────────────────
// Settings → General.
//
// Application-wide preferences that are not about how the app LOOKS. Theme,
// mode and accent moved to their own section (`Appearance.tsx`) once there
// were six themes to choose between and a two-line picker had become a grid
// of live previews.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { ModelPicker } from '@/components/shared/ModelPicker.js';
import { getDefaultChatModel, setDefaultChatModel } from '@/lib/appPreferences.js';
import { SectionHeader, SettingsCard, SettingRow } from '../shared.js';

export function GeneralSection() {
  const [defaultModel, setDefaultModel] = useState<string>(() => getDefaultChatModel());

  return (
    <div>
      <SectionHeader title="General" description="Application-wide preferences for GeneratorAI." />

      <div className="space-y-4">
        <SettingsCard
          title="Default model for new chats"
          description="Pre-selects this model when you create a chat. You can still change it per chat."
        >
          <SettingRow
            label="Model"
            description="Pick any model from the active provider's catalog."
            control={
              <ModelPicker
                value={defaultModel}
                onChange={(v) => {
                  setDefaultModel(v);
                  setDefaultChatModel(v);
                }}
                placeholder="Select a model…"
                align="end"
                ariaLabel="Default chat model"
                className="w-56"
              />
            }
          />
        </SettingsCard>

        <SettingsCard title="About GeneratorAI">
          <p className="text-xs text-muted-foreground">
            An autonomous AI agent platform with a provider-agnostic harness — run agents on
            GitHub Copilot, Claude Code, Codex and more, side by side. Supports multi-session
            workflow execution with real-time streaming.
          </p>
          <div className="mt-3 flex gap-3 text-xs text-muted-foreground">
            <span>Version {__APP_VERSION__}</span>
            <span>•</span>
            <span>Node.js runtime</span>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}
