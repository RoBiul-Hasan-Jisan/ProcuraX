"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch, type ApiEnvelope } from "@/lib/api/client";

interface State<T> {
  key: string | null;
  data: T | null;
  pagination: ApiEnvelope<T>["pagination"];
  error: string | null;
}

/**
 * GET helper with loading/error state. `path = null` disables the request.
 * `loading` is derived (never set synchronously inside the effect) so changing the path or calling
 * reload() shows a loading state until the new response arrives.
 */
export function useApi<T>(path: string | null) {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<State<T>>({ key: null, data: null, pagination: null, error: null });
  const key = path === null ? null : `${path}#${tick}`;

  useEffect(() => {
    if (path === null) return;
    let active = true;
    const k = `${path}#${tick}`;
    apiFetch<T>(path)
      .then((res) => {
        if (active) setState({ key: k, data: res.data, pagination: res.pagination, error: null });
      })
      .catch((e: unknown) => {
        if (active) setState((s) => ({ ...s, key: k, error: e instanceof Error ? e.message : "Request failed" }));
      });
    return () => {
      active = false;
    };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const loading = key !== null && state.key !== key;
  return { data: state.data, pagination: state.pagination, error: loading ? null : state.error, loading, reload };
}

/** Runs a mutating request; exposes pending + error state for forms and buttons. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <R,>(fn: () => Promise<R>): Promise<R | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);
  return { pending, error, run, clearError: () => setError(null) };
}
