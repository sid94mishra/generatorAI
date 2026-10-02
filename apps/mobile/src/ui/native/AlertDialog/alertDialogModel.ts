// AlertDialog plumbing (03 MP-29): the message text, the step-up hook the app pushes in, and the request channel to
// a mounted AlertDialogHost (Android's Compose dialog). Pure apart from the module-level registrations.
import type { AlertDialogOptions, StepUpHandler } from './AlertDialog.types';

export function alertMessage({ message, impact }: Pick<AlertDialogOptions, 'message' | 'impact'>): string | undefined {
  const lines = [message, ...(impact ?? [])].filter((l): l is string => Boolean(l));
  return lines.length ? lines.join('\n') : undefined;
}

let stepUp: StepUpHandler | null = null;

/** The app registers the biometric step-up (services/auth/stepUp) once at start (like the preference bridge). */
export function setStepUpHandler(handler: StepUpHandler | null): void {
  stepUp = handler;
}

/** After a confirm: run the step-up when asked for. No handler registered → the confirm does not pass. */
export async function afterConfirm(options: AlertDialogOptions): Promise<boolean> {
  if (!options.requireStepUp) return true;
  if (!stepUp) return false;
  try {
    return await stepUp(options.title);
  } catch {
    return false;
  }
}

export interface AlertRequest {
  options: AlertDialogOptions;
  resolve: (confirmed: boolean) => void;
}

type HostListener = (request: AlertRequest | null) => void;
let host: HostListener | null = null;

/** A mounted AlertDialogHost receives requests; unmounting clears it. */
export function registerAlertHost(listener: HostListener | null): void {
  host = listener;
}

/** Hands the request to the host; false when no host is mounted (the caller uses the platform alert). */
export function presentToHost(request: AlertRequest): boolean {
  if (!host) return false;
  host(request);
  return true;
}
