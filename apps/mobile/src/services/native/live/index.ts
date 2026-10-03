// The live surface of this platform (06 §7.3; MD-15: platform code lives in services/native): the iOS Live Activity
// or the Android Live Update, or null where this client has neither.
import { liveActivityDriver } from './liveActivity';
import { liveUpdateDriver } from './liveUpdate';
import type { LiveSurfaceDriver } from './types';

export type { LiveSurfaceDriver } from './types';

export function liveSurfaceDriver(): LiveSurfaceDriver | null {
  return liveActivityDriver() ?? liveUpdateDriver();
}
