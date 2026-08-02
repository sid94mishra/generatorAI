/**
 * HTTP retry utility with exponential backoff.
 * Retries on 429 (rate limited) and 5xx (server errors).
 */
export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, maxDelayMs = 30000 } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRetryable = isRetryableError(err);
      if (!isRetryable || attempt === maxRetries) throw err;

      const retryAfter = getRetryAfterMs(err);
      const delay = retryAfter ?? Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      await sleep(delay);
    }
  }
  throw lastError;
}

function isRetryableError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: number }).status;
    return status === 429 || (status >= 500 && status < 600);
  }
  // Network errors
  if (err instanceof TypeError && err.message.includes('fetch')) return true;
  return false;
}

function getRetryAfterMs(err: unknown): number | undefined {
  if (err && typeof err === 'object' && 'headers' in err) {
    const headers = (err as { headers?: Headers }).headers;
    const retryAfter = headers?.get?.('retry-after');
    if (retryAfter) {
      const seconds = parseInt(retryAfter, 10);
      if (!Number.isNaN(seconds)) return seconds * 1000;
    }
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
