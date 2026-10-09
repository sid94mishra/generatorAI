// Pairing (MPairing, MDF-121, MDF-122, MD-34, MD-35; `/pair`, also `/pair?mode=add` from the server switcher and
// Settings › Security): the brand mark, "Connect to a GeneratorAI server" (largeTitle), MB-39 QrScanner, "or enter the
// code", MP-40 PairingCodeInput (12 characters, 3 × 4), the server address with a reachability line (pre-auth
// `server-info` probe), one `lg` "Connect", and where to find the code. A scan or a `pair` link only pre-fills (never
// submits, MD-34). Connect asks the server what the code grants (`/auth/pair/preview`) — or uses the scanned offer —
// and shows the consent step: server name, address and fingerprint to compare, what this device will be able to do
// (the invite fixes it; ask for more later), its name, "Pair". Pairing failures keep the form with the reason (code →
// the code field, address → the address field); a Local Network prompt mid-pair retries once (pairingFailure.ts).
// Success opens `/paired`.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { isSensitiveScope, scopeLabel } from '@generatorai/shared/ui-contract';

import { QrScanner } from '../../blocks/QrScanner';
import { useAuth } from '../../services/auth/AuthProvider';
import { classifyPairingFailure, shouldAutoRetryPairing, type PairingFailure } from '../../services/auth/pairingFailure';
import { consentFor, prefillFrom, probeAddress, type PairingConsent, type Reachability } from '../../services/auth/pairingInput';
import { markPaired } from '../../services/auth/pairingOutcome';
import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { Screen } from '../../ui/layout/Screen';
import { Header } from '../../ui/native/router/Header';
import { haptic } from '../../ui/platform/haptics';
import { nouns } from '../../ui/platform/nouns';
import { Badge } from '../../ui/primitives/Badge';
import { BrandMark } from '../../ui/primitives/BrandMark';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { Field } from '../../ui/primitives/Field';
import { Input } from '../../ui/primitives/Input';
import { PairingCodeInput } from '../../ui/primitives/PairingCodeInput';
import { Separator } from '../../ui/primitives/Separator';
import { StatusDot } from '../../ui/primitives/StatusDot';
import { Text } from '../../ui/primitives/Text';

type Href = Parameters<typeof router.replace>[0];

function ReachLine({ reach }: { reach: Reachability | null }): React.ReactElement | null {
  if (!reach) return null;
  const view = reach.kind === 'reachable' ? { health: 'ok' as const, word: 'Reachable' } : reach.kind === 'checking' ? { health: 'idle' as const, word: 'Checking…' } : { health: 'err' as const, word: "Can't reach" };
  return (
    <View accessibilityRole="text" className="flex-row items-center gap-1.5" accessible accessibilityLabel={view.word} testID="pairing-reach">
      <StatusDot health={view.health} size="sm" />
      <Text role="footnote" tone="fg-3">
        {view.word}
      </Text>
    </View>
  );
}

