import { ProviderCallError } from "./provider-call.error";

export interface CallPolicy {
  timeoutMs: number;
  maxAttempts: number;
  backoffMs: number;
}

export const POLICIES = {
  ai: { timeoutMs: 60_000, maxAttempts: 3, backoffMs: 1_000 },
  connector: { timeoutMs: 30_000, maxAttempts: 3, backoffMs: 1_000 },
  enrichment: { timeoutMs: 15_000, maxAttempts: 3, backoffMs: 500 },
  outbound: { timeoutMs: 15_000, maxAttempts: 2, backoffMs: 1_000 },
} satisfies Record<string, CallPolicy>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_BACKOFF_MS = 30_000;

export async function withPolicy<T>(policy: CallPolicy, providerKey: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  let lastErr: ProviderCallError | undefined;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
    try {
      const result = await fn(controller.signal);
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      const pce = err instanceof ProviderCallError ? err : ProviderCallError.fromUnknown(providerKey, err);
      lastErr = pce;
      if (!pce.retryable || attempt === policy.maxAttempts) throw pce;
      const delay = Math.min(pce.retryAfterMs ?? policy.backoffMs * attempt, MAX_BACKOFF_MS);
      await sleep(delay);
    }
  }

  throw lastErr ?? new ProviderCallError(providerKey, "UNKNOWN", "withPolicy exhausted attempts", { retryable: false });
}
