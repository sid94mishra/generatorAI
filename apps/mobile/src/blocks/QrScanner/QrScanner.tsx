// MB-39 QrScanner (MPairing): the camera viewfinder — h224 (h-56; 03 says 220) `rounded-card-lg` `bg-sunken`, a 148 frame with L-corners
// and a scan line (static under Reduce Motion), the caption and a Torch button. expo-camera barcode scanning (QR
// only). A scan only reports its text (the screen pre-fills, never submits, MD-34). States: permission not asked
// (Allow) / denied (Open Settings) through PermissionState `camera`; no camera (a simulator, some tablets) → the
// block renders nothing and tells the screen, which keeps code entry.
import React, { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { useReduceMotion } from '../../ui/platform/motion';
import { Icon } from '../../ui/primitives/Icon';
import { IconButton } from '../../ui/primitives/IconButton';
import { PermissionState } from '../../ui/primitives/PermissionState';
import { Text } from '../../ui/primitives/Text';

export interface QrScannerProps {
  /** Called once per distinct scanned text. */
  onScan: (data: string) => void;
  /** No camera on this device: the screen keeps code entry only. */
  onUnavailable?: () => void;
  /** Pause scanning (e.g. while a scan is being handled). */
  paused?: boolean;
  testID?: string;
}

/** The 148 frame's four L-corners. */
function Corners(): React.ReactElement {
  const base = 'absolute size-9 border-fg';
  return (
    <>
      <View className={`${base} left-0 top-0 rounded-tl-card border-l-4 border-t-4`} />
      <View className={`${base} right-0 top-0 rounded-tr-card border-r-4 border-t-4`} />
      <View className={`${base} bottom-0 left-0 rounded-bl-card border-b-4 border-l-4`} />
      <View className={`${base} bottom-0 right-0 rounded-br-card border-b-4 border-r-4`} />
    </>
  );
}

function ScanLine(): React.ReactElement {
  const reduced = useReduceMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      cancelAnimation(y);
      y.set(0);
      return undefined;
    }
    y.set(withRepeat(withTiming(1, { duration: 1600, easing: Easing.inOut(Easing.ease) }), -1, true));
    return () => cancelAnimation(y);
  }, [reduced, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: (y.get() - 0.5) * 110 }] }));
  return <Animated.View className="absolute left-4 right-4 top-1/2 h-0.5 rounded-full bg-fg-2" style={style} />;
}

export function QrScanner({ onScan, onUnavailable, paused = false, testID = 'qr-scanner' }: QrScannerProps): React.ReactElement | null {
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [broken, setBroken] = useState(false);
  const last = useRef<string | null>(null);

  if (broken) return null;
  if (!permission) return <View className="h-56 rounded-card-lg bg-sunken" testID={`${testID}-loading`} />;
  if (!permission.granted) {
    return (
      <PermissionState
        kind="camera"
        status={permission.canAskAgain ? 'undetermined' : 'denied'}
        onRequest={() => void requestPermission()}
        onOpenSettings={() => void Linking.openSettings()}
        testID={`${testID}-permission`}
      />
    );
  }
  return (
    <View className="h-56 overflow-hidden rounded-card-lg bg-sunken" testID={testID}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={
          paused
            ? undefined
            : ({ data }) => {
                if (!data || data === last.current) return;
                last.current = data;
                onScan(data);
              }
        }
        onMountError={() => {
          setBroken(true);
          onUnavailable?.();
        }}
      />
      <View className="flex-1 items-center justify-center" pointerEvents="none">
        <View className="size-36">
          <Corners />
          <ScanLine />
        </View>
      </View>
      <View className="absolute right-3 top-3">
        <IconButton icon="zap" label={torch ? 'Turn torch off' : 'Torch'} variant="glass" selected={torch} onPress={() => setTorch((t) => !t)} testID={`${testID}-torch`} />
      </View>
      <View className="absolute bottom-3 left-0 right-0 flex-row items-center justify-center gap-1.5" pointerEvents="none">
        <Icon concept="scan" size={14} tone="fg-2" />
        <Text role="footnote" tone="fg-2">
          Point at the QR code on your computer
        </Text>
      </View>
    </View>
  );
}
