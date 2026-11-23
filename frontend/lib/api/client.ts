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
