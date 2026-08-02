// ────────────────────────────────────────────────────────────────
// Settings › Source control.
//
// Shows which provider is active and whether it is usable. Editing the token
// is deliberately absent: a personal access token typed on a phone is a
// credential entered on the least trusted device in the chain, and it would
// be stored on the host machine anyway.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Github, GitBranch, KeyRound } from 'lucide-react-native';

import { useApi } from '../../src/api/useApi';
import { Badge, SectionHeader } from '../../src/components/ui/primitives';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { ErrorState } from '../../src/components/ui/States';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { Screen } from '../../src/components/ui/Screen';
import { useTheme } from '../../src/theme/ThemeProvider';

export default function SourceControlScreen(): React.ReactElement {
  const api = useApi();
  const { colors } = useTheme();

  const config = useQuery({
    queryKey: ['source-control', 'config'],
    queryFn: () => api.sourceControl.config(),
  });

  const status = useQuery({
    queryKey: ['source-control', 'status'],
    queryFn: () => api.sourceControl.status(),
  });

  const provider = config.data?.activeProvider ?? 'none';

  return (
    <Screen
      title="Source control"
      back
      onRefresh={() => {
        void config.refetch();
        void status.refetch();
      }}
      refreshing={config.isFetching || status.isFetching}
    >
      {config.isLoading ? (
        <SkeletonList rows={3} />
      ) : config.isError ? (
        <ErrorState message="Could not read the configuration." onRetry={() => void config.refetch()} />
      ) : (
        <>
          <ListGroup>
            <ListRow
              title="Provider"
              subtitle={provider === 'github' ? 'GitHub' : 'None configured'}
              icon={
                provider === 'github' ? (
                  <Github size={18} color={colors.foreground} />
                ) : (
                  <GitBranch size={18} color={colors['muted-foreground']} />
                )
              }
              chevron={false}
              trailing={
                <Badge
                  label={status.data?.enabled ? 'Connected' : 'Not connected'}
                  tone={status.data?.enabled ? 'success' : 'neutral'}
                />
              }
            />
            {provider === 'github' ? (
              <ListRow
                title="Host"
                subtitle={config.data?.github?.host ?? 'github.com'}
                icon={<GitBranch size={18} color={colors['muted-foreground']} />}
                chevron={false}
              />
            ) : null}
            {provider === 'github' ? (
              <ListRow
                title="Credential"
                subtitle={
                  config.data?.github?.hasToken
                    ? `Stored on the host${config.data.github.username ? ` · ${config.data.github.username}` : ''}`
                    : 'No token stored'
                }
                icon={<KeyRound size={18} color={colors['muted-foreground']} />}
                chevron={false}
              />
            ) : null}
          </ListGroup>

          <SectionHeader title="Why this is read-only" />
          <Text className="px-1 text-xs leading-relaxed text-muted-foreground">
            A token entered here would be typed on the least trusted device in the chain and then
            stored on the host anyway. Configure it on the machine running GeneratorAI. Opening pull
            requests is likewise a desktop action — it is not something to confirm on a phone.
          </Text>
        </>
      )}
    </Screen>
  );
}
