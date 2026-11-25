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

export default function LoginPage() {
  useRedirectIfSignedIn();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({
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
    </AuthCard>
  );
}
