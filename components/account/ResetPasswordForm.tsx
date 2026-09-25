"use client";

import Link from "next/link";
import { useActionState } from "react";
import { resetPasswordAction } from "@/app/account/password-actions";
import { emptyFormState, MIN_PASSWORD_LENGTH } from "@/lib/auth/accountSchema";
import {
  Field,
  FormError,
  SubmitButton,
  TextInput,
} from "@/components/account/AccountFormParts";

/**
 * Choosing a new password from an emailed link. §44.
 *
 * The token rides along as a hidden field. The page has already checked it
 * once so an expired link says so before anyone types; the action checks it
 * again, atomically, because the page's answer can be stale by the time the
 * form is submitted.
 */
export function ResetPasswordForm({ token, email }: { token: string; email: string }) {
  const [state, formAction] = useActionState(resetPasswordAction, emptyFormState);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      {/* Lets a password manager file the new password under the right account. */}
      <input type="hidden" name="username" autoComplete="username" value={email} readOnly />

      <Field
        label="New password"
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

      <Field label="Type it again" htmlFor="confirm" error={state.errors.confirm}>
        <TextInput
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          invalid={Boolean(state.errors.confirm)}
        />
      </Field>

      <FormError message={state.errors.form} />
      {state.errors.form && (
        <p className="text-center text-sm">
          <Link
            href="/account/forgot-password"
            className="font-bold text-bone underline underline-offset-4"
          >
            Get a new reset link
          </Link>
        </p>
      )}

      <SubmitButton pendingLabel="Saving…">Save new password</SubmitButton>
    </form>
  );
}
