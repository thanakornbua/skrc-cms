import { fetchAuthSession } from "aws-amplify/auth";

const REGWEEK_API_URL = import.meta.env.VITE_REGWEEK_API_URL;
const EC2_API_URL = import.meta.env.VITE_API_BASE_URL;
const CONTROL_API_URL = import.meta.env.VITE_CONTROL_API_URL;

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Array<{ field: string; message: string }>;

  constructor(
    status: number,
    code: string,
    message: string,
    fields?: Array<{ field: string; message: string }>
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/** The browser has no usable Cognito ID-token session for a protected call. */
export class SessionUnavailableError extends Error {
  constructor() { super("Session expired—sign in again."); }
}

/**
 * The request never reached (or never returned from) the server — a dropped
 * wifi/hotspot on venue-day, not an application-level failure. Distinguished
 * from `ApiClientError` so callers can tell "the connection dropped, unknown
 * whether it applied" apart from "the server rejected this."
 */
export class NetworkError extends Error {
  constructor() { super("Network error — check the connection and try again."); }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string };
  fields?: Array<{ field: string; message: string }>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Gateway-level statuses that, behind Caddy/an ALB on a flaky link, generally mean the request never reached the app. */
const RETRYABLE_STATUSES = new Set([502, 503, 504]);

/**
 * Retries only failures that indicate the request never completed a round trip
 * (fetch threw, or a gateway-level 502/503/504) — never a 4xx/409/normal 5xx
 * application response, which is retried at most once already for auth above.
 * Safe to use unconditionally for GET; mutation call sites opt in explicitly
 * only for routes documented idempotent in API.md.
 */
async function fetchWithRetry(url: string, init: RequestInit, attempts: number): Promise<Response> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, init);
      if (!RETRYABLE_STATUSES.has(res.status) || attempt === attempts) return res;
    } catch {
      if (attempt === attempts) throw new NetworkError();
    }
    await sleep(400 * 2 ** (attempt - 1));
  }
  throw new NetworkError();
}

async function authHeaders(forceRefresh = false): Promise<Record<string, string>> {
  let session: Awaited<ReturnType<typeof fetchAuthSession>>;
  try {
    session = await fetchAuthSession({ forceRefresh });
  } catch {
    throw new SessionUnavailableError();
  }
  const token = session.tokens?.idToken?.toString();
  if (!token) throw new SessionUnavailableError();
  return { authorization: `Bearer ${token}` };
}

async function callJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  retryUnauthorized = false,
  retryNetwork?: boolean
): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  // GET is always safe to retry on a dropped connection; mutations only retry
  // when the call site explicitly says the route is idempotent (API.md).
  const attempts = (retryNetwork ?? method === "GET") ? 3 : 1;
  async function request(forceRefresh: boolean): Promise<{ res: Response; body: ApiErrorBody }> {
    const headers = {
      "content-type": "application/json",
      ...(await authHeaders(forceRefresh)),
      ...(init.headers as Record<string, string> | undefined),
    };
    const res = await fetchWithRetry(`${baseUrl}${path}`, { ...init, headers }, attempts);
    return { res, body: await res.json().catch((): ApiErrorBody => ({})) };
  }
  let { res, body } = await request(false);
  // A control-plane request may encounter an expired cached ID token. Refresh
  // once only; an invalid session must remain a visible authentication error.
  if (res.status === 401 && retryUnauthorized) ({ res, body } = await request(true));

  if (!res.ok) {
    throw new ApiClientError(
      res.status,
      body?.error?.code ?? "UNKNOWN",
      body?.error?.message ?? "Request failed",
      body?.fields
    );
  }
  return body as T;
}

/**
 * Set on a mutating call only when its route is documented idempotent in
 * API.md (repeat calls return the current/resulting state, never double-apply)
 * — e.g. check-in, approve/reject, disqualify/reinstate, revoke. Leave unset
 * for anything that creates a new record each call (apply penalty, create
 * rule, correct/void a run, submit a run-affecting action) since a lost
 * response there must surface as a visible error, not a silent retry.
 */
export interface RetryOptions { retryNetwork?: boolean }

/** Calls the registration-week Lambda (via API Gateway), attaching the Cognito ID token. */
export function regweekJson<T>(path: string, init: RequestInit = {}, options: RetryOptions = {}): Promise<T> {
  return callJson<T>(REGWEEK_API_URL, path, init, false, options.retryNetwork);
}

/** Calls the competition-day EC2 API, attaching the Cognito ID token. */
export function ec2Json<T>(path: string, init: RequestInit = {}, options: RetryOptions = {}): Promise<T> {
  return callJson<T>(EC2_API_URL, path, init, false, options.retryNetwork);
}

/** Calls the always-available admin deployment control plane. */
export function controlJson<T>(path: string, init: RequestInit = {}, options: RetryOptions = {}): Promise<T> {
  return callJson<T>(CONTROL_API_URL, path, init, true, options.retryNetwork);
}

/** Calls a deliberately unauthenticated public EC2 endpoint. */
export async function publicEc2Json<T>(path: string): Promise<T> {
  const res = await fetchWithRetry(`${EC2_API_URL}${path}`, { headers: { "content-type": "application/json" } }, 3);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiClientError(res.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? "Request failed");
  return body as T;
}
