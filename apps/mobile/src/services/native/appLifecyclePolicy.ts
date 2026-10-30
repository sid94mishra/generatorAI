import { Platform } from 'react-native';
/** Android allows a brief app-switch grace; Live Update service scopes join in M9. */
export const BACKGROUND_STREAM_GRACE_MS = Platform.OS === 'android' ? 10_000 : 0;
