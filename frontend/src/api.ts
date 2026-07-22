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

async function authHeaders(): Promise<Record<string, string>> {
  const session = await fetchAuthSession();
  const token = session.tokens?.idToken?.toString();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function callJson<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = {
    "content-type": "application/json",
    ...(await authHeaders()),
    ...(init.headers as Record<string, string> | undefined),
  };
  const res = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const body = await res.json().catch(() => ({}));

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

/** Calls the registration-week Lambda (via API Gateway), attaching the Cognito ID token. */
export function regweekJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return callJson<T>(REGWEEK_API_URL, path, init);
}

/** Calls the competition-day EC2 API, attaching the Cognito ID token. */
export function ec2Json<T>(path: string, init: RequestInit = {}): Promise<T> {
  return callJson<T>(EC2_API_URL, path, init);
}

/** Calls the always-available admin deployment control plane. */
export function controlJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  return callJson<T>(CONTROL_API_URL, path, init);
}

/** Calls a deliberately unauthenticated public EC2 endpoint. */
export async function publicEc2Json<T>(path: string): Promise<T> {
  const res = await fetch(`${EC2_API_URL}${path}`, { headers: { "content-type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiClientError(res.status, body?.error?.code ?? "UNKNOWN", body?.error?.message ?? "Request failed");
  return body as T;
}
