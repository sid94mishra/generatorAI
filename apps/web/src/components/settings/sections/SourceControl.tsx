// ────────────────────────────────────────────────────────────────
// Settings → Source Control section.
// GitHub provider + token/host, stored server-side. Takes effect
// immediately for new PR / source-control operations.
// ────────────────────────────────────────────────────────────────

import React, { useState, useEffect, useCallback } from 'react';
import { GitPullRequest, Github, CheckCircle2, XCircle } from 'lucide-react';
import {
  useSourceControlConfig, useUpdateSourceControlConfig, useSourceControlStatus,
} from '@/hooks/queries.js';
import { Button, Input, Spinner, Select } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';
import { SectionHeader, SettingsCard } from '../shared.js';

export function SourceControlSection() {
  const { data: config, isLoading } = useSourceControlConfig();
  const status = useSourceControlStatus();
  const update = useUpdateSourceControlConfig();

  const [provider, setProvider] = useState<'github' | 'none'>('none');
  const [token, setToken] = useState('');
  const [host, setHost] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) {
      setProvider(config.activeProvider);
      setHost(config.github?.host ?? '');
    }
  }, [config]);

  const handleSave = useCallback(async () => {
    await update.mutateAsync({
      activeProvider: provider,
      github: { ...(token ? { token } : {}), host: host || null },
    });
    setToken('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }, [update, provider, token, host]);

  const connected = status.data?.enabled ?? false;

  return (
    <div>
      <SectionHeader
        title="Source Control"
        description="Connect a provider for pull requests and source-control actions. Tokens are stored on the server and never returned to the browser."
      />
      {isLoading ? (
        <div className="flex items-center justify-center py-12"><Spinner /></div>
      ) : (
        <div className="space-y-4">
          {/* Provider row with inline connection status */}
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-3.5 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-subtle text-foreground">
              <Github className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-foreground">GitHub</div>
              <div className="mt-0.5 text-xs text-muted-foreground">Create & view pull requests on GitHub.</div>
            </div>
            {status.data && (
              <span className={cn(
                'inline-flex shrink-0 items-center gap-1.5 text-xs font-medium',
                connected ? 'text-success' : 'text-muted-foreground',
              )}>
                {connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {connected ? 'Connected' : 'Not connected'}
              </span>
            )}
          </div>

          <SettingsCard title="Configuration">
            <div className="mb-4 w-48">
              <label className="mb-1.5 block text-xs font-medium text-foreground">Active provider</label>
              <Select
                value={provider}
                onChange={(v) => setProvider(v as 'github' | 'none')}
                options={[
                  { value: 'github', label: 'GitHub', description: 'Create & view PRs on GitHub' },
                  { value: 'none', label: 'None', description: 'Disable source-control features' },
                ]}
                aria-label="Source control provider"
              />
            </div>

            {provider === 'github' && (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">
                    GitHub token{' '}
                    {config?.github?.configured && <span className="text-success">(configured)</span>}
                  </label>
                  <Input
                    type="password"
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                    placeholder={config?.github?.configured ? '•••••••• (leave blank to keep)' : 'ghp_… or fine-grained token'}
                  />
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Needs <code>repo</code> + <code>pull_request</code> scopes. Falls back to the <code>gh</code> CLI when blank.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-foreground">
                    Enterprise host <span className="text-muted-foreground">(optional)</span>
                  </label>
                  <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="https://ghe.example.com" />
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
              <Button variant="primary" size="sm" onClick={handleSave} loading={update.isPending} leftIcon={<GitPullRequest className="h-3.5 w-3.5" />}>
                Save
              </Button>
              {saved && <span className="text-xs text-success">Saved</span>}
              {update.isError && (
                <span className="text-xs text-danger">{(update.error as Error)?.message ?? 'Save failed'}</span>
              )}
            </div>
          </SettingsCard>
        </div>
      )}
    </div>
  );
}
