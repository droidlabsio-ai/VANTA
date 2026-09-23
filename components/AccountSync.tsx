"use client";

import { useEffect, useRef } from "react";
import { bagStore } from "@/components/BagProvider";
import { wishlistStore } from "@/components/WishlistProvider";
import { saveAccountDataAction, syncAccountDataAction } from "@/app/account/actions";

/**
 * Keeps a signed-in customer's bag and wishlist on the server.
 *
 * Renders nothing. It is mounted once, inside the providers, and only when
 * somebody is signed in — signed out there is nothing to sync and no reason to
 * ship the listener.
 *
 * The design in one line: **localStorage stays the authority, the server is a
 * mirror.** The alternative — reading the bag from the database on every
 * render — would make adding an item a network round trip, break the bag
 * entirely when the connection drops, and turn every product page into a
 * dynamic one. Mirroring costs one request at sign-in and one debounced
 * request per change, and the bag never stops working.
 *
 * The one moment the server wins is the merge at mount, which is the only
 * moment it knows something the browser does not: what this person's other
 * device did.
 */
/**
 * Set by sign-out, before the local bag and wishlist are cleared (§43).
 *
 * Signing out empties this browser's copy so the next person on a shared device
 * neither sees it nor, on signing in, has it merged into *their* account. That
 * emptying is itself a change this component would dutifully mirror — and
 * mirroring an empty bag to the server would delete the customer's saved one on
 * the way out. So sign-out stops the mirror first. Module state, not React
 * state: it has to be read by the debounced push after the component may have
 * re-rendered, and it must not survive a reload — if sign-out fails, the next
 * page load merges the server copy straight back in.
 */
let suspended = false;

export function suspendAccountSync(): void {
  suspended = true;
}

export function AccountSync() {
  /**
   * Nothing is pushed before the merge has come back. A push in the gap would
   * upload this device's bag over the merged result and quietly undo whatever
   * the other device had added.
   */
  const merged = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** What was last sent, so an unchanged bag isn't re-sent on every event. */
  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    let live = true;

    const snapshot = () => ({
      bag: bagStore.getSnapshot(),
      wishlist: wishlistStore.getSnapshot(),
    });

    const push = async () => {
      if (!merged.current || suspended) return;
      const payload = snapshot();
      const serialised = JSON.stringify(payload);
      if (serialised === lastSent.current) return;
      lastSent.current = serialised;
      try {
        await saveAccountDataAction(payload);
      } catch {
        // A failed mirror is not worth interrupting anyone over: the bag on
        // screen is correct, and the next change re-sends the whole list.
        // Clearing the marker means that retry actually happens.
        lastSent.current = null;
      }
    };

    const schedule = () => {
      if (timer.current) clearTimeout(timer.current);
      // Long enough that holding the "+" button is one request rather than six,
      // short enough that closing the tab a moment later still catches it.
      timer.current = setTimeout(push, 800);
    };

    /**
     * The merge. Runs once per page load, not once per sign-in, because a page
     * load is the only moment this component can know the browser and the
     * server may have drifted apart.
     */
    void (async () => {
      try {
        const result = await syncAccountDataAction(snapshot());
        if (!live || !result) return;
        merged.current = true;
        lastSent.current = JSON.stringify(result);
        // Writing unconditionally is safe: the store compares nothing, but
        // `useSyncExternalStore` re-renders consumers only when the parsed
        // value actually changes identity, and an identical list parses to the
        // same cached reference.
        bagStore.write(result.bag);
        wishlistStore.write(result.wishlist);
      } catch {
        // Offline, or the action failed. The bag is still on screen and still
        // correct; the next page load tries again.
      }
    })();

    const unsubscribeBag = bagStore.subscribe(schedule);
    const unsubscribeWishlist = wishlistStore.subscribe(schedule);

    /**
     * A tab being hidden is the last reliable moment to write. `pagehide` and
     * `visibilitychange` are used rather than `beforeunload`, which mobile
     * browsers do not fire when the app is swiped away.
     */
    const flush = () => {
      if (timer.current) clearTimeout(timer.current);
      void push();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", flush);

    return () => {
      live = false;
      if (timer.current) clearTimeout(timer.current);
      unsubscribeBag();
      unsubscribeWishlist();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  return null;
}
