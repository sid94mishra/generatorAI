/**
 * Settle with `work`, or reject after `ms` with a message naming `what`.
 *
 * The timer is always cleared, so a deadline never outlives the work it bounds.
 * `work` itself is not cancelled — callers that need that must abort it.
 */
export async function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms trying to ${what}.`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
