import { LogoMark } from "@/components/brand/Logo";
import type { ReactNode } from "react";

export function AuthCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3 text-white">
          <LogoMark className="h-10 w-10" />
          <div>
            <div className="text-lg font-semibold leading-tight">ProcuraX</div>
            <div className="text-xs text-steel-300">Intelligent Procurement. Smarter Inventory. Better Decisions.</div>
          </div>
        </div>
        <div className="rounded-md bg-white p-6 shadow-lg">
          <h1 className="text-lg font-semibold text-navy-900">{title}</h1>
          <p className="mb-5 mt-1 text-sm text-slate-500">{subtitle}</p>
          {children}
        </div>
        <p className="mt-4 text-center text-xs text-steel-300">
          Independent prototype using synthetic data. Not affiliated with any steel manufacturer.
        </p>
      </div>
    </div>
  );
}

export function FieldError({ message }: { message?: string }) {
  return message ? <p role="alert" className="mt-1 text-xs text-danger">{message}</p> : null;
}
