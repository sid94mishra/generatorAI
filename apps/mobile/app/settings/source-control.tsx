// ────────────────────────────────────────────────────────────────
// Settings › Source control.
//
// Lists the accounts the host has connected, which one is the default, the
// model that writes commit messages and PR text, and the fallback base
// branch.
//
// Connecting an account is deliberately absent. A personal access token
// typed on a phone is a credential entered on the least trusted device in
// the chain, and it would be stored on the host machine anyway — so this
// screen reads the registry and can change which account is DEFAULT or
// disconnect one (neither reveals or accepts a secret), and says where to
// go to add one.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Github, GitBranch, Info, Sparkles, Star, Trash2 } from 'lucide-react-native';
import type { SourceControlAccount } from '@generatorai/shared';

import { Badge, SectionHeader } from '../../src/components/ui/primitives';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { ActionSheet } from '../../src/components/ui/ActionSheet';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { useToast } from '../../src/components/ui/Toast';
import { scmKeys } from '../../src/components/scm/api';
import { useScmApi } from '../../src/components/scm/useScmApi';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function SourceControlScreen(): React.ReactElement {
  const scm = useScmApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { colors } = useTheme();
  const [menuFor, setMenuFor] = useState<SourceControlAccount | null>(null);
  const [confirmFor, setConfirmFor] = useState<SourceControlAccount | null>(null);

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
          <SectionHeader title={`Accounts (${accounts.length})`} />
          {accounts.length === 0 ? (
            <EmptyState
              title="No account connected"
              message="Connect GitHub from the desktop or web app. Pull requests and pushes need one."
              icon={<Github size={24} color={colors['muted-foreground']} />}
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

          <View className="mt-3 flex-row gap-2.5 rounded-3xl border border-border bg-subtle p-3.5">
            <Info size={16} color={colors['muted-foreground']} />
            <Text className="flex-1 text-xs leading-relaxed text-muted-foreground">
              Connecting an account means entering a token or signing in, which belongs on the
              machine running GeneratorAI rather than on a phone. This screen can pick the default
              account and disconnect one; add accounts from the desktop or web app.
            </Text>
          </View>
        </>
      )}

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
