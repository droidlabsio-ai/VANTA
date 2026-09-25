import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import { contentStore } from "@/lib/contentStore";
import { hasDatabase } from "@/lib/db";
import { findValidResetToken } from "@/lib/auth/passwordReset";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { BottomNav } from "@/components/BottomNav";
import { ResetPasswordForm } from "@/components/account/ResetPasswordForm";
import { AccountsUnavailable } from "@/components/account/AccountsUnavailable";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "Choose a new password",
    description: "Choose a new password for your VANTA account.",
    path: "/account/reset-password",
    noindex: true,
  }),
  // The URL carries a live token. Nothing on this page loads from another
  // origin, and this makes sure no link followed from it passes the URL on.
  referrer: "no-referrer",
};

export const dynamic = "force-dynamic";

/**
 * The page a reset email links to. §44.
 *
 * The token is checked here, before the form is shown, so an expired or used
 * link says so at once instead of after the customer has typed a password
 * twice. The action checks it again — this answer can go stale.
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ homepage }, { token }] = await Promise.all([contentStore.read(), searchParams]);
  const valid = hasDatabase() ? await findValidResetToken(token) : null;

  return (
    <div className="storefront-shell">
      <Navbar nav={homepage.nav} />

      <main id="main" className="pt-[calc(var(--header-h)+2rem)]">
        <div className="mx-auto w-full max-w-[420px] px-gutter pb-24 lg:pb-32">
          <h1 className="headline text-display-sm">New password</h1>

          {!hasDatabase() ? (
            <div className="mt-8">
              <AccountsUnavailable />
            </div>
          ) : valid && token ? (
            <>
              <p className="mb-8 mt-3 text-sm text-bone/50">
                For <span className="text-bone">{valid.email}</span>. You’ll be signed out
                everywhere else once it’s saved.
              </p>
              <ResetPasswordForm token={token} email={valid.email} />
            </>
          ) : (
            <div className="mt-6 space-y-4">
              <p className="text-sm leading-relaxed text-bone/60">
                This link has expired or has already been used. Reset links work once and
                last 30 minutes.
              </p>
              <Link
                href="/account/forgot-password"
                className="inline-block text-label font-bold uppercase text-bone underline underline-offset-4"
              >
                Get a new link
              </Link>
            </div>
          )}
        </div>
      </main>

      <Footer content={homepage.footer} />
      <BottomNav items={homepage.nav.bottomNav} />
    </div>
  );
}
