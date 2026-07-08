const ETHERSCAN_BASE_URL = "https://api.etherscan.io/v2/api";
const FREE_TIER_INTERVAL_MS = 360;
const DEFAULT_CACHE_TTL_MS = 120_000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

export class TraceError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 500,
    public warnings: string[] = [],
  ) {
    super(message);
  }
}

let queue = Promise.resolve();
let lastStartedAt = 0;
const responseCache = new Map<string, CacheEntry<unknown>>();

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function enqueue<T>(job: () => Promise<T>) {
  const run = async () => {
    const elapsed = Date.now() - lastStartedAt;
    const waitMs = Math.max(0, FREE_TIER_INTERVAL_MS - elapsed);
    if (waitMs > 0) await delay(waitMs);
    lastStartedAt = Date.now();
    return job();
  };

  const result = queue.then(run, run);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function getApiKey() {
  const key = process.env.ETHERSCAN_API_KEY?.trim();
  if (!key) {
    throw new TraceError(
      "missing-api-key",
      "ETHERSCAN_API_KEY is not set. Add it to .env.local and restart the dev server.",
      500,
    );
  }
  return key;
}

export async function etherscanRequest<T>(
  params: Record<string, string>,
  options: { cacheTtlMs?: number } = {},
) {
  const apiKey = getApiKey();
  const url = new URL(ETHERSCAN_BASE_URL);

  Object.entries({ ...params, apikey: apiKey }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const cacheKey = url.toString().replace(apiKey, "__API_KEY__");
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T;

  const value = await enqueue(async () => {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new TraceError(
        "etherscan-http-error",
        `Etherscan returned HTTP ${response.status}.`,
        502,
      );
    }

    const json = (await response.json()) as T;
    const maybeStatus = json as { status?: string; message?: string; result?: unknown };
    const message = `${maybeStatus.message ?? ""}: ${String(maybeStatus.result ?? "")}`;

    if (maybeStatus.status === "0" && /rate limit/i.test(message)) {
      throw new TraceError("etherscan-rate-limit", message, 429);
    }
    if (/invalid api key/i.test(message)) {
      throw new TraceError("invalid-api-key", message, 401);
    }

    return json;
  });

  responseCache.set(cacheKey, {
    value,
    expiresAt: Date.now() + (options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS),
  });

  return value;
}

export function __resetEtherscanForTests() {
  queue = Promise.resolve();
  lastStartedAt = 0;
  responseCache.clear();
}
