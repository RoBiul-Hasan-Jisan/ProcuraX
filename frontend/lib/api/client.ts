import { getFirebaseAuth } from "@/lib/firebase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000/api/v1";

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
  pagination: { page: number; limit: number; total: number; totalPages: number } | null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** Calls the Express API with a fresh Firebase ID token (Firebase handles refresh). */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new ApiError(401, "Not signed in", "UNAUTHENTICATED");
  const token = await user.getIdToken();

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
  } catch {
    throw new ApiError(0, "Cannot reach the SteelProcure API. Is the backend running?", "NETWORK");
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body?.message ?? `Request failed (${res.status})`, body?.code);
  return body as ApiEnvelope<T>;
}

async function authToken(): Promise<string> {
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new ApiError(401, "Not signed in", "UNAUTHENTICATED");
  return user.getIdToken();
}

async function rawFetch(path: string, init: RequestInit): Promise<Response> {
  const token = await authToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  } catch {
    throw new ApiError(0, "Cannot reach the SteelProcure API. Is the backend running?", "NETWORK");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.message ?? `Request failed (${res.status})`, body?.code);
  }
  return res;
}

/** Authenticated file download (documents, report exports). The token goes in a header, never in a URL. */
export async function apiBlob(path: string): Promise<{ blob: Blob; filename: string | null }> {
  const res = await rawFetch(path, {});
  return { blob: await res.blob(), filename: filenameFromDisposition(res.headers.get("Content-Disposition")) };
}

/** Multipart upload. The browser sets the multipart boundary itself, so no Content-Type is given here. */
export async function apiUpload<T>(path: string, form: FormData): Promise<ApiEnvelope<T>> {
  const res = await rawFetch(path, { method: "POST", body: form });
  return (await res.json()) as ApiEnvelope<T>;
}

export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) { try { return decodeURIComponent(star[1]); } catch { /* fall through */ } }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ?? null;
}

/** Saves a blob through a temporary link; used after an authenticated download. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
