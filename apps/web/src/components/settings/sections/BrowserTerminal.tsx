// ────────────────────────────────────────────────────────────────
// Settings → Browser & Terminal section.
// Integrated-browser interactivity (web-only, applies live via a
// storage event) and integrated-terminal spawn preferences (applied
// the next time a terminal tab is opened).
// ────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from 'react';
import { getWebBrowserInteractivity, setWebBrowserInteractivity } from '@/components/chat/BrowserPanel.js';
import { Input, ToggleSwitch } from '@/components/ui/index.js';
import { SectionHeader, SettingsCard } from '../shared.js';

const TERMINAL_SHELL_KEY = 'generatorai:terminal:shell';
const TERMINAL_ALLOW_SECRETS_KEY = 'generatorai:terminal:allowSecrets';
const TERMINAL_LOAD_PWSH_PROFILE_KEY = 'generatorai:terminal:loadPwshProfile';

function readLs(key: string, fallback = ''): string {
  try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writeLs(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* ignore */ }
}

export function BrowserTerminalSection() {
  const isDesktop = typeof window !== 'undefined' && !!window.generatoraiDesktop?.isDesktop;

  // ── Browser interactivity ──
  const [browserOn, setBrowserOn] = useState<boolean>(() => getWebBrowserInteractivity());
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.storageArea && e.storageArea !== window.localStorage) return;
      if (e.key === 'generatorai:browser:webInteractivity' || e.key == null) {
        setBrowserOn(getWebBrowserInteractivity());
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);
  const toggleBrowser = useCallback((next: boolean) => {
    if (isDesktop) return;
    setWebBrowserInteractivity(next);
    setBrowserOn(next);
  }, [isDesktop]);

  // ── Terminal preferences ──
  const [shell, setShell] = useState<string>(() => readLs(TERMINAL_SHELL_KEY));
  const [allowSecrets, setAllowSecrets] = useState<boolean>(() => readLs(TERMINAL_ALLOW_SECRETS_KEY) === '1');
  const [loadPwshProfile, setLoadPwshProfile] = useState<boolean>(() => readLs(TERMINAL_LOAD_PWSH_PROFILE_KEY) === '1');

  const isWindows = typeof navigator !== 'undefined' && navigator.userAgent.includes('Windows');

  return (
    <div>
      <SectionHeader
        title="Browser & Terminal"
        description="Preferences for the integrated browser and terminal panels."
      />

      <div className="space-y-4">
        <SettingsCard
          title="Integrated Browser"
          description={
            isDesktop
              ? 'The desktop app always runs the browser at full interactivity.'
              : 'When off, only the agent drives the page — you can still watch it and pick elements via Inspect. Off by default in the web UI for performance.'
          }
        >
          <ToggleSwitch
            checked={browserOn}
            onChange={toggleBrowser}
            disabled={isDesktop}
            label="Allow full browser interaction (web UI only)"
            description="Drive the shared browser session — navigate, click, and type from the Browser panel."
          />
        </SettingsCard>

        <SettingsCard
          title="Integrated Terminal"
          description="Changes apply the next time you open a terminal tab."
        >
          <div className="mb-4 space-y-1.5">
            <label className="block text-xs font-medium text-foreground">
              Default shell <span className="text-muted-foreground">(blank = platform default)</span>
            </label>
            <Input
              type="text"
              value={shell}
              onChange={(e) => { setShell(e.target.value); writeLs(TERMINAL_SHELL_KEY, e.target.value); }}
              placeholder={isWindows ? 'pwsh.exe' : '/bin/bash'}
              className="max-w-md font-mono text-xs"
            />
          </div>
          <div className="space-y-3">
            <ToggleSwitch
              checked={loadPwshProfile}
              onChange={(next) => { setLoadPwshProfile(next); writeLs(TERMINAL_LOAD_PWSH_PROFILE_KEY, next ? '1' : '0'); }}
              label="Load PowerShell profile"
              description="When on, pwsh runs $PROFILE at startup. Off speeds up spawn by ~1–2 seconds."
            />
            <ToggleSwitch
              checked={allowSecrets}
              onChange={(next) => { setAllowSecrets(next); writeLs(TERMINAL_ALLOW_SECRETS_KEY, next ? '1' : '0'); }}
              label="Allow SSH_AUTH_SOCK / AWS session tokens"
              description="Inherit sensitive env vars from the server process. Only enable on a trusted host."
            />
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}
