// ────────────────────────────────────────────────────────────────
// /scope-request — ask for a permission this device does not hold.
//
// The scopes this device lacks, grouped by what each unlocks, with the
// sensitive ones marked. Pick the ones you want, say why, send. The server
// route (`POST /api/auth/devices/me/scope-requests`) is being added
// alongside this sheet; an older server answers 404, and the sheet says
// exactly what to do instead rather than showing a button that fails.
//
// `?scope=exec:terminal` preselects — that is how a LockedState's
// "Request access" lands here with the right box ticked.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ShieldAlert } from 'lucide-react-native';

import { ApiError } from '@generatorai/client-core';

import { useAuth } from '../src/auth/AuthProvider';
import { useCreateScopeRequest } from '../src/api/scopeRequests';
import { describeScope, isSensitiveScope } from '../src/auth/scopeLabels';
import type { MobileFeature } from '../src/auth/featureGate';
import {
  UNSUPPORTED_MESSAGE,
  missingGrantableScopes,
  scopeRequestBody,
  scopeRequestOutcome,
} from '../src/auth/scopeRequests';
import { RouteSheet } from '../src/navigation/RouteSheet';
import { Button } from '../src/components/ui/Button';
import { Field } from '../src/components/ui/Form';
import { ListGroup, ListRow } from '../src/components/ui/ListRow';
import { Card, SectionHeader } from '../src/components/ui/primitives';
import { EmptyState } from '../src/components/ui/States';
import { haptics } from '../src/components/ui/haptics';
import { useToast } from '../src/components/ui/Toast';
import { useTheme } from '../src/theme/ThemeProvider';

/** Short names for what a scope unlocks, mirroring Settings › Security. */
const FEATURE_LABELS: Record<MobileFeature, string> = {
  terminal: 'run terminal commands',
  browser: "control the agent's browser",
  voice: 'dictate messages',
  fileUpload: 'attach and write files',
  runStart: 'start runs',
  scriptRun: 'run workflow scripts',
  runControl: 'pause and cancel runs',
  workflowEdit: 'edit workflows',
  projectEdit: 'link codebases',
  codebaseLinkLocal: 'link a local folder',
  capabilityAdmin: 'manage MCP servers, agents and extensions',
  computer: 'watch and approve computer use',
  deviceAdmin: 'manage other devices',
};

export default function ScopeRequestScreen(): React.ReactElement {
  const { state, refreshPermissions } = useAuth();
  const { colors } = useTheme();
  const toast = useToast();
  const create = useCreateScopeRequest();
  const params = useLocalSearchParams<{ scope?: string | string[] }>();

  const granted = state.status === 'authenticated' ? state.scopes : [];
  const missing = useMemo(() => missingGrantableScopes(granted), [granted]);

  const preselected = useMemo(() => {
    const raw = Array.isArray(params.scope) ? params.scope : params.scope ? [params.scope] : [];
    return new Set(raw.flatMap((s) => s.split(',')).filter((s) => missing.some((m) => m.scope === s)));
  }, [params.scope, missing]);

  const [selected, setSelected] = useState<Set<string>>(() => preselected);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  const toggle = useCallback((scope: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });
  }, []);

  const request = scopeRequestBody([...selected], reason);

  const send = useCallback(async () => {
    if (busy) return;
    if (!request) {
      // The button stays readable instead of sitting at 40% opacity with an
      // instruction for a label; pressing it explains what is missing.
      haptics.warn();
      toast({ message: 'Pick at least one permission above.', tone: 'info' });
      return;
    }
    setBusy(true);
    try {
      await create.mutateAsync(request);
      haptics.success();
      toast({ message: 'Request sent. An admin approves it on a trusted device.', tone: 'success' });
      // A grant made in the meantime lives inside the token; re-mint so
      // the user does not have to know that.
      void refreshPermissions().catch(() => undefined);
      if (router.canGoBack()) router.back();
      else router.replace('/(tabs)');
    } catch (error) {
      const outcome =
        error instanceof ApiError ? scopeRequestOutcome(error.status) : { kind: 'failed' as const, status: 0 };
      if (outcome.kind === 'unsupported') {
        setUnsupported(true);
        haptics.warn();
        return;
      }
      haptics.error();
      toast({
        message:
          outcome.kind === 'forbidden'
            ? 'This device is not allowed to request that permission.'
            : outcome.kind === 'pending'
              ? 'A request from this device is already waiting for an admin.'
              : outcome.kind === 'failed' && outcome.status > 0
                ? `The server refused the request (${outcome.status}).`
                : 'Could not reach the server.',
        tone: outcome.kind === 'pending' ? 'info' : 'error',
      });
    } finally {
      setBusy(false);
    }
  }, [request, busy, create, toast, refreshPermissions]);

  return (
    <RouteSheet
      title="Request access"
      subtitle="Permissions this device does not have yet"
      fallback="/settings/security"
      // Pinned: at the sheet's 0.6 detent a button after the list and the
      // reason field started below the fold.
      footer={
        missing.length === 0 ? undefined : (
          <Button
            label={
              selected.size === 0
                ? 'Request access'
                : `Request ${selected.size} permission${selected.size === 1 ? '' : 's'}`
            }
            full
            size="lg"
            loading={busy}
            disabled={unsupported}
            onPress={() => void send()}
          />
        )
      }
    >
      {missing.length === 0 ? (
        <EmptyState
          title="Nothing to request"
          message="This device already holds every permission a phone can be granted."
        />
      ) : (
        <>
          <ListGroup>
            {missing.map(({ scope, features }) => {
              const sensitive = isSensitiveScope(scope);
              const unlocks = features.map((f) => FEATURE_LABELS[f]).join(', ');
              return (
                <ListRow
                  key={scope}
                  title={describeScope(scope)}
                  subtitle={`${sensitive ? 'Sensitive · ' : ''}Lets this device ${unlocks}`}
                  icon={
                    sensitive ? <ShieldAlert size={18} color={colors.warning} /> : undefined
                  }
                  toggle={{ value: selected.has(scope), onValueChange: (on) => toggle(scope, on) }}
                  accessibilityLabel={`${describeScope(scope)}${sensitive ? ', sensitive' : ''}`}
                  accessibilityHint={`Lets this device ${unlocks}`}
                />
              );
            })}
          </ListGroup>

          <Field
            label="Why do you need it? (optional)"
            hint="Shown to the admin who approves the request."
            multiline
            value={reason}
            onChangeText={setReason}
            placeholder="e.g. I need to run tests from my phone this week."
          />

          {unsupported ? (
            <Card className="gap-2 border-warning p-3.5">
              <View className="flex-row items-center gap-2">
                <ShieldAlert size={16} color={colors.warning} />
                <Text className="flex-1 text-md font-semibold text-foreground">Server needs an update</Text>
              </View>
              <Text className="text-sm leading-relaxed text-muted-foreground">{UNSUPPORTED_MESSAGE}</Text>
              <Button
                label="Check for new permissions"
                variant="secondary"
                size="sm"
                haptic="tap"
                onPress={() => {
                  void refreshPermissions()
                    .then(() => toast({ message: 'Permissions refreshed.', tone: 'success' }))
                    .catch(() => toast({ message: 'Could not refresh permissions.', tone: 'error' }));
                }}
              />
            </Card>
          ) : null}

          <Text className="text-sm leading-relaxed text-muted-foreground">
            Sensitive permissions let this phone act on the machine running GeneratorAI. An admin
            approves each request on a trusted device; nothing changes until they do.
          </Text>
        </>
      )}
    </RouteSheet>
  );
}
