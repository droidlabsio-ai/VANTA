"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordResetAction } from "@/app/account/password-actions";
import { emptyFormState } from "@/lib/auth/accountSchema";
import {
  Field,
  FormError,
  FormNotice,
  SubmitButton,
  TextInput,
} from "@/components/account/AccountFormParts";
import { TurnstileWidget } from "@/components/TurnstileWidget";

/**
 * "Forgot password" — asks for an email and says the same thing whatever the
 * answer is. §44.
 */
export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordResetAction, emptyFormState);

  return (
    <form action={formAction} className="space-y-5">
      <Field label="Email" htmlFor="email" error={state.errors.email}>
        <TextInput
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          invalid={Boolean(state.errors.email)}
          placeholder="you@example.com"
        />
      </Field>

      <FormError message={state.errors.form} />
      <FormNotice message={state.message} />

      <TurnstileWidget action="account-forgot-password" resetKey={state} />

      <SubmitButton pendingLabel="Sending…">Email me a reset link</SubmitButton>

      <p className="text-center text-sm text-bone/50">
        Remembered it?{" "}
        <Link
          href="/account/login"
          className="font-bold text-bone underline underline-offset-4 transition-opacity hover:opacity-70"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
