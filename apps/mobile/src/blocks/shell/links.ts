import { serverRegistry } from '../../services/auth/serverRegistry';
import { redirectLink } from '../../services/navigation/links';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return redirectLink(path, serverRegistry.read().activeServerId);
}
