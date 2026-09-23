"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction } from "@/app/account/actions";
import { emptyFormState } from "@/lib/auth/accountSchema";
import {
  Field,
  FormError,
  SubmitButton,
  TextInput,
} from "@/components/account/AccountFormParts";
import { TurnstileWidget } from "@/components/TurnstileWidget";

/**
 * Sign in.
 *
 * `next` rides along as a hidden field rather than being read from the URL on
 * the server, so the action has one input and one meaning. It is validated as
 * a same-site path in the action — a hidden field is a suggestion from the
 * browser, not a fact.
 */
export function SignInForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(signInAction, emptyFormState);

  return (
    <form action={formAction} className="space-y-5">
      {next && <input type="hidden" name="next" value={next} />}

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

      <Field label="Password" htmlFor="password" error={state.errors.password}>
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          invalid={Boolean(state.errors.password)}
        />
      </Field>

      <FormError message={state.errors.form} />

      <TurnstileWidget action="account-signin" resetKey={state} />

      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>

      <p className="text-center text-sm text-bone/50">
        New here?{" "}
        <Link
          href={next ? `/account/register?next=${encodeURIComponent(next)}` : "/account/register"}
          className="font-bold text-bone underline underline-offset-4 transition-opacity hover:opacity-70"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
