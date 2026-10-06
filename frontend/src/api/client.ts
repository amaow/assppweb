import { getAccessToken } from "../components/Auth/PasswordGate";

const BASE_URL = "";

export function authHeaders(): Record<string, string> {
  const token = getAccessToken();
  return token ? { "X-Access-Token": token } : {};
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiPost<T>(path: string, body?: any): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
}

/** POST that returns status + parsed body without throwing (for 428 etc.). */
export async function apiPostRaw<T>(
  path: string,
  body?: any,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: body ? JSON.stringify(body) : undefined,
  });
  let parsed: T;
  try {
    parsed = await res.json();
  } catch {
    parsed = {} as T;
  }
  return { status: res.status, body: parsed };
}
