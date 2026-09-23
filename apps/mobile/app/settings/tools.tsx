// ────────────────────────────────────────────────────────────────
// Settings › Phone access.
//
// A capability matrix for THIS device. Every row states whether the feature
// is available, and when it is not, exactly which permission is missing and
// whether granting it would help — the distinction between "ask for this" and
// "this can never work from a phone" is the whole point of the screen.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  FileUp,
  Globe,
  Mic,
  Play,
  TerminalSquare,
  Workflow,
} from 'lucide-react-native';

import { useAuth } from '../../src/auth/AuthProvider';
import { checkFeature, type MobileFeature } from '../../src/auth/featureGate';
import { describeScope } from '../../src/auth/scopeLabels';
import { Button } from '../../src/components/ui/Button';
import { Badge, Card, SectionHeader } from '../../src/components/ui/primitives';
import { SCOPE_REQUEST_ROUTE } from '../../src/navigation/routes';
import { Screen } from '../../src/components/ui/Screen';
import { useTheme } from '../../src/theme/ThemeProvider';

const ROWS: Array<{
  feature: MobileFeature;
  title: string;
  Icon: React.ComponentType<{ size?: number; color?: string }>;
}> = [
  { feature: 'terminal', title: 'Terminal', Icon: TerminalSquare },
  { feature: 'browser', title: 'Browser preview', Icon: Globe },
  { feature: 'voice', title: 'Voice input', Icon: Mic },
  { feature: 'fileUpload', title: 'File attachments', Icon: FileUp },
  { feature: 'runControl', title: 'Run controls', Icon: Play },
  { feature: 'workflowEdit', title: 'Workflow editing', Icon: Workflow },
];

export default function ToolsScreen(): React.ReactElement {
  const { state } = useAuth();
  const { colors } = useTheme();
  const scopes = state.status === 'authenticated' ? state.scopes : [];

  return (
    <Screen title="Phone access" back>
      <Text className="text-sm leading-relaxed text-muted-foreground">
        What this phone is allowed to do. Permissions are granted when the device is paired and can
        be changed from a trusted device.
      </Text>

      {ROWS.map(({ feature, title, Icon }) => {
        const check = checkFeature(feature, scopes);
        return (
          <Card key={feature} className="gap-2.5 p-4">
            <View className="flex-row items-center gap-3">
              <View className="h-9 w-9 items-center justify-center">
                <Icon size={17} color={check.available ? colors.success : colors['muted-foreground']} />
              </View>
              <Text className="flex-1 text-md font-medium text-foreground">{title}</Text>
              <Badge
                label={check.available ? 'Available' : check.grantable ? 'Not granted' : 'Not possible'}
                tone={check.available ? 'success' : check.grantable ? 'warning' : 'neutral'}
              />
            </View>

            {check.reason ? (
              <Text className="text-sm leading-relaxed text-muted-foreground">{check.reason}</Text>
            ) : null}

            {check.missing.length > 0 ? (
              <View className="flex-row flex-wrap gap-1.5">
                {check.missing.map((scope) => (
                  <Badge key={scope} label={describeScope(scope)} tone="neutral" />
                ))}
              </View>
            ) : null}

            {/* "Not granted" used to be a dead end on this screen; the
                request sheet already accepts the scopes to preselect. */}
            {!check.available && check.grantable && check.missing.length > 0 ? (
              <Button
                label="Request access"
                variant="secondary"
                size="sm"
                haptic="tap"
                accessibilityLabel={`Request access to ${title}`}
                onPress={() =>
                  router.push(
                    `${SCOPE_REQUEST_ROUTE}?scope=${encodeURIComponent(check.missing.join(','))}` as never,
                  )
                }
              />
            ) : null}
          </Card>
        );
      })}

      <SectionHeader title="Browser preview" />
      <Text className="text-xs leading-relaxed text-muted-foreground">
        Even with permission, the browser here is view-only. The page the agent is driving is laid
        out for a desktop window, so forwarding phone touches to it would land clicks nowhere near
        where you aimed. You see what it sees; you drive it from the desktop.
      </Text>
    </Screen>
  );
}
