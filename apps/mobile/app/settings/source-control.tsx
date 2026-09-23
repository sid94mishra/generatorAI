// ────────────────────────────────────────────────────────────────
// Settings › Source control.
//
// Lists the accounts the host has connected, which one is the default, the
// model that writes commit messages and PR text, and the fallback base
// branch.
//
// Connecting uses GitHub's device-code flow (`ConnectGitHubSheet`): the
// phone shows a short code, the person approves it on github.com and the
// SERVER stores the token, so no credential is ever typed on or held by the
// phone. Pasting a personal access token stays off the phone for exactly
// that reason. When the server has no OAuth client id the connect row says
// so instead of offering a flow that cannot start. The screen can also
// change which account is DEFAULT or disconnect one.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Github, GitBranch, Info, Plus, Sparkles, Star, Trash2 } from 'lucide-react-native';
import type { SourceControlAccount } from '@generatorai/shared';

import { Badge, SectionHeader } from '../../src/components/ui/primitives';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { ActionSheet } from '../../src/components/ui/ActionSheet';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { useToast } from '../../src/components/ui/Toast';
import { scmKeys } from '../../src/components/scm/api';
import { ConnectGitHubSheet } from '../../src/components/scm/ConnectGitHubSheet';
import { deviceConnectAvailability } from '../../src/components/scm/deviceLogin';
import { useFeature } from '../../src/components/runs/useFeature';
import { Button } from '../../src/components/ui/Button';
import { useScmApi } from '../../src/components/scm/useScmApi';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function SourceControlScreen(): React.ReactElement {
  const scm = useScmApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { colors } = useTheme();
  const [menuFor, setMenuFor] = useState<SourceControlAccount | null>(null);
  const [confirmFor, setConfirmFor] = useState<SourceControlAccount | null>(null);
  const [connecting, setConnecting] = useState(false);
  const projectEdit = useFeature('projectEdit');

  const settings = useQuery({
    queryKey: scmKeys.settings(),
    queryFn: () => scm.settings(),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: scmKeys.settings() });
  };

  const setDefault = useMutation({
    mutationFn: (accountId: string) => scm.setDefaultAccount(accountId),
    onSuccess: () => {
      invalidate();
      toast({ message: 'Default account changed', variant: 'success' });
    },
    onError: (err) => toast({ message: message(err, 'Could not change the default'), variant: 'danger' }),
  });

  const disconnect = useMutation({
    mutationFn: (accountId: string) => scm.disconnectAccount(accountId),
    onSuccess: () => {
      invalidate();
      toast({ message: 'Account disconnected', variant: 'success' });
    },
    onError: (err) => toast({ message: message(err, 'Could not disconnect'), variant: 'danger' }),
  });

  const data = settings.data?.settings;
  const accounts = data?.accounts ?? [];
  const generation = data?.generation;
  const connect = deviceConnectAvailability(settings.data?.providers, projectEdit.scopes);

  return (
    <Screen
      title="Source control"
      back
      onRefresh={() => void settings.refetch()}
      refreshing={settings.isFetching}
    >
      {settings.isLoading ? (
        <SkeletonList rows={3} />
      ) : settings.isError ? (
        <ErrorState
          message="Could not read the source-control settings."
          onRetry={() => void settings.refetch()}
        />
      ) : (
        <>
          <SectionHeader
            title={`Accounts (${accounts.length})`}
            {...(connect.kind === 'available'
              ? {
                  action: (
                    <Button
                      label="Connect"
                      variant="ghost"
                      size="sm"
                      haptic="tap"
                      icon={<Plus size={16} color={colors.primary} />}
                      onPress={() => setConnecting(true)}
                      accessibilityLabel="Connect GitHub"
                    />
                  ),
                }
              : {})}
          />
          {accounts.length === 0 ? (
            <EmptyState
              title="No account connected"
              message="Pull requests and pushes need a GitHub account."
              icon={<Github size={24} color={colors['muted-foreground']} />}
              {...(connect.kind === 'available'
                ? { action: { label: 'Connect GitHub', onPress: () => setConnecting(true) } }
                : {})}
            />
          ) : (
            <ListGroup>
              {accounts.map((account) => (
                <ListRow
                  key={account.id}
                  title={account.login ?? account.label}
                  subtitle={subtitleFor(account)}
                  icon={<Github size={18} color={colors.foreground} />}
                  onPress={() => setMenuFor(account)}
                  chevron={false}
                  {...(account.id === data?.defaultAccountId
                    ? { trailing: <Badge label="Default" tone="primary" /> }
                    : {})}
                  accessibilityHint="Set as default or disconnect"
                />
              ))}
            </ListGroup>
          )}

          <SectionHeader title="Generation" />
          <ListGroup>
            <ListRow
              title="Commit and PR text"
              subtitle={
                generation?.model
                  ? `${generation.model}${generation.provider ? ` · ${generation.provider}` : ''}`
                  : 'Written from the change set (no model configured)'
              }
              icon={<Sparkles size={18} color={colors['muted-foreground']} />}
              chevron={false}
            />
            <ListRow
              title="Default base branch"
              subtitle={data?.defaultBase ?? "The repository's own default"}
              icon={<GitBranch size={18} color={colors['muted-foreground']} />}
              chevron={false}
            />
          </ListGroup>

          {connect.kind === 'missing-scope' || connect.kind === 'not-configured' ? (
            <View className="mt-3 gap-2 rounded-xl border border-border bg-control p-3.5">
              <View className="flex-row gap-2.5">
                <Info size={16} color={colors['muted-foreground']} />
                <Text className="flex-1 text-sm leading-relaxed text-muted-foreground">{connect.reason}</Text>
              </View>
              {connect.kind === 'missing-scope' && projectEdit.grantable ? (
                <View className="self-start pl-6">
                  <Button
                    label="Request access"
                    variant="ghost"
                    size="sm"
                    haptic="tap"
                    onPress={projectEdit.requestAccess}
                  />
                </View>
              ) : null}
            </View>
          ) : (
            <View className="mt-3 flex-row gap-2.5 rounded-xl border border-border bg-control p-3.5">
              <Info size={16} color={colors['muted-foreground']} />
              <Text className="flex-1 text-sm leading-relaxed text-muted-foreground">
                Connecting shows a code to approve on github.com. The token is stored on the machine
                running GeneratorAI, never on this phone. Personal access tokens are added from the
                desktop or web app.
              </Text>
            </View>
          )}
        </>
      )}

      <ConnectGitHubSheet visible={connecting} onClose={() => setConnecting(false)} />

      <ActionSheet
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor?.label ?? ''}
        {...(menuFor ? { message: subtitleFor(menuFor) } : {})}
        actions={
          menuFor
            ? [
                {
                  label: 'Set as default',
                  icon: <Star size={18} color={colors.foreground} />,
                  disabled: menuFor.id === data?.defaultAccountId || setDefault.isPending,
                  ...(menuFor.id === data?.defaultAccountId ? { detail: 'Already the default' } : {}),
                  onPress: () => {
                    const id = menuFor.id;
                    setMenuFor(null);
                    setDefault.mutate(id);
                  },
                },
                {
                  label: 'Disconnect',
                  icon: <Trash2 size={18} color={colors.danger} />,
                  destructive: true,
                  onPress: () => {
                    const account = menuFor;
                    setMenuFor(null);
                    setConfirmFor(account);
                  },
                },
              ]
            : []
        }
      />

      <ActionSheet
        visible={confirmFor !== null}
        onClose={() => setConfirmFor(null)}
        title={`Disconnect ${confirmFor?.login ?? confirmFor?.label ?? 'this account'}?`}
        message="Its token is deleted from the host. Repositories on that host stop being able to push or open pull requests until it is connected again."
        actions={[
          {
            label: 'Disconnect',
            destructive: true,
            onPress: () => {
              const id = confirmFor?.id;
              setConfirmFor(null);
              if (id) disconnect.mutate(id);
            },
          },
        ]}
      />
    </Screen>
  );
}

function subtitleFor(account: SourceControlAccount): string {
  const host = account.host ?? 'github.com';
  const method =
    account.authMethod === 'token'
      ? 'token'
      : account.authMethod === 'device'
        ? 'device sign-in'
        : 'gh CLI';
  return `${host} · ${method}`;
}

function message(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
