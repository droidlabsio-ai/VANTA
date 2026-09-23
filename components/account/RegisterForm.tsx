"use client";

import Link from "next/link";
import { useActionState } from "react";
import { registerAction } from "@/app/account/actions";
import { MIN_PASSWORD_LENGTH, emptyFormState } from "@/lib/auth/accountSchema";
import {
  Field,
  FormError,
  SubmitButton,
  TextInput,
} from "@/components/account/AccountFormParts";
import { TurnstileWidget } from "@/components/TurnstileWidget";

/**
 * Create an account.
 *
 * Three fields, and no "confirm password". A confirmation box catches typos in
 * a value the browser is going to store in its password manager anyway, at the
 * cost of a field everyone resents; a "show password" toggle would be the
 * better trade if this ever needs one.
 *
 * Signing up signs you in — there is no email verification step yet, so there
 * is nothing to wait for, and bouncing someone to a login form to retype what
 * they just typed would be gratuitous.
 */
export function RegisterForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(registerAction, emptyFormState);

  return (
    <form action={formAction} className="space-y-5">
      {next && <input type="hidden" name="next" value={next} />}

      <Field label="Name" htmlFor="name" error={state.errors.name}>
        <TextInput
          id="name"
          name="name"
          autoComplete="name"
          required
          invalid={Boolean(state.errors.name)}
          placeholder="Your name"
        />
      </Field>

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

      <Field
        label="Password"
        htmlFor="password"
        error={state.errors.password}
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
      >
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          invalid={Boolean(state.errors.password)}
        />
      </Field>

      <FormError message={state.errors.form} />

      <TurnstileWidget action="account-register" resetKey={state} />

      <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>

      <p className="text-center text-sm text-bone/50">
        Already have an account?{" "}
        <Link
          href={next ? `/account/login?next=${encodeURIComponent(next)}` : "/account/login"}
          className="font-bold text-bone underline underline-offset-4 transition-opacity hover:opacity-70"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
