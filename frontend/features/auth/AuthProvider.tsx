"use client";

import { onAuthStateChanged } from "firebase/auth";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { logout as firebaseLogout } from "@/lib/firebase/auth";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase/client";
import type { AppUser, SessionPayload } from "@/types";

type AuthStatus = "loading" | "signed_out" | "ready" | "error";

interface AuthContextValue {
  status: AuthStatus;
  user: AppUser | null;
  permissions: string[];
  error: string | null;
  can: (...permissions: string[]) => boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(isFirebaseConfigured ? "loading" : "error");
  const [user, setUser] = useState<AppUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(
    isFirebaseConfigured ? null : "Firebase is not configured. Copy frontend/.env.example to .env.local and fill in the values.",
  );

  /** Exchanges the Firebase sign-in for the MongoDB profile + DB-backed permissions. */
  const loadSession = useCallback(async () => {
    try {
      const res = await apiFetch<SessionPayload>("/auth/session", { method: "POST", body: "{}" });
      setUser(res.data.user);
      setPermissions(res.data.permissions);
      setError(null);
      setStatus("ready");
    } catch (err) {
      setUser(null);
      setPermissions([]);
      setError(err instanceof ApiError ? err.message : "Could not load your profile.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured) return;
    // Firebase persists the session and refreshes tokens; we only react to its state.
    return onAuthStateChanged(getFirebaseAuth(), (fbUser) => {
      if (!fbUser) {
        setUser(null);
        setPermissions([]);
        setStatus("signed_out");
        return;
      }
      setStatus("loading");
      void loadSession();
    });
  }, [loadSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      permissions,
      error,
      can: (...required) => required.length === 0 || required.some((p) => permissions.includes(p)),
      refresh: loadSession,
      signOut: async () => {
        await firebaseLogout();
      },
    }),
    [status, user, permissions, error, loadSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
