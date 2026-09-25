import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { contentStore } from "@/lib/contentStore";
import { hasDatabase } from "@/lib/db";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { BottomNav } from "@/components/BottomNav";
import { ForgotPasswordForm } from "@/components/account/ForgotPasswordForm";
import { AccountsUnavailable } from "@/components/account/AccountsUnavailable";

export const metadata: Metadata = pageMetadata({
  title: "Forgot password",
  description: "Get an email with a link to choose a new password for your VANTA account.",
  path: "/account/forgot-password",
  noindex: true,
});

/** Declared, not inherited from the root layout's cookie read — §26, §28. */
export const dynamic = "force-dynamic";

/** Ask for a reset link. §44. */
export default async function ForgotPasswordPage() {
  const { homepage } = await contentStore.read();

  return (
    <div className="storefront-shell">
      <Navbar nav={homepage.nav} />

      <main id="main" className="pt-[calc(var(--header-h)+2rem)]">
        <div className="mx-auto w-full max-w-[420px] px-gutter pb-24 lg:pb-32">
          <h1 className="headline text-display-sm">Forgot password</h1>
          <p className="mb-8 mt-3 text-sm text-bone/50">
            Enter the email you signed up with and we’ll send you a link to choose a new password.
          </p>
          {hasDatabase() ? <ForgotPasswordForm /> : <AccountsUnavailable />}
        </div>
      </main>

      <Footer content={homepage.footer} />
      <BottomNav items={homepage.nav.bottomNav} />
    </div>
  );
}
