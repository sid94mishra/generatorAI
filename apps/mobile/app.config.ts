import type { ExpoConfig } from 'expo/config';

// ────────────────────────────────────────────────────────────────
// Expo config.
//
// Continuous Native Generation: `ios/` and `android/` are NOT committed;
// `expo prebuild` regenerates them from this file, so every native setting
// lives here rather than in an Xcode project that drifts.
// ────────────────────────────────────────────────────────────────

// ── EAS project id ─────────────────────────────────────────────────
// `getExpoPushTokenAsync` cannot mint a token without it, so a build made
// without this variable ships with push notifications silently off. Sourced
// from the environment (EAS build profile `env`, an EAS secret, or the shell)
// rather than committed, because the id is per-Expo-account.
const easProjectId = process.env['EAS_PROJECT_ID']?.trim() || undefined;
if (!easProjectId) {
  console.warn(
    '[app.config] EAS_PROJECT_ID is not set — this build will have push notifications ' +
      'DISABLED (no `extra.eas.projectId`). Set EAS_PROJECT_ID at build time (see eas.json / README).',
  );
}

const config: ExpoConfig = {
  name: 'GeneratorAI',
  slug: 'generatorai',
  version: '0.1.0',
  orientation: 'default',
  scheme: 'generatorai',
  userInterfaceStyle: 'automatic',
  // No `newArchEnabled`: the New Architecture is unconditional from SDK 57,
  // and the key was removed from the config type.

  ios: {
    supportsTablet: true,
    bundleIdentifier: 'dev.generatorai.app',
    infoPlist: {
      // The relay + E2EE stack is real cryptography, so this is NOT exempt.
      // Claiming exemption to skip the App Store prompt would be a false
      // declaration; the correct move is a proper CCATS/self-classification.
      ITSAppUsesNonExemptEncryption: true,
      NSCameraUsageDescription:
        'Scan the pairing QR code shown by your GeneratorAI server to connect this device.',
      NSMicrophoneUsageDescription:
        'Dictate prompts to your agent. Audio is transcribed on your own server, never in the cloud.',
      // Both uses are real (D8): `AppLockGate` (src/auth/AppLock.tsx) locks the
      // app on cold start and after the configured grace, and `requireStepUp`
      // (src/auth/stepUp.ts) confirms terminal/browser/computer and admin
      // actions and device revocation. Keep this string in step with the
      // `faceIDPermission` plugin value below — Apple reviews the one that
      // ends up in Info.plist, and the plugin writes the same key.
      NSFaceIDUsageDescription:
        'Unlock GeneratorAI when you return to it, and confirm sensitive actions such as opening a terminal or revoking a device.',
      // Loopback/LAN endpoints are plain HTTP by design. There is NO
      // message-level encryption above the transport (relay-protocol's
      // e2ee.ts is unwired); requests are DPoP-signed, which authenticates
      // them but does not hide their contents from the local network.
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
      },
      NSLocalNetworkUsageDescription:
        'Discover and connect to your GeneratorAI server on this network.',
      UIBackgroundModes: ['remote-notification', 'processing'],
    },
  },

  android: {
    package: 'dev.generatorai.app',
    adaptiveIcon: { backgroundColor: '#0d1117' },
    // Android 14+ predictive back. Without it the OS falls back to the
    // legacy blocking behaviour and the back preview never animates.
    predictiveBackGestureEnabled: true,
    // The composer and every sheet depend on the window resizing when the
    // IME opens; `pan` (the other option) slides the whole window and hides
    // the transcript instead.
    softwareKeyboardLayoutMode: 'resize',
    // Cleartext (`http://`) is enabled by `./plugins/withCleartextTraffic`
    // below — see that file and README "Android cleartext".
    permissions: [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.USE_BIOMETRIC',
      'android.permission.POST_NOTIFICATIONS',
    ],
  },

  plugins: [
    'expo-router',
    [
      // Splash configuration moved out of the top-level `splash` key in
      // SDK 57. Dark is the product default, so the launch background must
      // match or every cold start flashes white before the first paint.
      'expo-splash-screen',
      { backgroundColor: '#0d1117', resizeMode: 'contain' },
    ],
    [
      'expo-secure-store',
      {
        // Keystore-encrypted entries cannot be decrypted after a backup
        // restore, so they must be excluded from Android Auto Backup.
        configureAndroidBackup: true,
        faceIDPermission:
          'Unlock GeneratorAI when you return to it, and confirm sensitive actions such as opening a terminal or revoking a device.',
      },
    ],
    ['expo-camera', { cameraPermission: 'Scan the pairing QR code from your GeneratorAI server.' }],
    [
      // Composer attachments (D2): photo library + camera. Files use
      // expo-file-system's own `File.pickFileAsync`, so no document-picker
      // module is added. `microphonePermission: false` because the picker
      // never records video here and expo-audio already declares the mic.
      'expo-image-picker',
      {
        photosPermission: 'Attach photos and screenshots to your prompt.',
        cameraPermission: 'Take a photo to attach to your prompt.',
        microphonePermission: false,
      },
    ],
    [
      // App lock + step-up. The plugin writes NSFaceIDUsageDescription; the
      // value must match `ios.infoPlist` above so the last writer does not
      // silently replace the reviewed string.
      'expo-local-authentication',
      {
        faceIDPermission:
          'Unlock GeneratorAI when you return to it, and confirm sensitive actions such as opening a terminal or revoking a device.',
      },
    ],
    'expo-notifications',
    'expo-web-browser',
    [
      // Voice dictation records to a local file and posts the PCM to the
      // server's own Whisper endpoint; nothing leaves the machine pair.
      'expo-audio',
      { microphonePermission: 'Dictate prompts to your agent, transcribed on your own server.' },
    ],
    // Android 9+ blocks cleartext (`http://`) by default, and the pairing
    // offer for a server on the same LAN is `http://<lan-ip>:<port>`. A
    // release build without this rejects every request after a QR scan that
    // appeared to succeed. Android's network-security-config cannot express
    // CIDR ranges (only exact hosts / domain suffixes), so the
    // loopback/RFC1918/`.local`-only rule is enforced at the application
    // layer instead: `PairingEndpointSchema` in @generatorai/relay-protocol
    // refuses an `http:` endpoint that is not private, and every request the
    // app makes goes to a paired endpoint. SDK 57 dropped the
    // `android.usesCleartextTraffic` config key, hence a plugin.
    './plugins/withCleartextTraffic',
  ],

  experiments: {
    typedRoutes: true,
  },

  // Omitted entirely (not written as undefined/empty) when unset, so
  // `usePushNotifications` can tell "not configured" from "configured".
  ...(easProjectId ? { extra: { eas: { projectId: easProjectId } } } : {}),
};

export default config;