export default function PairingScreen(): React.ReactElement {
  const { completePairing } = useAuth();
  const params = useLocalSearchParams<{ code?: string; mode?: string }>();
  const adding = params.mode === 'add';
  const n = nouns();
  const [code, setCode] = useState('');
  const [address, setAddress] = useState('');
  const [scanned, setScanned] = useState<PairingConsent | null>(null);
  const [cameraGone, setCameraGone] = useState(false);
  const [reach, setReach] = useState<Reachability | null>(null);
  const [errors, setErrors] = useState<{ code?: string; address?: string; form?: string }>({});
  const [connecting, setConnecting] = useState(false);
  const [consent, setConsent] = useState<PairingConsent | null>(null);
  const [deviceName, setDeviceName] = useState(() => `My ${n.device}`);
  const [pairing, setPairing] = useState(false);
  const [failure, setFailure] = useState<PairingFailure | null>(null);
  const [retry, setRetry] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!consent) return undefined;
    const t = setInterval(() => setClock(Date.now()), 5_000);
    return () => clearInterval(t);
  }, [consent]);

  const prefill = useCallback((raw: string, fromScan: boolean): boolean => {
    const p = prefillFrom(raw);
    if (!p) {
      if (fromScan) {
        haptic('error');
        setErrors({ form: "That QR code isn't a GeneratorAI pairing code." });
      }
      return false;
    }
    setCode(p.code);
    if (p.address) setAddress(p.address);
    setScanned(p.consent);
    setErrors({});
    if (fromScan) haptic('selection');
    return true;
  }, []);

  // A `pair` link pre-fills once and never submits (MD-34).
  const consumed = useRef<string | null>(null);
  useEffect(() => {
    const linked = typeof params.code === 'string' ? params.code : '';
    if (!linked || consumed.current === linked) return;
    consumed.current = linked;
    queueMicrotask(() => {
      if (!prefill(linked, false)) setErrors({ code: 'That link has no valid pairing code.' });
    });
  }, [params.code, prefill]);

  // Reachability of the typed address (debounced; pre-auth, no credential sent).
  useEffect(() => {
    if (!address.trim()) return undefined;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setReach({ kind: 'checking' });
      void probeAddress(address, ctrl.signal).then((r) => !ctrl.signal.aborted && setReach(r));
    }, 600);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [address]);

  const connect = (): void => {
    setErrors({});
    if (code.length !== 12) return setErrors({ code: 'Enter all 12 characters of the code.' });
    setConnecting(true);
    void consentFor(code, address, scanned)
      .then((c) => {
        setClock(Date.now());
        setConsent(c);
        setFailure(null);
      })
      .catch((e: Error & { field?: 'code' | 'address' }) => {
        haptic('error');
        setErrors({ [e.field ?? 'form']: e.message });
      })
      .finally(() => setConnecting(false));
  };

  // Pairing, with one automatic retry after a Local Network prompt interrupted it (pairingFailure.ts).
  const busy = useRef(false);
  const autoRetried = useRef(false);
  const interrupted = useRef(false);
  const lastFailure = useRef<PairingFailure | null>(null);
  const pair = useCallback(
    async (automatic: boolean) => {
      if (!consent || busy.current) return;
      if (!automatic) autoRetried.current = false;
      busy.current = true;
      interrupted.current = AppState.currentState !== 'active';
      lastFailure.current = null;
      setPairing(true);
      setFailure(null);
      try {
        await completePairing(consent, deviceName.trim() || `My ${n.device}`);
        busy.current = false;
        haptic('success');
        markPaired();
        setTimeout(() => router.replace('/paired' as Href), 0);
      } catch (err) {
        busy.current = false;
        const next = classifyPairingFailure(err);
        lastFailure.current = next;
        setFailure(next);
        setPairing(false);
        if (shouldAutoRetryPairing({ failure: next, autoRetried: autoRetried.current, interrupted: interrupted.current, appState: AppState.currentState })) {
          autoRetried.current = true;
          setTimeout(() => setRetry((r) => r + 1), 400);
          return;
        }
        haptic('error');
      }
    },
    [consent, deviceName, completePairing, n.device],
  );
  // An automatic retry is a tick the effect below turns into one more attempt (never a recursive call).
  useEffect(() => {
    if (retry === 0) return;
    queueMicrotask(() => void pair(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one attempt per tick
  }, [retry]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        if (busy.current) interrupted.current = true;
        return;
      }
      if (!busy.current && shouldAutoRetryPairing({ failure: lastFailure.current, autoRetried: autoRetried.current, interrupted: interrupted.current, appState: next })) {
        autoRetried.current = true;
        setRetry((r) => r + 1);
      }
    });
    return () => sub.remove();
  }, []);

  const back = (): void => {
    if (consent) {
      setConsent(null);
      setFailure(null);
      return;
    }
    if (router.canGoBack()) router.back();
    else router.replace('/' as Href);
  };
  const header = <Header role="detail" title={consent ? 'Pair with this server?' : ''} {...(consent || adding ? { onBack: back } : {})} />;

  if (consent) {
    const expired = consent.expiresAt <= clock;
    return (
      <Screen header={header} keyboard="form" testID="pairing-consent">
        <View className="gap-5 px-4 pb-10 pt-2">
          <Text role="largeTitle" weight={600} accessibilityRole="header">
            Pair with this server?
          </Text>
          <ListSection>
            <ListRow kind="value" icon="server" title={consent.serverName || 'GeneratorAI'} value={consent.endpoint} mono />
          </ListSection>
          <View className="gap-1.5" testID="pairing-fingerprint">
            <Text role="footnote" tone="fg-2">
              Check that this matches the fingerprint on your computer:
            </Text>
            <Text role="monoLg" weight={600} selectable accessibilityLabel={`Fingerprint ${consent.fingerprint.split('').join(' ')}`}>
              {consent.fingerprint}
            </Text>
          </View>
          <ListSection title={`This ${n.device} will be able to`} footer="The server decides what a device may do. You can ask for more later in Settings.">
            {consent.requestedScopes.map((s) => (
              <ListRow key={s} kind="info" title={scopeLabel(s)} {...(isSensitiveScope(s) ? { badge: <Badge label="Sensitive" icon="warning" tone="outline" size="sm" /> } : {})} />
            ))}
          </ListSection>
          <Input label="Name" value={deviceName} onChangeText={setDeviceName} placeholder={`My ${n.device}`} presentation="standalone" testID="pairing-name" />
          {expired ? <Callout tone="err" title="That code expired — ask for a new one" /> : null}
          {failure ? <Callout tone="err" title={failure.kind === 'identity' ? 'The server at this address changed' : "Couldn't pair"} body={failure.message} testID="pairing-error" /> : null}
          <Button label="Pair" size="lg" fullWidth loading={pairing} disabled={expired} onPress={() => void pair(false)} testID="pairing-confirm" />
          <Button label="Use a different code" variant="ghost" onPress={back} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen header={header} keyboard="form" testID="pairing">
      <View className="gap-5 px-4 pb-10 pt-2">
        <View className="gap-3">
          <BrandMark mark="app" size={36} />
          <Text role="largeTitle" weight={600} accessibilityRole="header">
            {adding ? 'Add a server' : 'Connect to a GeneratorAI server'}
          </Text>
          <Text role="body" tone="fg-2">
            {adding ? `Pair this ${n.device} with another server. Each server keeps its own key.` : `This ${n.device} is not paired yet. Pairing gives it its own key, which you can revoke at any time.`}
          </Text>
        </View>

        {cameraGone ? null : <QrScanner onScan={(data) => void prefill(data, true)} onUnavailable={() => setCameraGone(true)} paused={connecting} />}
        {scanned ? <Callout tone="ok" title={`Server found${scanned.serverName ? ` · ${scanned.serverName}` : ''}`} body="Check the code and address, then Connect." testID="pairing-scanned" /> : null}

        <View className="flex-row items-center gap-3">
          <View className="flex-1">
            <Separator />
          </View>
          <Text role="footnote" tone="fg-3">
            or enter the code
          </Text>
          <View className="flex-1">
            <Separator />
          </View>
        </View>

        <PairingCodeInput value={code} onChangeText={(v) => setCode(v)} {...(errors.code ? { error: errors.code } : {})} disabled={connecting} testID="pairing-code" />

        <Field {...(errors.address ? { error: errors.address } : {})}>
          <Input
            label="Server address"
            kind="url"
            value={address}
            onChangeText={(v) => {
              setAddress(v);
              if (!v.trim()) setReach(null);
            }}
            placeholder="http://192.168.1.24:3100"
            presentation="standalone"
            trailing={<ReachLine reach={address.trim() ? reach : null} />}
            returnKeyType="go"
            onSubmitEditing={connect}
            testID="pairing-address"
          />
        </Field>

        {errors.form ? <Callout tone="err" title={errors.form} testID="pairing-form-error" /> : null}
        <Button label="Connect" size="lg" fullWidth loading={connecting} onPress={connect} testID="pairing-connect" />
        <Text role="footnote" tone="fg-3" align="center">
          The server decides what this {n.device} may do. You can ask for more later.
        </Text>
        <Text role="footnote" tone="fg-3">
          Find the code on your computer in Settings › Security & devices › Pair a new device, or run{' '}
          <Text role="monoSm" tone="fg-2">
            generatorai device invite
          </Text>{' '}
          on the server.
        </Text>
      </View>
    </Screen>
  );
}
