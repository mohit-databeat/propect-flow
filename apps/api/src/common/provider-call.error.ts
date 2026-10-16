
export type ProviderErrorCode =
  | "TIMEOUT"
  | "NETWORK"
  | "RATE_LIMITED"
  | "SERVER_ERROR"
  | "AUTH"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "VALIDATION"
  | "NOT_CONFIGURED"
  | "UNAVAILABLE"
  | "UNKNOWN";

export interface ProviderCallErrorOptions {
  retryable: boolean;
  statusCode?: number;

  retryAfterMs?: number;
  cause?: unknown;
}

export class ProviderCallError extends Error {
  readonly providerKey: string;
  readonly code: ProviderErrorCode;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;
  override readonly cause?: unknown;

  constructor(providerKey: string, code: ProviderErrorCode, message: string, opts: ProviderCallErrorOptions) {
    super(message);
    this.name = "ProviderCallError";
    this.providerKey = providerKey;
    this.code = code;
    this.retryable = opts.retryable;
    this.statusCode = opts.statusCode;
    this.retryAfterMs = opts.retryAfterMs;
    this.cause = opts.cause;
  }

  static fromHttp(providerKey: string, status: number, message: string, opts: { retryAfterMs?: number; cause?: unknown } = {}): ProviderCallError {
    const map: Record<number, { code: ProviderErrorCode; retryable: boolean }> = {
      400: { code: "BAD_REQUEST", retryable: false },
      401: { code: "AUTH", retryable: false },
      403: { code: "FORBIDDEN", retryable: false },
      404: { code: "NOT_FOUND", retryable: false },
      408: { code: "TIMEOUT", retryable: true },
      422: { code: "VALIDATION", retryable: false },
      425: { code: "TIMEOUT", retryable: true },
      429: { code: "RATE_LIMITED", retryable: true },
    };
    const entry = map[status] ?? (status >= 500 ? { code: "SERVER_ERROR" as const, retryable: true } : { code: "UNKNOWN" as const, retryable: false });
    return new ProviderCallError(providerKey, entry.code, message, { retryable: entry.retryable, statusCode: status, retryAfterMs: opts.retryAfterMs, cause: opts.cause });
  }

  static fromUnknown(providerKey: string, err: unknown): ProviderCallError {
    if (err instanceof ProviderCallError) return err;
    if (err && typeof err === "object" && "name" in err && (err as { name?: string }).name === "AbortError") {
      return new ProviderCallError(providerKey, "TIMEOUT", "Request timed out", { retryable: true, cause: err });
    }
    const status = (err as { status?: unknown })?.status ?? (err as { response?: { status?: unknown } })?.response?.status;
    if (typeof status === "number") {
      return ProviderCallError.fromHttp(providerKey, status, err instanceof Error ? err.message : "Provider error", { cause: err });
    }
    return new ProviderCallError(providerKey, "NETWORK", err instanceof Error ? err.message : "Unknown provider error", { retryable: true, cause: err });
  }
}
