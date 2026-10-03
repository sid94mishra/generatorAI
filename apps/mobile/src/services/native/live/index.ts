// The live surface of this platform (06 §7.3; MD-15: platform code lives in services/native): the iOS Live Activity,
// or null where none is built in this client.
import { liveActivityDriver } from './liveActivity';
import type { LiveSurfaceDriver } from './types';

export type { LiveSurfaceDriver } from './types';

export function liveSurfaceDriver(): LiveSurfaceDriver | null {
  return liveActivityDriver();
}
