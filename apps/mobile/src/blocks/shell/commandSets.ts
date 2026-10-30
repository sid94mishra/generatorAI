// Which commands mobile offers where (06 §3.9, §3.10; MD-143, MD-146). Pure.
import { NAV_DESTINATIONS, type CommandId } from '@generatorai/shared/ui-contract';

/** Palette "Actions" available on mobile now (board order; New workflow / project open the legacy create UIs). */
export const MOBILE_PALETTE_ACTIONS = ['chat.new', 'workflow.new', 'project.new', 'theme.toggle', 'app.settings'] as const satisfies readonly CommandId[];

/** Global commands the hardware keyboard drives on mobile (06 §3.10). */
export const MOBILE_KEY_COMMANDS = [
  'palette.toggle',
  'chat.new',
  'workflow.new',
  ...NAV_DESTINATIONS.map((d) => d.command),
  'app.settings',
  'nav.back',
  'sidebar.toggle',
  'dock.toggle',
] as const satisfies readonly CommandId[];

const PALETTE_KEYS: readonly CommandId[] = ['palette.next', 'palette.prev', 'palette.close'];
const OVERLAY_KEYS: readonly CommandId[] = ['dock.dismiss'];

/** The commands registered for the current state (exported for tests). */
export function activeKeyCommandIds(state: { palette: boolean; overlayOpen: boolean }): CommandId[] {
  return [...MOBILE_KEY_COMMANDS, ...(state.palette ? PALETTE_KEYS : state.overlayOpen ? OVERLAY_KEYS : [])];
}
