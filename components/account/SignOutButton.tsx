"use client";

import { suspendAccountSync } from "@/components/AccountSync";
import { bagStore } from "@/components/BagProvider";
import { wishlistStore } from "@/components/WishlistProvider";
import { signOutAction } from "@/app/account/actions";

/**
 * Sign out, and leave nothing of this customer behind in the browser (§43).
 *
 * The session is a server-side row and the cookie is cleared by the action,
 * but the bag and wishlist live in `localStorage` (§21). Before this, they
 * stayed after sign-out: the next person on a shared phone saw them, and if
 * they signed in, `AccountSync` merged the previous customer's bag and saved
 * items into the new account.
 *
 * The mirror to the server is suspended *first*, so clearing the local copy is
 * not uploaded as "this customer emptied their bag". Their saved bag stays on
 * the server and comes back the next time they sign in.
 */
export function SignOutButton() {
  return (
    <form
      action={signOutAction}
      onSubmit={() => {
        suspendAccountSync();
        bagStore.write([]);
        wishlistStore.write([]);
      }}
    >
      <button
        type="submit"
        className="rounded-full border border-bone/25 px-8 py-4 text-label-lg font-bold uppercase text-bone transition-colors hover:border-bone hover:bg-bone hover:text-ink"
      >
        Sign out
      </button>
    </form>
  );
}
