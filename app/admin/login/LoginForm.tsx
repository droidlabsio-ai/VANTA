"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";
import { Button, Field, TextInput } from "@/components/admin/ui";
import { TurnstileWidget } from "@/components/TurnstileWidget";

const initialState: LoginState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Username" htmlFor="username">
        <TextInput
          id="username"
          name="username"
          autoComplete="username"
          required
          autoFocus
          disabled={pending}
        />
      </Field>

      <Field label="Password" htmlFor="password">
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={pending}
        />
      </Field>

      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-admin-danger/25 bg-admin-danger/5 px-3 py-2.5 text-sm text-admin-danger"
        >
          {state.error}
        </p>
      )}

      <TurnstileWidget action="admin-login" resetKey={state} />


      <Button type="submit" variant="primary" disabled={pending} className="w-full">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
