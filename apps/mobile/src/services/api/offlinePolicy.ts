import { onlineManager } from '@tanstack/react-query';

/** Transport reconnection remains possible while product writes fail immediately. */
export function assertServerWriteAllowed(path: string, method = 'GET'): void {
  if (onlineManager.isOnline() || ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return;
  if (/^\/api\/stream\/connections(?:\/|$)/.test(path)) return;
  throw new Error('Server offline');
}
