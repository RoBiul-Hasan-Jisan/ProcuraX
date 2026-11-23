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
import { friendlyAuthError, registerWithEmail } from "@/lib/firebase/auth";

const schema = z
  .object({
    name: z.string().trim().min(2, "Enter your full name"),
    email: z.string().min(1, "Email is required").email("Enter a valid email"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords do not match" });
type Values = z.infer<typeof schema>;

export default function RegisterPage() {
  useRedirectIfSignedIn();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Values>({
    resolver: zodResolver(schema),
  });

  const onSubmit = async (v: Values) => {
    setError(null);
    try {
      await registerWithEmail(v.name, v.email, v.password);
    } catch (e) {
      setError(friendlyAuthError(e));
    }
  };

  return (
    <AuthCard title="Create account" subtitle="An administrator must approve your account and assign a role before you can use the platform.">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium">Full name</label>
          <Input id="name" autoComplete="name" {...register("name")} />
          <FieldError message={errors.name?.message} />
        </div>
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium">Email</label>
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
          <FieldError message={errors.email?.message} />
        </div>
        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium">Password</label>
          <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
          <FieldError message={errors.password?.message} />
        </div>
        <div>
          <label htmlFor="confirm" className="mb-1 block text-sm font-medium">Confirm password</label>
          <Input id="confirm" type="password" autoComplete="new-password" {...register("confirm")} />
          <FieldError message={errors.confirm?.message} />
        </div>
        {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-danger">{error}</p>}
        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <p className="mt-4 text-sm">
        Already registered? <Link href="/login" className="text-steel-600 hover:underline">Sign in</Link>
      </p>
    </AuthCard>
  );
}
