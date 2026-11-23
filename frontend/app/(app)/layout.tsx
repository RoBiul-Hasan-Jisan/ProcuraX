"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/features/auth/AuthProvider";

function AccountGate({ title, message }: { title: string; message: string }) {
  const { signOut, refresh } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="max-w-md rounded-md border border-line bg-white p-6 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-navy-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="secondary" onClick={() => void refresh()}>Check again</Button>
          <Button variant="ghost" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </div>
    </div>
  );
}

/** Protects every route in the (app) group: signed in, profile loaded, account active. */
export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const { status, user, error, refresh } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === "signed_out") router.replace("/login");
  }, [status, router]);

  if (status === "loading" || status === "signed_out") return <LoadingState label="Loading your workspace…" />;
  if (status === "error") return <ErrorState message={error ?? "Something went wrong."} onRetry={() => void refresh()} />;
  if (!user) return null;

  if (user.status === "pending") {
    return <AccountGate title="Awaiting approval" message="Your account was created but an administrator has not activated it or assigned your role yet." />;
  }
  if (user.status === "suspended") {
    return <AccountGate title="Account suspended" message="Your account has been suspended. Contact a system administrator." />;
  }
  return <AppShell>{children}</AppShell>;
}
