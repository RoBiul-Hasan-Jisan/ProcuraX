"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthCard, FieldError } from "@/features/auth/AuthCard";
import { friendlyAuthError, resetPassword } from "@/lib/firebase/auth";

const schema = z.object({ email: z.string().min(1, "Email is required").email("Enter a valid email") });
type Values = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = async (v: Values) => {
    setError(null);
    try {
      await resetPassword(v.email);
      setSent(true);
    } catch (e) {
      setError(friendlyAuthError(e));
    }
  };

  return (
    <AuthCard title="Reset password" subtitle="We will email you a link to choose a new password.">
      {sent ? (
        <p role="status" className="rounded bg-green-50 p-3 text-sm text-ok">
          If an account exists for that address, a reset link is on its way.
        </p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium">Email</label>
            <Input id="email" type="email" autoComplete="email" {...register("email")} />
            <FieldError message={errors.email?.message} />
          </div>
          {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Sending…" : "Send reset link"}
          </Button>
        </form>
      )}
      <p className="mt-4 text-sm"><Link href="/login" className="text-steel-600 hover:underline">Back to sign in</Link></p>
    </AuthCard>
  );
}
