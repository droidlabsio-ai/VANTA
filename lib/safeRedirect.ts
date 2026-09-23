/**
 * Where to send someone after signing in or registering, given the `next`
 * value the form carried.
 *
 * `next` is a hidden field, so it is whatever the link that opened the page
 * said — attacker-controlled by construction. It is honoured only when it is a
 * path on this site; anything else falls back.
 *
 * The earlier check was `startsWith("/") && !startsWith("//")`. It let
 * `/\evil.com` through: browsers treat a backslash as a slash in http(s) URLs,
 * so `new URL("/\\evil.com", "https://vanta…")` is `https://evil.com/`, and
 * Next's router follows an external redirect from a server action with a full
 * page load (§43). Parsing it the way the browser will, and comparing origins,
 * closes every spelling of that — backslashes, tabs and newlines the URL parser
 * strips, `%2F` tricks — instead of listing the ones we have thought of.
 */
const BASE = "https://vanta.invalid";

export function safeNextPath(next: unknown, fallback = "/account"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 512) return fallback;
  // Must start with exactly one slash and nothing that a browser would read as
  // a second one.
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;

  let url: URL;
  try {
    url = new URL(next, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;

  const path = `${url.pathname}${url.search}${url.hash}`;
  // Re-check the normalised form: a path that only becomes `//host` after
  // parsing must not survive either.
  return path.startsWith("//") ? fallback : path;
}
