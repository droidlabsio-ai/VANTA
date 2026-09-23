"use client";

import Script from "next/script";
import { useEffect, useId, useRef } from "react";

/**
 * The Cloudflare Turnstile widget.
 *
 * Implicit rendering: the script scans for `.cf-turnstile` and writes a hidden
 * `cf-turnstile-response` input into the surrounding form, which is the name the
 * server action reads. Explicit rendering would mean owning the widget id, the
 * ready callback and the teardown by hand for no gain here — these are ordinary
 * forms, not a single-page flow that mounts widgets on demand.
 * https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/
 *
 * Renders nothing at all without a site key. The customer forms are meant to
 * work in development with no Cloudflare account, and an empty grey box that
 * never resolves would look like a broken form rather than an absent feature.
 */
export function TurnstileWidget({
  action,
  className,
  resetKey,
}: {
  /** Labels the challenge in Cloudflare's analytics — "admin-login", "register". */
  action: string;
  className?: string;
  /**
   * Changes whenever the server has answered a submit — pass the action state.
   * The token that submit carried is spent either way, so the widget is reset to
   * fetch a fresh one; without it a second attempt after any error fails with
   * "couldn't verify that you're human" (§43, checkout).
   */
  resetKey?: unknown;
}) {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const containerId = useId();
  const container = useRef<HTMLDivElement>(null);
  const firstResetKey = useRef(resetKey);

  useEffect(() => {
    // Not on mount: the implicit render is already fetching the first token.
    if (resetKey === firstResetKey.current) return;
    const api = (window as unknown as { turnstile?: { reset: (el?: HTMLElement) => void } })
      .turnstile;
    if (container.current && api) {
      try {
        api.reset(container.current);
      } catch {
        // Not rendered yet — the implicit render will produce a fresh token.
      }
    }
  }, [resetKey]);

  /**
   * A token is single-use and short-lived, and `useActionState` leaves the form
   * mounted after a failed submit — so the token sitting in the hidden input is
   * one the server has already rejected or already spent. Resetting on unmount
   * and after any error keeps the next attempt from failing for a reason the
   * visitor cannot see or fix.
   */
  useEffect(() => {
    const element = container.current;
    return () => {
      const api = (window as unknown as { turnstile?: { reset: (el?: HTMLElement) => void } })
        .turnstile;
      if (element && api) {
        try {
          api.reset(element);
        } catch {
          // Widget already gone. Nothing to reset, nothing to report.
        }
      }
    };
  }, []);

  if (!siteKey) return null;

  return (
    <>
      {/*
        `afterInteractive`, not `beforeInteractive`: the challenge does not need
        to run before the page is usable, and blocking first paint on a
        third-party script to protect a form nobody has started filling in yet
        is the wrong trade.
      */}
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
      />
      <div
        ref={container}
        id={containerId}
        className={`cf-turnstile ${className ?? ""}`}
        data-sitekey={siteKey}
        data-action={action}
        // `auto` follows the visitor's own light/dark preference. Both surfaces
        // this appears on are dark, but the admin is a separate visual system
        // and hard-coding either one would be wrong on one of them.
        data-theme="auto"
      />
    </>
  );
}
