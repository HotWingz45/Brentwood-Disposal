const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS  = 30_000;

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: { maxRetries?: number } = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 4;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const delay = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
