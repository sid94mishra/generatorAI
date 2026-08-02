// ────────────────────────────────────────────────────────────────
// Settings → General section.
// The application-wide preferences tab: appearance (theme + accent),
// the default model for new chats, and an About card. These all apply
// instantly and persist on this device.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Sun, Moon, Monitor, Contrast } from 'lucide-react';
import { useTheme } from '@/providers/ThemeProvider.js';
import { ModelPicker } from '@/components/shared/ModelPicker.js';
import { cn } from '@/lib/utils.js';
import { ACCENTS, VISIBLE_THEMES, type ThemeDef } from '@generatorai/design-tokens';
import { getDefaultChatModel, setDefaultChatModel } from '@/lib/appPreferences.js';
import { SectionHeader, SettingsCard, SettingRow } from '../shared.js';

const THEME_ICONS: Record<ThemeDef['icon'], React.ReactNode> = {
  Sun: <Sun className="h-4 w-4" />,
  Moon: <Moon className="h-4 w-4" />,
  Monitor: <Monitor className="h-4 w-4" />,
  Contrast: <Contrast className="h-4 w-4" />,
};

export function GeneralSection() {
  const { theme, setTheme, resolvedTheme, accent, setAccent } = useTheme();
  const [defaultModel, setDefaultModel] = useState<string>(() => getDefaultChatModel());


  return (
    <div>
      <SectionHeader title="General" description="Application-wide preferences for GeneratorAI." />

      <div className="space-y-4">
        <SettingsCard title="Theme" description="Choose light, dark, or follow your system. Applies instantly.">
          <div className="flex flex-wrap gap-2">
            {VISIBLE_THEMES.map(({ id, label, icon }) => (
              <button
                key={id}
                onClick={() => setTheme(id as 'light' | 'dark' | 'system')}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors',
                  theme === id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-subtle',
                )}
                aria-pressed={theme === id}
              >
                {THEME_ICONS[icon]}
                {label}
              </button>
            ))}
          </div>
        </SettingsCard>

        <SettingsCard
          title="Accent color"
          description="Used for buttons, links, and highlights — status colors stay semantic."
        >
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Accent color">
            {ACCENTS.map((a) => {
              const swatch = a[resolvedTheme].primary;
              const selected = accent === a.id;
              return (
                <button
                  key={a.id}
                  role="radio"
                  aria-checked={selected}
                  aria-label={a.label}
                  title={a.label}
                  onClick={() => setAccent(a.id)}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                    selected
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-border text-muted-foreground hover:bg-subtle',
                  )}
                >
                  <span aria-hidden className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: swatch }} />
                  {a.label}
                </button>
              );
            })}
          </div>
        </SettingsCard>

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
            GitHub Copilot or the Claude Agent SDK. Supports multi-session workflow execution
            with real-time streaming.
          </p>
          <div className="mt-3 flex gap-3 text-xs text-muted-foreground">
            <span>Version 0.1.0</span>
            <span>•</span>
            <span>Node.js runtime</span>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}
