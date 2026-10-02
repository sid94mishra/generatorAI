// ────────────────────────────────────────────────────────────────
// Settings › Extensions.
//
// What is installed on the machine running GeneratorAI (GET /api/extensions),
// whether each one loaded, and — only when this phone holds `admin:settings`
// (the route policy's write scope for /extensions) — a switch to turn one on
// or off (PATCH /api/extensions/:id {enabled}). Installing and removing stay
// on the desktop, where the permission diff can be reviewed.
// ────────────────────────────────────────────────────────────────

import React, { useState } from 'react';
import { Text } from 'react-native';
import { useExtensions, useToggleExtension } from '../../src/features/settings/queries';
import { Blocks } from 'lucide-react-native';

import { useAdminApi } from '../../src/services/api/useAdminApi';
import { useAuth } from '../../src/services/auth/AuthProvider';
import { checkFeature } from '../../src/services/auth/featureGate';
import { requireStepUp } from '../../src/services/auth/stepUp';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { Badge, Card } from '../../src/components/ui/primitives';
import { Screen } from '../../src/components/ui/Screen';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { useToast } from '../../src/components/ui/Toast';
import { useTheme } from '../../src/theme/ThemeProvider';

import type { ExtensionRow } from '../../src/features/settings/extensionModel';

export default function ExtensionsScreen(): React.ReactElement {
  const { state } = useAuth();
  const { legacyColors: colors } = useTheme();
  const toast = useToast();
  const scopes = state.status === 'authenticated' ? state.scopes : [];
  const canManage = checkFeature('capabilityAdmin', scopes).available;
  const [pending, setPending] = useState<string | null>(null);

  const extensions = useExtensions();

  const toggle = useToggleExtension({
    onSuccess: (_data, { enabled }) => {
      toast({ message: enabled ? 'Extension turned on.' : 'Extension turned off.', variant: 'success' });
    },
    onError: (err) =>
      toast({
        message: `Could not change the extension: ${err instanceof Error ? err.message : String(err)}`,
        variant: 'danger',
      }),
    onSettled: () => {
      setPending(null);
    },
  });

  const onToggle = async (row: ExtensionRow, enabled: boolean): Promise<void> => {
    // An extension runs code on the host; changing that is an admin action.
    if (!(await requireStepUp(`Confirm turning ${row.name} ${enabled ? 'on' : 'off'}`))) return;
    setPending(row.id);
    toggle.mutate({ id: row.id, enabled });
  };

  const rows = extensions.data ?? [];

  return (
    <Screen
      title="Extensions"
      back
      backFallback="/settings"
      onRefresh={() => extensions.refetch()}
      refreshing={extensions.isFetching}
    >
      <Text className="text-sm leading-relaxed text-muted-foreground">
        {canManage
          ? 'Extensions installed on the machine running GeneratorAI. Turning one off applies to every connected client.'
          : 'Extensions installed on the machine running GeneratorAI. Turning them on or off needs the “Change server settings” permission.'}
      </Text>

      {extensions.isLoading ? (
        <SkeletonList rows={3} />
      ) : extensions.isError ? (
        <ErrorState message="Could not load extensions." onRetry={() => void extensions.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No extensions installed"
          icon={<Blocks size={24} color={colors['muted-foreground']} />}
        />
      ) : (
        <ListGroup>
          {rows.map((row) => {
            const failed = row.enabled && (!row.ready || row.errors.length > 0);
            const subtitle =
              failed && row.errors[0]
                ? row.errors[0]
                : [row.version ? `v${row.version}` : null, row.scope, row.description].filter(Boolean).join(' · ');
            return canManage ? (
              <ListRow
                key={row.id}
                title={row.name}
                subtitle={subtitle || row.id}
                icon={<Blocks size={18} color={failed ? colors.danger : colors['muted-foreground']} />}
                disabled={pending === row.id}
                toggle={{ value: row.enabled, onValueChange: (next) => void onToggle(row, next) }}
                accessibilityLabel={`${row.name}, ${row.enabled ? 'on' : 'off'}${failed ? ', failed to load' : ''}`}
              />
            ) : (
              <ListRow
                key={row.id}
                title={row.name}
                subtitle={subtitle || row.id}
                icon={<Blocks size={18} color={failed ? colors.danger : colors['muted-foreground']} />}
                trailing={
                  failed ? (
                    <Badge label="Failed" tone="danger" />
                  ) : row.enabled ? undefined : (
                    <Badge label="Off" tone="neutral" />
                  )
                }
              />
            );
          })}
        </ListGroup>
      )}

      {!canManage && rows.length > 0 ? (
        <Card className="p-4">
          <Text className="text-sm text-muted-foreground">
            Read-only on this phone. Ask for the permission from Settings › Security, or change extensions on the
            desktop.
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}
