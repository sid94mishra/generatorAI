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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Blocks } from 'lucide-react-native';

import { useAdminApi } from '../../src/api/useAdminApi';
import { useAuth } from '../../src/auth/AuthProvider';
import { checkFeature } from '../../src/auth/featureGate';
import { requireStepUp } from '../../src/auth/stepUp';
import { ListGroup, ListRow } from '../../src/components/ui/ListRow';
import { Badge, Card } from '../../src/components/ui/primitives';
import { Screen } from '../../src/components/ui/Screen';
import { SkeletonList } from '../../src/components/ui/Skeleton';
import { EmptyState, ErrorState } from '../../src/components/ui/States';
import { useToast } from '../../src/components/ui/Toast';
import { useTheme } from '../../src/theme/ThemeProvider';

const EXTENSIONS_KEY = ['extensions'] as const;

interface ExtensionRow {
  id: string;
  name: string;
  version: string | null;
  description: string | null;
  scope: string | null;
  enabled: boolean;
  /** False when the extension is enabled but failed to register. */
  ready: boolean;
  errors: string[];
}

/**
 * The route returns the server's `InstalledExtension` (`{ manifest, scope,
 * enabled, ready, errors }`); client-core's `ExtensionSummary` describes a
 * flat `{ id, name }`. Accept either so the screen works against both.
 */
function toRow(raw: unknown): ExtensionRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const manifest = (r.manifest && typeof r.manifest === 'object' ? r.manifest : r) as Record<string, unknown>;
  const id = typeof manifest.id === 'string' ? manifest.id : null;
  if (!id) return null;
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  return {
    id,
    name: str(manifest.name) ?? id,
    version: str(manifest.version),
    description: str(manifest.description),
    scope: str(r.scope),
    enabled: r.enabled === true,
    ready: r.ready !== false,
    errors: Array.isArray(r.errors) ? r.errors.filter((e): e is string => typeof e === 'string') : [],
  };
}

export default function ExtensionsScreen(): React.ReactElement {
  const admin = useAdminApi();
  const { state } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const queryClient = useQueryClient();
  const scopes = state.status === 'authenticated' ? state.scopes : [];
  const canManage = checkFeature('capabilityAdmin', scopes).available;
  const [pending, setPending] = useState<string | null>(null);

  const extensions = useQuery({
    queryKey: EXTENSIONS_KEY,
    queryFn: async () =>
      ((await admin.extensions.list()) as unknown[]).map(toRow).filter((r): r is ExtensionRow => r !== null),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) =>
      admin.extensions.update(encodeURIComponent(id), { enabled }),
    onMutate: ({ id }) => setPending(id),
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
      void queryClient.invalidateQueries({ queryKey: EXTENSIONS_KEY });
    },
  });

  const onToggle = async (row: ExtensionRow, enabled: boolean): Promise<void> => {
    // An extension runs code on the host; changing that is an admin action.
    if (!(await requireStepUp(`Confirm turning ${row.name} ${enabled ? 'on' : 'off'}`))) return;
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
