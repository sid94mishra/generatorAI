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

// ── Release version ────────────────────────────────────────────────
// One product, one version: the release workflow stamps the tag onto every
// manifest that ships (scripts/stamp-version.mjs) and passes it here through
// the environment, because this file is TypeScript rather than JSON and
// rewriting it would mean editing source at build time.
//
// The fallback is what a local `expo start` or a plain `expo export` sees. It
// is a placeholder, not a claim — the number that reaches a user always comes
// from the tag.
//
// This is the version PEOPLE see. The store build number is a different thing
// entirely, must only ever increase, and is handled by `autoIncrement` in
// eas.json — do not try to derive one from the other.
const version = process.env['GENERATORAI_VERSION']?.replace(/^v/, '').trim() || '0.1.0';

// ── APNs environment ───────────────────────────────────────────────
// `aps-environment` must be `production` for anything signed for
// distribution (App Store, TestFlight, and the ad-hoc `preview` profile) —
// a `development` entitlement there registers tokens against the sandbox
// gateway and every push is silently dropped. Local dev-client builds keep
// `development`. `EAS_BUILD_PROFILE` is set by EAS Build itself;
// `APS_ENVIRONMENT` (see eas.json) overrides it explicitly.
const easBuildProfile = process.env['EAS_BUILD_PROFILE']?.trim();
const apsEnvironment: 'development' | 'production' =
  process.env['APS_ENVIRONMENT'] === 'production' ||
  (process.env['APS_ENVIRONMENT'] === undefined &&
    (easBuildProfile === 'production' || easBuildProfile === 'preview'))
    ? 'production'
    : 'development';

// ── Permission strings ─────────────────────────────────────────────
// Several plugins write the SAME Info.plist key (expo-camera and
// expo-image-picker both write NSCameraUsageDescription and
// NSMicrophoneUsageDescription; expo-audio writes the microphone key too).
// Config mods run last-plugin-first and a plugin given no string fills in
// Expo's generic "Allow $(PRODUCT_NAME) to access your microphone" — which
// is what shipped before, and what App Review rejects. Every writer is
// therefore handed the one reviewed string below.
//
// Do NOT set `microphonePermission: false` on any plugin: expo-image-picker
// turns that into `tools:node="remove"` on RECORD_AUDIO in the Android
// manifest, which silently breaks dictation on Android.
const CAMERA_USAGE =
  'Scan the pairing QR code shown by your GeneratorAI server, and take photos to attach to a prompt.';
const MICROPHONE_USAGE =
  'Dictate prompts to your agent. Audio is transcribed on your own server, never in the cloud.';
const FACE_ID_USAGE =
  'Unlock GeneratorAI when you return to it, and confirm sensitive actions such as opening a terminal or revoking a device.';

