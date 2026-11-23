"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./AuthProvider";

export function useRedirectIfSignedIn() {
  const { status } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === "ready") router.replace("/overview");
  }, [status, router]);
}
