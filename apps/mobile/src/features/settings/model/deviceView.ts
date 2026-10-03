// Settings › Security / Diagnostics: how this device's key protection, a paired device's platform and an uptime read.
// Pure.

/** Where the device key lives (Diagnostics "Key protection", Security "This device"). */
export function keyProtection(backing: string): { value: string; detail: string; hardware: boolean } {
  switch (backing) {
    case 'secure-enclave':
      return { value: 'Hardware', detail: 'Secure Enclave', hardware: true };
    case 'strongbox':
      return { value: 'Hardware', detail: 'StrongBox', hardware: true };
    case 'keystore':
      return { value: 'Hardware', detail: 'Android Keystore', hardware: true };
    case 'web-preview':
      return { value: 'Not protected', detail: 'Web preview build', hardware: false };
    default:
      return { value: 'Software', detail: 'This device has no secure element', hardware: false };
  }
}

const PLATFORM: Record<string, { label: string; icon: 'device' | 'computer' | 'browser' | 'terminal' | 'mcp' }> = {
  mobile: { label: 'Phone', icon: 'device' },
  ios: { label: 'iPhone or iPad', icon: 'device' },
  android: { label: 'Android', icon: 'device' },
  desktop: { label: 'Desktop', icon: 'computer' },
  web: { label: 'Browser', icon: 'browser' },
  cli: { label: 'Command line', icon: 'terminal' },
  mcp: { label: 'MCP client', icon: 'mcp' },
};

export function platformView(platform: string | null | undefined): { label: string; icon: 'device' | 'computer' | 'browser' | 'terminal' | 'mcp' } {
  return PLATFORM[platform ?? ''] ?? { label: platform || 'Device', icon: 'device' };
}

/** "3d 4h" / "2h 5m" / "12m". */
export function uptimeLabel(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
