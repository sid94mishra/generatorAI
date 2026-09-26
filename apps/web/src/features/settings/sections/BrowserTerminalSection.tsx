// ────────────────────────────────────────────────────────────────
// F-settings-10 Browser & terminal (04 §3.1; content reference
// MSetBrowserTerminal). Integrated-browser interactivity (web only, applies
// live via a storage event) and integrated-terminal spawn preferences
// (applied the next time a terminal tab is opened). Everything here is
// device-local (localStorage) — nothing round-trips to the server.
// ────────────────────────────────────────────────────────────────

import { useState } from 'react';
import { isDesktop } from '@/lib/desktop.js';
import { setWebBrowserInteractivity, useWebBrowserInteractivity } from '@/lib/browserInteractivity.js';
import { useHealth } from '@/hooks/queries.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { SettingRow, SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';

const TERMINAL_SHELL_KEY = 'generatorai:terminal:shell';
const TERMINAL_ALLOW_SECRETS_KEY = 'generatorai:terminal:allowSecrets';
const TERMINAL_LOAD_PWSH_PROFILE_KEY = 'generatorai:terminal:loadPwshProfile';

function readLs(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}
function writeLs(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export function BrowserTerminalSection() {
  const browserOn = useWebBrowserInteractivity();
  const { data: health } = useHealth();
  // The terminal runs on the SERVER host, not this browser — in remote mode
  // they are different machines, so the Windows-only row keys off the
  // server's platform, never `navigator.userAgent`.
  const isWindows = health?.platform === 'win32';

  const [shell, setShell] = useState(() => readLs(TERMINAL_SHELL_KEY));
  const [allowSecrets, setAllowSecrets] = useState(() => readLs(TERMINAL_ALLOW_SECRETS_KEY) === '1');
  const [loadPwshProfile, setLoadPwshProfile] = useState(() => readLs(TERMINAL_LOAD_PWSH_PROFILE_KEY) === '1');

  return (
    <SettingsSection title="Browser & terminal" description="Preferences for the integrated browser and terminal panels.">
      <div className="flex flex-col">
        <SettingRow
          label="Allow full browser interaction"
          hint={
            isDesktop
              ? 'The desktop app always runs the browser at full interactivity.'
              : 'When off, only the agent drives the page — you can still watch it and pick elements via Inspect. Off by default for performance.'
          }
          control={
            <Switch
              aria-label="Allow full browser interaction"
              checked={browserOn}
              disabled={isDesktop}
              onCheckedChange={(next) => setWebBrowserInteractivity(next)}
            />
          }
        />

        <SettingRow
          label="Default shell"
          hint="Blank uses the platform default. Applies the next time a terminal tab is opened."
          control={
            <Input
              mono
              aria-label="Default shell"
              value={shell}
              onChange={(e) => {
                setShell(e.target.value);
                writeLs(TERMINAL_SHELL_KEY, e.target.value);
              }}
              placeholder={isWindows ? 'pwsh.exe' : '/bin/bash'}
              className="w-56"
            />
          }
        />

        {/* PowerShell is the default shell only on Windows; elsewhere this
            row would be a setting for a shell that never gets spawned. */}
        {isWindows ? (
          <SettingRow
            label="Load PowerShell profile"
            hint="When on, pwsh runs $PROFILE at startup. Off speeds up spawn by ~1–2 seconds."
            control={
              <Switch
                aria-label="Load PowerShell profile"
                checked={loadPwshProfile}
                onCheckedChange={(next) => {
                  setLoadPwshProfile(next);
                  writeLs(TERMINAL_LOAD_PWSH_PROFILE_KEY, next ? '1' : '0');
                }}
              />
            }
          />
        ) : null}

        <SettingRow
          label="Allow SSH_AUTH_SOCK / AWS session tokens"
          hint="Inherit sensitive env vars from the server process. Only enable on a trusted host."
          control={
            <Switch
              aria-label="Allow SSH_AUTH_SOCK / AWS session tokens"
              checked={allowSecrets}
              onCheckedChange={(next) => {
                setAllowSecrets(next);
                writeLs(TERMINAL_ALLOW_SECRETS_KEY, next ? '1' : '0');
              }}
            />
          }
        />
      </div>
    </SettingsSection>
  );
}
