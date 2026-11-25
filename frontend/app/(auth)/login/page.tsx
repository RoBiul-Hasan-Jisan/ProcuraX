"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthCard, FieldError } from "@/features/auth/AuthCard";
import { useRedirectIfSignedIn } from "@/features/auth/useRedirectIfSignedIn";
import { friendlyAuthError, loginWithEmail, loginWithGoogle } from "@/lib/firebase/auth";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
type Values = z.infer<typeof loginSchema>;

// Demo accounts created by `npm run seed` (backend). Prototype/demo use only.
const DEMO_PASSWORD = "demo@12345";
const DEMO_ACCOUNTS = [
  { role: "System Admin", email: "admin@demo.steelprocure.example" },
  { role: "Procurement Manager", email: "procurement@demo.steelprocure.example" },
  { role: "Department Manager", email: "deptmanager@demo.steelprocure.example" },
  { role: "Inventory Officer", email: "inventory@demo.steelprocure.example" },
  { role: "Finance Officer", email: "finance@demo.steelprocure.example" },
  { role: "Management", email: "executive@demo.steelprocure.example" },
  { role: "Supplier 1", email: "supplier@demo.steelprocure.example" },
  { role: "Supplier 2", email: "supplier2@demo.steelprocure.example" },
  { role: "Supplier 3", email: "supplier3@demo.steelprocure.example" },
];
// Set NEXT_PUBLIC_SHOW_DEMO_LOGINS=false in frontend/.env.local to hide the box.
const SHOW_DEMO = process.env.NEXT_PUBLIC_SHOW_DEMO_LOGINS !== "false";

export default function LoginPage() {
  useRedirectIfSignedIn();
  const [error, setError] = useState<string | null>(null);
  const [showPw, setShowPw] = useState(false);
  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (v: Values) => {
    setError(null);
    try {
      await loginWithEmail(v.email, v.password);
    } catch (e) {
      setError(friendlyAuthError(e));
    }
  };

  const fillDemo = (email: string) => {
    setValue("email", email, { shouldValidate: true });
    setValue("password", DEMO_PASSWORD, { shouldValidate: true });
    setError(null);
  };

  return (
    <AuthCard title="Sign in" subtitle="Use your SteelProcure account.">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">Email</label>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
          <FieldError message={errors.email?.message} />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">Password</label>
          <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
          <FieldError message={errors.password?.message} />
        </div>
        {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Signing in…" : "Sign in"}
        </Button>
        <Button type="button" variant="secondary" className="w-full" disabled={isSubmitting}
          onClick={async () => { setError(null); try { await loginWithGoogle(); } catch (e) { setError(friendlyAuthError(e)); } }}>
          Continue with Google
        </Button>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-steel-600 hover:underline">Forgot password?</Link>
        <Link href="/register" className="text-steel-600 hover:underline">Create account</Link>
      </div>

      {SHOW_DEMO && (
        <div className="mt-5 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3 text-sm">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-medium text-slate-700">Demo accounts</p>
            <button type="button" onClick={() => setShowPw((s) => !s)} className="text-xs text-steel-600 hover:underline">
              {showPw ? "Hide password" : "Show password"}
            </button>
          </div>
          <p className="mb-2 text-xs text-slate-500">
            Password for all: <code className="rounded bg-white px-1 py-0.5 font-mono">{showPw ? DEMO_PASSWORD : "••••••••••"}</code>
            {" "}· click a role to fill the form.
          </p>
          <ul className="space-y-1">
            {DEMO_ACCOUNTS.map((a) => (
              <li key={a.email}>
                <button type="button" onClick={() => fillDemo(a.email)}
                  className="flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-white">
                  <span className="font-medium text-slate-700">{a.role}</span>
                  <span className="truncate pl-2 font-mono text-xs text-slate-500">{a.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </AuthCard>
  );
}