const config: ExpoConfig = {
  name: 'GeneratorAI',
  slug: 'generatorai',
  version,
  orientation: 'default',
  scheme: 'generatorai',
  userInterfaceStyle: 'automatic',
  // Same mark as the desktop app (apps/desktop/resources/icon.png).
  icon: './assets/icon.png',
  // No `newArchEnabled`: the New Architecture is unconditional from SDK 57,
  // and the key was removed from the config type.

  ios: {
    supportsTablet: true,
    bundleIdentifier: 'dev.generatorai.app',
    // Opaque 1024×1024 (no alpha): App Store Connect rejects an iOS icon
    // with transparency, and iOS paints transparent pixels black anyway.
    // It is icon.png flattened onto the splash colour (#0d1117); regenerate
    // it the same way if the mark changes (README "iOS").
    icon: './assets/icon-ios.png',
    infoPlist: {
      // The relay + E2EE stack is real cryptography, so this is NOT exempt.
      // Claiming exemption to skip the App Store prompt would be a false
      // declaration; the correct move is a proper CCATS/self-classification.
      ITSAppUsesNonExemptEncryption: true,
      NSCameraUsageDescription: CAMERA_USAGE,
      NSMicrophoneUsageDescription: MICROPHONE_USAGE,
      // Both uses are real (D8): `AppLockGate` (src/auth/AppLock.tsx) locks the
      // app on cold start and after the configured grace, and `requireStepUp`
      // (src/auth/stepUp.ts) confirms terminal/browser/computer and admin
      // actions and device revocation. Keep this string in step with the
      // `faceIDPermission` plugin value below — Apple reviews the one that
      // ends up in Info.plist, and the plugin writes the same key.
      NSFaceIDUsageDescription: FACE_ID_USAGE,
      // Loopback/LAN endpoints are plain HTTP by design. There is NO
      // message-level encryption above the transport (relay-protocol's
      // e2ee.ts is unwired); requests are DPoP-signed, which authenticates
      // them but does not hide their contents from the local network.
      NSAppTransportSecurity: {
        NSAllowsLocalNetworking: true,
      },
      // The app never browses Bonjour; it connects to the address in the
      // pairing QR. Saying "discover" would promise something it does not do.
      NSLocalNetworkUsageDescription:
        'Connect to the GeneratorAI server you paired with when it is on the same network as this device.',
      // Only what is used: `remote-notification` for approval pushes.
      // `processing` (BGProcessingTask) has no registered task and requires
      // BGTaskSchedulerPermittedIdentifiers, and `audio` would claim
      // background playback the app does not do — both are review flags.
      // expo-audio's plugin adds `audio` unless `enableBackgroundPlayback`
      // is false (set below).
      UIBackgroundModes: ['remote-notification'],
    },
  },

  android: {
    package: 'dev.generatorai.app',
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#0d1117' },
    // Predictive back stays OFF. With it on, the manifest gets
    // `enableOnBackInvokedCallback="true"` and Android 13+ dispatches back
    // through OnBackInvokedDispatcher, which React Native 0.86 does not
    // forward to JS: no `hardwareBackPress` listener ever ran, so the
    // navigator could not pop, sheets could not close and every back press
    // closed the app (found on an API 35 emulator). Re-enable only once RN
    // routes the callback to BackHandler, and verify back on a device.
    predictiveBackGestureEnabled: false,
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
      // `image` is required on Android: the generated splash theme references
      // `@drawable/splashscreen_logo`, and without an image the resource is
      // never emitted, so `processDebugResources` fails to link.
      { backgroundColor: '#0d1117', image: './assets/icon.png', imageWidth: 96, resizeMode: 'contain' },
    ],
    [
      'expo-secure-store',
      {
        // Keystore-encrypted entries cannot be decrypted after a backup
        // restore, so they must be excluded from Android Auto Backup.
        configureAndroidBackup: true,
        faceIDPermission: FACE_ID_USAGE,
      },
    ],
    [
      // The camera never records video with sound, but the plugin writes the
      // microphone key regardless — give it the reviewed string (see above).
      'expo-camera',
      { cameraPermission: CAMERA_USAGE, microphonePermission: MICROPHONE_USAGE },
    ],
    [
      // Composer attachments (D2): photo library + camera. Files use
      // expo-file-system's own `File.pickFileAsync`, so no document-picker
      // module is added. The picker never records video, but
      // `microphonePermission: false` would strip RECORD_AUDIO from the
      // Android manifest (dictation) and let another plugin write the generic
      // iOS string, so it gets the shared string instead.
      'expo-image-picker',
      {
        photosPermission: 'Attach photos and screenshots to your prompt.',
        cameraPermission: CAMERA_USAGE,
        microphonePermission: MICROPHONE_USAGE,
      },
    ],
    [
      // App lock + step-up. The plugin writes NSFaceIDUsageDescription; the
      // value must match `ios.infoPlist` above so the last writer does not
      // silently replace the reviewed string.
      'expo-local-authentication',
      {
        faceIDPermission: FACE_ID_USAGE,
      },
    ],
    // `mode` writes `aps-environment`; see `apsEnvironment` above.
    ['expo-notifications', { mode: apsEnvironment }],
    'expo-web-browser',
    [
      // Voice dictation records to a local file and posts the PCM to the
      // server's own Whisper endpoint; nothing leaves the machine pair.
      // Read-aloud stops when the app leaves the foreground, so no
      // background playback: that would add UIBackgroundModes `audio` and an
      // Android media foreground service the app has no use for.
      'expo-audio',
      { microphonePermission: MICROPHONE_USAGE, enableBackgroundPlayback: false },
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
    './plugins/withShadowNodeRaceFix',
  ],

  experiments: {
    typedRoutes: true,
  },

  // Omitted entirely (not written as undefined/empty) when unset, so
  // `usePushNotifications` can tell "not configured" from "configured".
  ...(easProjectId ? { extra: { eas: { projectId: easProjectId } } } : {}),
};

export default config;
