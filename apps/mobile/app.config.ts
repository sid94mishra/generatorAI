import type { ExpoConfig } from 'expo/config';

// ────────────────────────────────────────────────────────────────
// Expo config.
//
// Continuous Native Generation: `ios/` and `android/` are NOT committed;
// `expo prebuild` regenerates them from this file, so every native setting
// lives here rather than in an Xcode project that drifts.
// ────────────────────────────────────────────────────────────────

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
      NSFaceIDUsageDescription:
        'Unlock GeneratorAI and confirm sensitive actions such as granting terminal access.',
      // Loopback/LAN endpoints are plain HTTP by design; the payload is
      // still end-to-end encrypted above the transport.
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
        faceIDPermission: 'Unlock GeneratorAI with Face ID.',
      },
    ],
    ['expo-camera', { cameraPermission: 'Scan the pairing QR code from your GeneratorAI server.' }],
    'expo-local-authentication',
    'expo-notifications',
    'expo-web-browser',
  ],

  experiments: {
    typedRoutes: true,
  },
};

export default config;
