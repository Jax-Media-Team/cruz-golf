/**
 * Exponential-backoff retry helper for flaky upstream calls (OpenAI, network blips, etc.).
 * Used server-side. Client-side fetches handle their own retry via Supabase's SDK.
 */

type Options = {
  /** Max attempts (default 4). */
  attempts?: number;
  /** Base delay in ms (default 400). Real wait = base × 2^attempt + jitter. */
  baseMs?: number;
  /** Predicate: should we retry on this error? Default = retry on 429/503/timeout/network. */
  isRetryable?: (err: unknown) => boolean;
  /** Optional signal to cancel the retry loop. */
  signal?: AbortSignal;
};

const defaultIsRetryable = (err: unknown): boolean => {
  const msg = (err as { message?: string })?.message?.toLowerCase() ?? "";
  if (msg.includes("rate") || msg.includes("429")) return true;
  if (msg.includes("503") || msg.includes("502") || msg.includes("504")) return true;
  if (msg.includes("timeout") || msg.includes("aborted")) return true;
  if (msg.includes("etimedout") || msg.includes("econnreset")) return true;
  if (msg.includes("network") || msg.includes("fetch failed")) return true;
  return false;
};

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export async function retry<T>(fn: () => Promise<T>, opts: Options = {}): Promise<T> {
  const attempts = opts.attempts ?? 4;
  const baseMs = opts.baseMs ?? 400;
  const isRetryable = opts.isRetryable ?? defaultIsRetryable;

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    if (opts.signal?.aborted) throw new Error("aborted");
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      if (!isRetryable(err)) break;
      const jitter = Math.floor(Math.random() * baseMs);
      await sleep(baseMs * 2 ** i + jitter);
    }
  }
  throw lastErr;
}
