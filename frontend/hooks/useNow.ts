"use client";

import { useEffect, useState } from "react";

/** Current time in ms, refreshed on an interval so deadline-dependent UI flips without a reload. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
